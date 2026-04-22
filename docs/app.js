const MAX_POINTS = 2000;

const els = {
  btnConnect: document.getElementById("btn-connect"),
  btnDisconnect: document.getElementById("btn-disconnect"),
  btnAllOff: document.getElementById("btn-all-off"),
  btnRecStart: document.getElementById("btn-record-start"),
  btnRecStop: document.getElementById("btn-record-stop"),
  recordStatus: document.getElementById("record-status"),
  connStatus: document.getElementById("conn-status"),
  browserWarn: document.getElementById("browser-warn"),
  log: document.getElementById("log"),
  ledPump: document.getElementById("led-pump"),
  ledValve1: document.getElementById("led-valve1"),
  ledValve2: document.getElementById("led-valve2"),
};

const state = {
  port: null,
  reader: null,
  writer: null,
  readLoopAbort: null,
  pump: 0,
  valve1: 0,
  valve2: 0,
};

const xs = new Array(MAX_POINTS).fill(0).map((_, i) => i);
const raws = new Array(MAX_POINTS).fill(null);
const lpfs = new Array(MAX_POINTS).fill(null);

const fmtInt = (v) => (v == null ? "--" : Math.round(v).toString());

const plot = new uPlot(
  {
    width: document.getElementById("plot").clientWidth,
    height: 360,
    title: "A0 Live Plot",
    scales: {
      x: { time: false },
      y: {
        auto: true,
        range: (_u, min, max) => {
          if (min == null || max == null) return [0, 1];
          const pad = Math.max((max - min) * 0.1, 1);
          return [min - pad, max + pad];
        },
      },
    },
    axes: [
      { label: "Sample", stroke: "#aaa", grid: { stroke: "#333" } },
      { label: "ADC",    stroke: "#aaa", grid: { stroke: "#333" }, values: (_u, ticks) => ticks.map(fmtInt) },
    ],
    series: [
      {},
      { label: "Raw",     stroke: "#60a5fa", width: 1, value: (_u, v) => fmtInt(v) },
      { label: "LPF 2Hz", stroke: "#f59e0b", width: 2, value: (_u, v) => fmtInt(v) },
    ],
  },
  [xs, raws, lpfs],
  document.getElementById("plot"),
);

window.addEventListener("resize", () => {
  plot.setSize({ width: document.getElementById("plot").clientWidth, height: 360 });
});

let pendingRedraw = false;
function scheduleRedraw() {
  if (pendingRedraw) return;
  pendingRedraw = true;
  setTimeout(() => {
    pendingRedraw = false;
    plot.setData([xs, raws, lpfs]);
  }, 33);
}

function pushSample(raw, lpf) {
  raws.shift(); raws.push(raw);
  lpfs.shift(); lpfs.push(lpf);
  scheduleRedraw();
}

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  els.log.textContent += `[${ts}] ${msg}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function setConnStatus(connected, label) {
  els.connStatus.textContent = connected ? (label || "connected") : "disconnected";
  els.connStatus.className = "status " + (connected ? "on" : "off");
}

function setLed(key, on) {
  state[key] = on ? 1 : 0;
  const el = key === "pump" ? els.ledPump : key === "valve1" ? els.ledValve1 : els.ledValve2;
  el.classList.toggle("on", !!on);
}

// ---- recording (in-memory, download on stop) ----
const recording = {
  active: false,
  t0Ms: 0,
  rows: [],
};

function startRecording() {
  if (recording.active) { log("Already recording"); return; }
  recording.rows = [];
  recording.t0Ms = performance.now();
  recording.active = true;
  els.recordStatus.textContent = "recording...";
  els.recordStatus.className = "on";
  log("Recording started");
}

function stopRecording() {
  if (!recording.active) { log("Not recording"); return; }
  recording.active = false;
  els.recordStatus.textContent = "not recording";
  els.recordStatus.className = "";

  if (recording.rows.length === 0) {
    log("No samples recorded");
    return;
  }

  const header = "t_seconds,raw,lpf,pump,valve1,valve2\n";
  const body = recording.rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([header, body, "\n"], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const a = document.createElement("a");
  a.href = url;
  a.download = `record_${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  log(`Saved ${recording.rows.length} samples`);
}

