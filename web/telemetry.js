/* Data sources for the dashboard.
   Both sources call onSample({pitch, roll, yaw}) in degrees.
   - SerialLink : live data from the board over Web Serial
   - DemoPlayer : replays a CSV recording (same format the Record button exports) */
(function () {
  "use strict";

  const BAUD = 115200;
  const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

  // Strict number parsing: Number("") is 0, which would turn a truncated
  // line like "12.3,," into a bogus zero reading.
  const toNum = (s) => (NUMBER.test(s.trim()) ? Number(s) : NaN);

  // A line is either a status message ("# ...") or "pitch,roll,yaw".
  function parseLine(line) {
    const s = line.trim();
    if (!s) return null;
    if (s.startsWith("#")) return { message: s.replace(/^#\s*/, "") };
    const parts = s.split(",");
    if (parts.length !== 3) return null;
    const [pitch, roll, yaw] = parts.map(toNum);
    if (![pitch, roll, yaw].every(Number.isFinite)) return null;
    return { pitch, roll, yaw };
  }

  class SerialLink {
    static get supported() { return "serial" in navigator; }

    constructor({ onSample, onMessage, onClose }) {
      this.onSample = onSample;
      this.onMessage = onMessage;
      this.onClose = onClose;
      this.port = null;
      this.reader = null;
      this.keepReading = false;
      this._onDisconnect = (e) => {
        if (e.target === this.port) this.onMessage("USB device unplugged");
      };
    }

    async connect() {
      const port = await navigator.serial.requestPort();  // throws NotFoundError if the user cancels
      try {
        await port.open({ baudRate: BAUD });
      } catch (err) {
        throw new Error("Couldn't open the port. Is another program (e.g. Arduino Serial Monitor) using it?");
      }
      this.port = port;
      this.keepReading = true;
      navigator.serial.addEventListener("disconnect", this._onDisconnect);
      this._readLoop();  // runs until disconnect() or the cable is pulled
    }

    async _readLoop() {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (this.port.readable && this.keepReading) {
          this.reader = this.port.readable.getReader();
          try {
            for (;;) {
              const { value, done } = await this.reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop();  // keep the partial last line for the next chunk
              for (const line of lines) {
                const parsed = parseLine(line);
                if (!parsed) continue;
                if (parsed.message !== undefined) this.onMessage(parsed.message);
                else this.onSample(parsed);
              }
            }
          } catch (err) {
            // Non-fatal read errors (framing/parity/buffer overrun) leave port.readable
            // usable; a lost device leaves it null and ends the loop.
            if (this.port.readable) this.onMessage("Serial read error: " + err.message);
          } finally {
            this.reader.releaseLock();
            this.reader = null;
          }
        }
      } finally {
        navigator.serial.removeEventListener("disconnect", this._onDisconnect);
        try { await this.port.close(); } catch (_) { /* already closed or gone */ }
        this.port = null;
        this.onClose();
      }
    }

    async disconnect() {
      this.keepReading = false;
      if (this.reader) await this.reader.cancel();  // makes read() resolve with done=true
    }
  }

  // Parses the CSV format written by Recorder.toCSV(). Returns {source, samples}.
  function parseRecording(text) {
    let source = "recording";
    const samples = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) {
        const m = line.match(/^#\s*source:\s*(.+)$/i);
        if (m) source = m[1].trim();
        continue;
      }
      const p = line.split(",").map(toNum);
      if (p.length === 4 && p.every(Number.isFinite)) {
        samples.push({ t: p[0], pitch: p[1], roll: p[2], yaw: p[3] });
      }
    }
    if (samples.length < 2) throw new Error("Recording needs at least 2 samples to play back");
    return { source, samples };
  }

  class DemoPlayer {
    constructor({ onSample }) {
      this.onSample = onSample;
      this.samples = [];
      this.source = "";
      this.playing = false;
      this._raf = 0;
    }

    async load(url) {
      let res;
      try {
        res = await fetch(url, { cache: "no-cache" });
      } catch (_) {
        throw new Error(location.protocol === "file:"
          ? "Browsers block loading the demo file from file://. Use the live site or run a local server (python -m http.server)."
          : "Couldn't download the demo recording.");
      }
      if (!res.ok) throw new Error("Couldn't download the demo recording (HTTP " + res.status + ").");
      const { source, samples } = parseRecording(await res.text());
      this.samples = samples;
      this.source = source;
    }

    start() {
      if (!this.samples.length) return;
      this.playing = true;
      const t0 = this.samples[0].t;
      const duration = this.samples[this.samples.length - 1].t - t0;
      let i = 0;
      let start = performance.now();
      const step = (now) => {
        if (!this.playing) return;
        let elapsed = now - start;
        if (elapsed > duration) {  // loop the recording
          start = now;
          elapsed = 0;
          i = 0;
        }
        // Emit every sample whose timestamp has passed (100 Hz data, ~60 Hz frames).
        while (i < this.samples.length && this.samples[i].t - t0 <= elapsed) {
          this.onSample(this.samples[i]);
          i++;
        }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }

    stop() {
      this.playing = false;
      cancelAnimationFrame(this._raf);
    }
  }

  // Collects raw (un-tared, un-smoothed) samples and exports them as CSV.
  class Recorder {
    constructor() { this.rows = []; this.t0 = 0; this.active = false; }

    start() { this.rows = []; this.t0 = performance.now(); this.active = true; }

    add(s) {
      if (!this.active) return;
      this.rows.push([Math.round(performance.now() - this.t0), s.pitch, s.roll, s.yaw]);
    }

    stop() { this.active = false; return this.rows.length; }

    toCSV() {
      const head = [
        "# STM32 Flight Telemetry recording",
        "# source: hardware recording",
        "# recorded: " + new Date().toISOString(),
        "# columns: t_ms = milliseconds since start; pitch, roll, yaw in degrees",
        "t_ms,pitch,roll,yaw",
      ];
      const body = this.rows.map((r) => r[0] + "," + r.slice(1).map((v) => v.toFixed(2)).join(","));
      return head.concat(body).join("\n") + "\n";
    }

    download() {
      const blob = new Blob([this.toCSV()], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "flight-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }

  window.Telemetry = { SerialLink, DemoPlayer, Recorder, parseLine, parseRecording };
})();
