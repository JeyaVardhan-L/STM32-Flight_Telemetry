# Project Report: STM32 Sensor Fusion & Real-Time Telemetry Dashboard

> This is the original development log from the one-evening build sprint (May 2026). It is kept as written, with corrections added during a later audit (November 2026) marked **Post-ship note**. Cycle 9 at the end describes that audit.

## 1. Project Inception & Hardware Sourcing
**The Goal:** Build an educational, professional-grade embedded systems project using an STM32 microcontroller.
*   **The Original Plan:** We initially aimed to use an STM32 Nucleo board to build an ADC/PWM smart light dimmer.
*   **The Problem:** The Nucleo board was unavailable in local shops in Vizag, and we faced a strict evening deadline. 
*   **The Fix:** We pivoted to the locally abundant **STM32 Blue Pill (STM32F103C8T6)** alongside an **ST-Link V2** programmer. 
*   **The Final Concept:** An MPU6050 3D Orientation Tracker that calculates pitch, roll, and yaw, streaming live data to a custom PC dashboard.

## 2. The Toolchain & Hardware Hurdles
**Cycle 1: The UART Bridge Dilemma**
*   **Problem:** To send live, scrolling data to the PC, the STM32 requires a USB-to-TTL Serial Adapter, which was missing from the workbench.
*   **Fix (The Comatose Arduino Hack):** We bypassed buying a new adapter by hardwiring an Arduino Uno's `RESET` pin to `GND`. This disabled the Arduino's main brain, allowing us to hijack its onboard USB-to-Serial chip and bridge the STM32 directly to the computer.

**Cycle 2: The Firmware Deadline**
*   **Problem:** Professional STM32 workflows require STM32CubeIDE, which involves reading complex datasheets to configure memory registers—impossible to learn in one evening.
*   **Fix:** We pivoted to the **Arduino IDE** using the STM32duino core. This allowed for rapid prototyping using familiar C++ abstractions and the Adafruit MPU6050 library.

**Cycle 3: The Upload Error (Toolchain Missing)**
*   **Problem:** The Arduino IDE threw a missing `STM32CubeProgrammer` (`STM32_Programmer_CLI.exe`) error during the first code upload, halting the process.
*   **Fix:** We executed the official ST Microelectronics toolchain fix. We downloaded the STM32CubeProgrammer suite directly from the ST website, installed the official drivers, and completely restarted the Arduino IDE to force it to recognize the new paths. This successfully allowed the ST-Link to flash the ARM chip.

## 3. Visualization & Dashboard Evolution
**Cycle 4: Escaping the Text Terminal**
*   **Problem:** Staring at raw `m/s²` numbers in a Serial Monitor is not presentable for a final submission.
*   **Fix:** We built a standalone HTML/JavaScript dashboard utilizing **Three.js** (for 3D rendering) and **Chart.js** (for live graphing). We used the modern **Web Serial API** to allow the browser to read data directly from the USB port without needing a local server or Python backend.

**Cycle 5: 3D Rendering Glitches & Calibration**
*   **Problem:** The 3D model initially failed to render due to CSS layout timing, and the physical breadboard was tilted on the desk, causing the 3D model to rest at an awkward angle.
*   **Fix:** Implemented resize listeners and a fallback dimension for the canvas. Added a **Tare / Zero Level Calibration** math function that captures the initial tilted state and subtracts it from all future readings to establish a perfect absolute "Zero."

## 4. Aerospace Mathematics & Sensor Limits
**Cycle 6: Jitter, Lag, and Gimbal Lock**
*   **Problem:** The raw sensor data caused violent jittering, noticeable lag, and wild 360-degree snap-glitches when rolled upside down.
*   **Fix:** 
    1.  Increased the loop speed to 100Hz (`delay(10)`).
    2.  Added a `wrapAngle()` shortest-path function to handle Euler angle wraparounds.
    3.  Implemented an **Exponential Moving Average (Low-Pass Filter)** to mathematically smooth the high-frequency jitter.

