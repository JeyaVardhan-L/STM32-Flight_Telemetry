// Run with: node --test   (from the repository root)
// Tests the browser-side parser and recorder in web/telemetry.js without a browser.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

global.window = {};
global.navigator = {};
global.location = { protocol: "http:" };
let fakeNow = 0;
global.performance = { now: () => fakeNow };
require("../web/telemetry.js");
const { parseLine, parseRecording, Recorder } = window.Telemetry;

test("parses a firmware data line, tolerating CRLF", () => {
  assert.deepStrictEqual(parseLine("1.25,-0.40,12.00\r"), { pitch: 1.25, roll: -0.4, yaw: 12 });
});

test("treats '#' lines as device status messages", () => {
  assert.deepStrictEqual(parseLine("# Ready - firmware v2"), { message: "Ready - firmware v2" });
});

test("rejects malformed lines", () => {
  for (const bad of ["", "1,2", "1,2,3,4", "1.2,abc,3", ",,", "12.3,,", "1,2,3x", "nan,1,2"]) {
    assert.strictEqual(parseLine(bad), null, JSON.stringify(bad));
  }
});

test("the bundled demo recording parses and is labelled", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "demo", "flight.csv"), "utf8");
  const { source, samples } = parseRecording(text);
  assert.ok(source.length > 0);
  assert.ok(samples.length > 100);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].t >= samples[i - 1].t, "timestamps increase");
});

test("Recorder output round-trips through parseRecording", () => {
  const rec = new Recorder();
  fakeNow = 0; rec.start();
  rec.add({ pitch: 1, roll: 2, yaw: 3 });
  fakeNow = 10; rec.add({ pitch: 1.5, roll: -2.25, yaw: 179.99 });
  rec.stop();
  const { source, samples } = parseRecording(rec.toCSV());
  assert.strictEqual(source, "hardware recording");
  assert.deepStrictEqual(samples[1], { t: 10, pitch: 1.5, roll: -2.25, yaw: 179.99 });
});

test("a recording needs at least two samples", () => {
  assert.throws(() => parseRecording("t_ms,pitch,roll,yaw\n0,1,2,3\n"), /at least 2/);
});
