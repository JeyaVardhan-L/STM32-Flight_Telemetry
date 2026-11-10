/*
 * STM32 Blue Pill IMU Telemetry - firmware v2
 *
 * Board   : STM32F103C8T6 "Blue Pill" (STM32duino core: Generic STM32F1 series > BluePill F103C8)
 * Sensor  : MPU6050 on I2C1  (PB6 = SCL, PB7 = SDA)
 * Output  : USART1 / Serial1 (PA9 = TX, PA10 = RX) at 115200 baud
 * Format  : one CSV line per sample, "pitch,roll,yaw\n" in degrees, 100 Hz
 *           lines starting with '#' are status messages (the dashboard shows them)
 *
 * v1 (tag v1.0-hackathon) computed pitch/roll from the accelerometer alone and
 * integrated raw gyro Z for yaw. v2 adds what the dev log describes:
 *   - complementary filter for pitch/roll (98% gyro, 2% accelerometer)
 *   - gyro bias calibration at boot (board must be still for ~2 s, LED on)
 *   - yaw deadband to suppress drift from residual noise while resting
 *   - fixed 100 Hz loop timed with micros() instead of delay(10) + millis()
 *   - a visible error (fast LED blink + '#' message) if the MPU6050 is missing
 */

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <math.h>

// ---------------- configuration ----------------
constexpr uint32_t BAUD             = 115200;
constexpr uint32_t I2C_CLOCK_HZ     = 400000;  // MPU6050 supports 400 kHz fast mode
constexpr uint32_t LOOP_PERIOD_US   = 10000;   // 10 ms -> 100 Hz
constexpr float    ALPHA            = 0.98f;   // complementary filter: gyro weight
constexpr float    YAW_DEADBAND_DPS = 0.5f;    // |gyro z| below this is treated as 0
constexpr uint16_t CAL_SAMPLES      = 500;     // gyro bias samples (~2 s)
constexpr float    RAD_TO_DEG_F     = 57.2957795f;

// The Blue Pill user LED on PC13 is active-low.
#define LED_ON()  digitalWrite(LED_BUILTIN, LOW)
#define LED_OFF() digitalWrite(LED_BUILTIN, HIGH)

Adafruit_MPU6050 mpu;

float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;  // rad/s
float pitch = 0, roll = 0, yaw = 0;                 // degrees
uint32_t lastMicros = 0, nextTick = 0;

// Wrap an angle to (-180, 180].
static float wrap180(float a) {
  while (a > 180.0f)   a -= 360.0f;
  while (a <= -180.0f) a += 360.0f;
  return a;
}

// Tilt angles from the gravity vector (valid when the board is not accelerating).
static float accelPitch(const sensors_event_t &a) {
  return atan2f(a.acceleration.y, a.acceleration.z) * RAD_TO_DEG_F;
}
static float accelRoll(const sensors_event_t &a) {
  const float ay = a.acceleration.y, az = a.acceleration.z;
  return atan2f(-a.acceleration.x, sqrtf(ay * ay + az * az)) * RAD_TO_DEG_F;
}

// Complementary filter step: integrate the gyro, then pull 2% toward the
// accelerometer. The correction uses the shortest angular difference so the
// estimate does not jump when pitch crosses +/-180 (board upside down).
static float fuse(float angle, float rateDps, float accAngle, float dt) {
  const float predicted = angle + rateDps * dt;
  return wrap180(predicted + (1.0f - ALPHA) * wrap180(accAngle - predicted));
}

// Never returns. (No [[noreturn]] attribute: the Arduino prototype generator mangles it.)
static void fail(const char *msg) {
  for (;;) {
    Serial1.println(msg);
    for (int i = 0; i < 10; i++) {  // ~1 s of fast blinking between messages
      LED_ON();  delay(50);
      LED_OFF(); delay(50);
    }
  }
}

static void calibrateGyro() {
  Serial1.println("# Calibrating gyro - keep the board still");
  LED_ON();
  sensors_event_t a, g, t;
  double sx = 0, sy = 0, sz = 0;
  for (uint16_t i = 0; i < CAL_SAMPLES; i++) {
    mpu.getEvent(&a, &g, &t);
    sx += g.gyro.x;
    sy += g.gyro.y;
    sz += g.gyro.z;
    delay(3);
  }
  gyroBiasX = sx / CAL_SAMPLES;
  gyroBiasY = sy / CAL_SAMPLES;
  gyroBiasZ = sz / CAL_SAMPLES;

  // Start the filter at the accelerometer's angle instead of 0 so it does not
  // spend the first few seconds converging.
  mpu.getEvent(&a, &g, &t);
  pitch = accelPitch(a);
  roll  = accelRoll(a);
  yaw   = 0;
  LED_OFF();
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  LED_OFF();
  Serial1.begin(BAUD);
  delay(1000);

  if (!mpu.begin()) {
    fail("# ERROR: MPU6050 not found - check VCC/GND and SCL=PB6 SDA=PB7");
  }
  Wire.setClock(I2C_CLOCK_HZ);

  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);  // on-chip low-pass filter
  delay(100);

  calibrateGyro();
  Serial1.println("# Ready - firmware v2 (complementary filter)");

  lastMicros = micros();
  nextTick   = lastMicros + LOOP_PERIOD_US;
}

void loop() {
  const uint32_t now = micros();
  if ((int32_t)(now - nextTick) < 0) return;  // wait for the next 10 ms tick
  nextTick += LOOP_PERIOD_US;
  if ((int32_t)(now - nextTick) >= 0) nextTick = now + LOOP_PERIOD_US;  // fell behind: resync

  const float dt = (now - lastMicros) * 1e-6f;  // unsigned subtraction handles micros() rollover
  lastMicros = now;

  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);

  // Gyro rates in deg/s with the boot-time bias removed.
  const float gx = (g.gyro.x - gyroBiasX) * RAD_TO_DEG_F;
  const float gy = (g.gyro.y - gyroBiasY) * RAD_TO_DEG_F;
  float       gz = (g.gyro.z - gyroBiasZ) * RAD_TO_DEG_F;

  pitch = fuse(pitch, gx, accelPitch(a), dt);
  roll  = fuse(roll,  gy, accelRoll(a),  dt);

  // Yaw: gyro only (a 6-axis IMU has no absolute heading reference), with a
  // deadband so sensor noise does not accumulate while the board is resting.
  if (fabsf(gz) < YAW_DEADBAND_DPS) gz = 0;
  yaw = wrap180(yaw + gz * dt);

  Serial1.print(pitch, 2);
  Serial1.print(',');
  Serial1.print(roll, 2);
  Serial1.print(',');
  Serial1.println(yaw, 2);
}