**Cycle 7: Professional Sensor Fusion**
*   **Problem:** The HTML low-pass filter caused sluggishness, and the accelerometer was easily confused by sliding the board horizontally.
*   **Fix:** We moved the math out of the web browser and directly onto the STM32. We implemented a **Complementary Filter (Sensor Fusion)** that trusts the lightning-fast Gyroscope for 98% of the movement, and the gravity-aware Accelerometer for 2% of the movement to prevent drift.
*   **Post-ship note:** The firmware that was actually committed on the day (tag [`v1.0-hackathon`](https://github.com/JeyaVardhan-L/STM32-Flight_Telemetry/tree/v1.0-hackathon)) did **not** contain this filter: pitch and roll came from the accelerometer alone and yaw was raw gyro integration. The filter now lives in firmware v2, with one improvement: the 2% correction uses the shortest angular difference, so the estimate doesn't jump when the board passes upside down (±180°).

**Cycle 8: The Unfixable Yaw Drift**
*   **Problem:** Over time, the Z-axis (Yaw) would slowly rotate on its own, even when sitting still. 
*   **Fix:** Acknowledged the hardware limitation of a 6-axis IMU (it lacks a magnetometer/compass to find absolute North). Applied a **Software Deadband Hack** to ignore microscopic electrical noise when the board is resting, preventing stationary drift. 
*   **Post-ship note:** The deadband was also missing from the committed v1 firmware. v2 adds it (rates below 0.5 °/s are ignored) together with the step that matters more: averaging the gyro for ~2 s at boot to remove its constant bias. A deadband alone can't fix a biased gyro, because the bias can sit above the threshold.

## 5. Final UI Polish
*   **Problem:** The dashboard looked a bit clunky with standard colors, visible grid lines, and basic geometries.
*   **Fix:** Applied a **Monotonic Dark UI** using slate grays, absolute blacks, and a single cyan accent color. Implemented the *Inter* font, frosted glassmorphism elements, fluid bezel-less curves for the Chart.js graphs, and procedurally generated complex 3D models (Quadcopter, Satellite, Launch Vehicle, Hardware Workbench) using Three.js primitives.

---

### Key Engineering Takeaways
Through this rapid-prototyping sprint, the following concepts were successfully executed:

1.  **Hardware Interfacing:** Differentiating between an SWD Programmer (ST-Link, editing flash memory) and a UART Bridge (Serial Adapter, transmitting text).
2.  **Protocol Knowledge:** Successfully wiring and utilizing both **I2C** (STM32 talking to the MPU6050) and **UART** (STM32 talking to the PC).
3.  **Sensor Fusion (Complementary Filter):** Understanding that raw sensor data requires mathematical filtering. Implementing integration of angular velocity over time (Calculus) and fusing it with gravity vectors.
4.  **Web Serial API:** Bridging physical hardware directly into a client-side web browser without intermediate backend software.
5.  **IMU Limitations:** Understanding the practical difference between a 6-axis IMU (subject to Yaw drift) and a 9-axis IMU (which uses a magnetometer for absolute heading).

---

## 6. Cycle 9: The Post-Ship Audit (November 2026)
Six months later the repository was reviewed with fresh eyes, the way a stranger would read it. The biggest finding wasn't a bug in the hardware; it was a gap between the documentation and the code.

| Finding | Why it mattered | Fix in v2 |
| :--- | :--- | :--- |
| README and this log described a complementary filter and a yaw deadband that weren't in the committed sketch | Anyone reading the 53-line `.ino` would notice, and it undermines everything else | Implemented both in firmware v2; kept v1 under a tag so the history stays honest |
| No gyro bias calibration | Yaw drifts even when the board is still | 500-sample bias average at boot, LED on while calibrating |
| `dt` measured with `millis()` on a 10 ms loop | 1 ms resolution means about 10% timing jitter in every integration step | `micros()` timing and a fixed 100 Hz scheduler instead of `delay(10)` |
| `mpu.begin()` failure hung silently | A loose wire looked exactly like a dead board | Fast LED blink plus an error line the dashboard displays |
| Dashboard needed real hardware to show anything | Visitors to the live site saw a spinning model and a button that did nothing | Demo mode that replays a recording, and a Record button that exports CSV from the real board |
| Chart.js loaded as "latest" from the CDN | A future major release could break the page with no code change | Pinned to an exact version |
| No feedback for unsupported browsers or unplugged cables | Failures only showed up in the developer console | On-screen messages, a Disconnect button and unplug handling |
| "Prevents gimbal lock" claim | `wrapAngle()` fixes ±180° wraparound, which is a different problem. Euler angles still have gimbal lock near ±90° pitch | Wording corrected; quaternions listed as future work |

### What I'd do differently
*   **Write the README from the code, not from memory.** Reading the docs and the code side by side before publishing would have caught every mismatch above.
*   **Tag what actually shipped.** A release tag would have made it obvious which sketch the demo video used.
*   **Calibrate before filtering.** Most of the yaw drift came from a constant gyro offset. Removing the bias at boot is cheaper and more effective than any filter tuning.
*   **Measure time with the finest clock available.** Every integrator is only as good as its `dt`.