function recordSample(raw, lpf) {
  if (!recording.active) return;
  const t = (performance.now() - recording.t0Ms) / 1000;
  recording.rows.push([t.toFixed(4), raw, lpf, state.pump, state.valve1, state.valve2]);
}

// ---- serial (Web Serial API) ----
async function connect() {
  if (!("serial" in navigator)) {
    log("Web Serial not supported in this browser");
    return;
  }
  if (state.port) { log("Already connected"); return; }

  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 921600 });
    state.port = port;

    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(port.writable);
    state.writer = encoder.writable.getWriter();

    const info = port.getInfo();
    const label = info.usbVendorId
      ? `connected (VID:${info.usbVendorId.toString(16)} PID:${info.usbProductId.toString(16)})`
      : "connected";
    setConnStatus(true, label);
    log(label);

    readLoop(port);
  } catch (e) {
    log("Connect failed: " + e.message);
  }
}

async function disconnect() {
  if (!state.port) return;
  try {
    if (state.reader) {
      await state.reader.cancel();
      state.reader = null;
    }
    if (state.writer) {
      try { await state.writer.close(); } catch {}
      state.writer = null;
    }
    try { await state.port.close(); } catch {}
  } catch (e) {
    log("Disconnect error: " + e.message);
  }
  state.port = null;
  setConnStatus(false);
  log("Disconnected");
}

async function readLoop(port) {
  const decoder = new TextDecoderStream();
  const closed = port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  state.reader = reader;

  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      buf += value;

      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "").trim();
        buf = buf.slice(nl + 1);
        handleLine(line);
      }
    }
  } catch (e) {
    log("Read error: " + e.message);
  } finally {
    try { reader.releaseLock(); } catch {}
    await closed;
  }
}

function handleLine(line) {
  if (!line) return;
  const parts = line.split(",");
  if (parts.length === 3) {
    const t = parseFloat(parts[0]);
    const raw = parseFloat(parts[1]);
    const lpf = parseFloat(parts[2]);
    if (Number.isFinite(t) && Number.isFinite(raw) && Number.isFinite(lpf)) {
      pushSample(raw, lpf);
      recordSample(raw, lpf);
      return;
    }
  }
  log("[device] " + line);
}

async function send(cmd) {
  if (!state.writer) { log("Not connected"); return; }
  try {
    await state.writer.write(cmd + "\n");
    log("Sent: " + cmd);
  } catch (e) {
    log("Send failed: " + e.message);
  }
}

const CMD_STATE = {
  p1: ["pump", 1], p0: ["pump", 0],
  q1: ["valve1", 1], q0: ["valve1", 0],
  r1: ["valve2", 1], r0: ["valve2", 0],
};

async function sendCmd(cmd) {
  await send(cmd);
  const [key, val] = CMD_STATE[cmd] || [];
  if (key) setLed(key, val);
}

async function allOff() {
  for (const c of ["p0", "q0", "r0"]) await sendCmd(c);
}

// ---- wire up ----
els.btnConnect.addEventListener("click", connect);
els.btnDisconnect.addEventListener("click", disconnect);
els.btnAllOff.addEventListener("click", allOff);
els.btnRecStart.addEventListener("click", startRecording);
els.btnRecStop.addEventListener("click", stopRecording);

document.querySelectorAll("button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => sendCmd(btn.dataset.cmd));
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") {
    e.preventDefault();
    allOff();
    log("[hotkey] ALL OFF");
  }
});

// ---- browser check ----
if (!("serial" in navigator)) {
  els.browserWarn.style.display = "";
  els.btnConnect.disabled = true;
  log("Web Serial API tidak tersedia. Pakai Chrome atau Edge.");
}
