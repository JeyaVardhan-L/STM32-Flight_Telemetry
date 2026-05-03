# 🚀 STM32 Zero-Latency Telemetry & Sensor Fusion

![Dashboard Screenshot](assets/web.png)

A high-performance, browser-based 3D telemetry dashboard and flight controller prototype. This project demonstrates raw I2C sensor reading, mathematical sensor fusion (Complementary Filter), and direct hardware-to-browser communication via the Web Serial API.

## 🛠️ The Hardware "Hack"
Due to a strict deadline and missing UART bridge hardware, this project utilizes a custom hardware bypass:
* An **Arduino Uno** is put into a comatose state (RESET tied to GND).
* The **STM32 Blue Pill** hijacks the Arduino's onboard USB-to-Serial TTL chip.
* This allows the ARM Cortex-M3 processor to stream fused sensor data at 115200 baud directly to the PC.

![Hardware Setup](assets/Finmodule.jpg)

## ⚙️ Core Features
* **Bare-Metal Math:** The Complementary Filter runs directly on the STM32, blending Gyroscope and Accelerometer data to eliminate jitter and drift.
* **Euler Angle Wrap:** Custom shortest-path algorithms prevent gimbal-lock snapping.
* **Web Serial API:** The dashboard reads USB COM ports natively in Chrome/Edge—no local Python servers or Node.js backends required.
* **Procedural 3D:** The UI dynamically generates Quadcopter, Satellite, and Rocket models using Three.js based on live incoming telemetry.

## 🔌 Wiring Guide
**MPU6050 to STM32:**
* `VCC` -> `3.3V`
* `GND` -> `GND`
* `SCL` -> `PB6`
* `SDA` -> `PB7`

**STM32 to UART Bridge (Comatose Arduino):**
* `PA9 (TX)` -> Arduino `TX (Pin 1)`
* `PA10 (RX)` -> Arduino `RX (Pin 0)`
* *Note: Arduino RESET must be jumpered to GND.*

## 🚀 How to Run
1. Flash the `firmware.ino` to your STM32F103C8T6 using an ST-Link V2.
2. Wire the hardware as shown above.
3. Open the `dashboard/index.html` file in a Chromium-based browser (Chrome/Edge).
4. Select your 3D model, click **Initialize UART**, and select your USB COM port!
