/* Dashboard glue: 3D view, charts, controls and state. */
(function () {
  "use strict";

  const { SerialLink, DemoPlayer, Recorder } = window.Telemetry;
  const DEMO_URL = "demo/flight.csv";
  const SMOOTH_ALPHA = 0.45;       // EMA weight used when "Smooth" is on
  const CHART_POINTS = 240;        // ~2.4 s of history at 100 Hz
  const STALE_MS = 2000;           // no data for this long while connected = waiting
  const DEG = Math.PI / 180;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (id) => document.getElementById(id);
  const ui = {
    dot: $("statusDot"), msg: $("statusMsg"), rate: $("rate"), count: $("count"),
    model: $("modelSelect"), connect: $("btnConnect"), tare: $("btnTare"),
    demo: $("btnDemo"), emptyDemo: $("emptyDemo"), emptyConnect: $("emptyConnect"),
    smooth: $("btnSmooth"), record: $("btnRecord"),
    empty: $("emptyState"), emptyNote: $("emptyNote"),
    tagSource: $("tagSource"), tagTare: $("tagTare"),
    viewport: $("viewport"),
    values: { pitch: $("valPitch"), roll: $("valRoll"), yaw: $("valYaw") },
  };

  const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

  // ---------------- state ----------------
  const state = {
    source: "idle",           // idle | serial | demo
    offset: { pitch: 0, roll: 0, yaw: 0 },
    needsTare: true,
    tared: false,
    smooth: false,
    out: { pitch: 0, roll: 0, yaw: 0 },  // what is displayed
    dirty: false,
    total: 0,
    times: [],                // sample arrival times for the rate meter
    lastSampleAt: 0,
  };
  let waitingShown = false;   // whether the "waiting for data" hint is currently shown

  // ---------------- 3D scene ----------------
  const scene = new THREE.Scene();
  const grid = new THREE.GridHelper(40, 40, 0x34343a, 0x1c1c1f);
  grid.position.y = -3;
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  ui.viewport.prepend(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xf7f8f8, 0x08090a, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(5, 10, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35);
  rim.position.set(-6, 3, -8);
  scene.add(rim);

  let model = Models.create(ui.model.value);
  scene.add(model);

  ui.model.addEventListener("change", () => {
    const rot = model.rotation.clone();
    scene.remove(model);
    Models.dispose(model);
    model = Models.create(ui.model.value);
    model.rotation.copy(rot);
    scene.add(model);
  });

  function resize() {
    const { width, height } = ui.viewport.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(ui.viewport);
  resize();

  // ---------------- charts ----------------
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = "#62666d";

  function makeChart(canvasId, range) {
    return new Chart($(canvasId), {
      type: "line",
      data: {
        labels: Array(CHART_POINTS).fill(""),
        datasets: [{
          data: Array(CHART_POINTS).fill(null),
          borderColor: "#f7f8f8",
          borderWidth: 1.5,
          backgroundColor: "rgba(247, 248, 248, 0.04)",
          fill: "origin",
          pointRadius: 0,
          tension: 0.3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        events: [],
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: {
            suggestedMin: -range, suggestedMax: range,
            border: { display: false },
            grid: { color: (c) => (c.tick.value === 0 ? "#34343a" : "transparent"), drawTicks: false },
            ticks: { display: false },
          },
        },
      },
    });
  }

  const charts = { pitch: makeChart("chartPitch", 90), roll: makeChart("chartRoll", 90), yaw: makeChart("chartYaw", 180) };

  function drawReadouts() {
    for (const axis of ["pitch", "roll", "yaw"]) {
      const data = charts[axis].data.datasets[0].data;
      const prev = data[data.length - 1];
      // Break the line at a +/-180 wrap instead of drawing a vertical spike.
      if (prev != null && Math.abs(state.out[axis] - prev) > 180) { data.push(null); data.shift(); }
      data.push(state.out[axis]);
      data.shift();
      charts[axis].update("none");
      ui.values[axis].textContent = (state.out[axis] >= 0 ? "+" : "") + state.out[axis].toFixed(1) + "°";
    }
  }

  // ---------------- sample pipeline ----------------
  const recorder = new Recorder();

  function onSample(raw) {
    if (state.source === "serial") recorder.add(raw);

    if (state.needsTare) {
      state.offset = { pitch: raw.pitch, roll: raw.roll, yaw: raw.yaw };
      state.out = { pitch: 0, roll: 0, yaw: 0 };
      state.needsTare = false;
    }
    for (const axis of ["pitch", "roll", "yaw"]) {
      const v = wrap180(raw[axis] - state.offset[axis]);
      state.out[axis] = state.smooth
        ? wrap180(state.out[axis] + SMOOTH_ALPHA * wrap180(v - state.out[axis]))
        : v;
    }
    const now = performance.now();
    state.lastSampleAt = now;
    state.times.push(now);
    state.total++;
    state.dirty = true;
  }

  // ---------------- render loop ----------------
  function frame() {
    requestAnimationFrame(frame);
    if (state.source === "idle") {
      if (!reducedMotion) { model.rotation.y += 0.003; model.rotation.x = Math.sin(performance.now() / 3000) * 0.15; }
    } else {
      // Same axis mapping as v1: pitch -> X, roll -> -Z, yaw -> Y (rotation order YXZ).
      model.rotation.set(state.out.pitch * DEG, state.out.yaw * DEG, -state.out.roll * DEG);
    }
    if (state.dirty) { drawReadouts(); state.dirty = false; }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // Rate meter + "waiting for data" detection.
  setInterval(() => {
    const now = performance.now();
    while (state.times.length && now - state.times[0] > 1000) state.times.shift();
    ui.rate.textContent = state.source === "idle" ? "— Hz" : state.times.length + " Hz";
    ui.count.textContent = state.total.toLocaleString() + " samples";
    if (state.source === "serial") {
      const stale = now - state.lastSampleAt > STALE_MS;
      setDot(stale ? "waiting" : "live");
      if (stale && !waitingShown) {
        setStatus("Connected, waiting for data. Check the TX/RX wiring, the shared GND and that the board is powered.");
        waitingShown = true;
      } else if (!stale && waitingShown) {
        setStatus("Receiving live telemetry at 115200 baud.");
        waitingShown = false;
      }
    }
    if (recorder.active) ui.record.textContent = "Stop · " + recorder.rows.length;
  }, 500);

  // ---------------- UI helpers ----------------
  function setStatus(text) { ui.msg.textContent = text; }
  function setDot(s) { ui.dot.dataset.state = s; }

  function setSource(src, label) {
    state.source = src;
    state.needsTare = true;
    state.total = 0;
    state.times = [];
    state.lastSampleAt = performance.now();
    waitingShown = false;
    ui.empty.hidden = src !== "idle";
    ui.tare.disabled = src === "idle";
    ui.record.disabled = src !== "serial";
    ui.connect.textContent = src === "serial" ? "Disconnect" : "Connect device";
    ui.demo.textContent = src === "demo" ? "Stop demo" : "Play demo";
    ui.tagSource.textContent = label || "";
    ui.tagTare.textContent = "";
    setDot(src === "idle" ? "idle" : src === "demo" ? "demo" : "waiting");
    if (src === "idle") {
      for (const axis of ["pitch", "roll", "yaw"]) {
        charts[axis].data.datasets[0].data.fill(null);
        charts[axis].update("none");
        ui.values[axis].textContent = "0.0°";
      }
    }
  }

  // ---------------- serial ----------------
  const link = new SerialLink({
    onSample,
    onMessage: (m) => setStatus("Device: " + m),
    onClose: () => {
      if (recorder.active) finishRecording();
      setSource("idle");
      setStatus("Disconnected.");
    },
  });

  async function connect() {
    if (state.source === "serial") { await link.disconnect(); return; }
    if (state.source === "demo") stopDemo();
    try {
      setStatus("Choose the Arduino/USB-serial port in the browser dialog…");
      await link.connect();
      setSource("serial", "LIVE · 115200 BAUD");
      setStatus("Connected. Waiting for the first sample…");
    } catch (err) {
      setStatus(err.name === "NotFoundError" ? "No port selected." : err.message);
    }
  }

  // ---------------- demo ----------------
  const demo = new DemoPlayer({ onSample });

  async function startDemo() {
    if (state.source === "serial") return;
    try {
      setStatus("Loading demo recording…");
      if (!demo.samples.length) await demo.load(DEMO_URL);
      const simulated = /simulat/i.test(demo.source);
      setSource("demo", "DEMO · " + demo.source.toUpperCase());
      setStatus(simulated
        ? "Playing simulated demo data (not a hardware recording). Connect a board for live telemetry."
        : "Playing a recording captured from the real hardware.");
      demo.start();
    } catch (err) {
      setStatus(err.message);
    }
  }

  function stopDemo() {
    demo.stop();
    setSource("idle");
    setStatus("Demo stopped.");
  }

  // ---------------- recording ----------------
  function finishRecording() {
    const n = recorder.stop();
    ui.record.textContent = "Record";
    ui.record.setAttribute("aria-pressed", "false");
    if (n > 0) { recorder.download(); setStatus("Saved " + n + " samples to CSV."); }
  }

  // ---------------- wiring ----------------
  ui.connect.addEventListener("click", connect);
  ui.emptyConnect.addEventListener("click", connect);
  ui.demo.addEventListener("click", () => (state.source === "demo" ? stopDemo() : startDemo()));
  ui.emptyDemo.addEventListener("click", startDemo);

  ui.tare.addEventListener("click", () => {
    state.needsTare = true;
    ui.tagTare.textContent = "TARED";
  });

  ui.smooth.addEventListener("click", () => {
    state.smooth = !state.smooth;
    ui.smooth.setAttribute("aria-pressed", String(state.smooth));
  });

  ui.record.addEventListener("click", () => {
    if (recorder.active) { finishRecording(); return; }
    recorder.start();
    ui.record.setAttribute("aria-pressed", "true");
    setStatus("Recording raw samples… click Stop to save a CSV.");
  });

  // ---------------- initial state ----------------
  setSource("idle");
  if (!SerialLink.supported) {
    ui.connect.disabled = true;
    ui.emptyConnect.disabled = true;
    ui.connect.title = "Web Serial is not available in this browser";
    ui.emptyNote.textContent = "This browser doesn't support Web Serial, so live hardware needs desktop Chrome or Edge. The demo works everywhere.";
    setStatus("Web Serial not supported here. Demo mode is available.");
  } else {
    setStatus("Ready. Connect a board or play the demo.");
  }
  // index.html?demo starts the demo straight away (used by the README link).
  if (new URLSearchParams(location.search).has("demo")) startDemo();
})();
