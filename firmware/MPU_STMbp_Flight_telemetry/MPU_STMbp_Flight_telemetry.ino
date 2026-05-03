#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

Adafruit_MPU6050 mpu;

// Variables for Calculus (Integrating Gyro to get Yaw)
unsigned long lastTime = 0;
float yawAngle = 0.0;

void setup(void) {
  Serial1.begin(115200);
  delay(1000); 

  if (!mpu.begin()) {
    while (1) { delay(10); } 
  }
  
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  
  // Opened up the internal hardware filter for less input lag
  mpu.setFilterBandwidth(MPU6050_BAND_44_HZ); 

  delay(100);
  lastTime = millis(); // Start the clock
}

void loop() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  // Calculate exactly how much time passed since the last loop (dt)
  unsigned long currentTime = millis();
  float dt = (currentTime - lastTime) / 1000.0; // Time in seconds
  lastTime = currentTime;

  // Calculate Pitch and Roll from Accelerometer
  float pitch = atan2(a.acceleration.y, a.acceleration.z) * 180.0 / PI;
  float roll = atan2(-a.acceleration.x, sqrt(a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z)) * 180.0 / PI;
  
  // CALCULUS: Integrate Gyro Z (Convert rad/s to deg/s, then multiply by time)
  yawAngle += (g.gyro.z * 180.0 / PI) * dt;

  // Stream data out
  Serial1.print(pitch);
  Serial1.print(",");
  Serial1.print(roll);
  Serial1.print(",");
  Serial1.println(yawAngle);

  // 100 Updates per second for perfect sync
  delay(10); 
}