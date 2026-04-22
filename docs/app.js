const MAX_POINTS = 5000;

const els = {
  btnConnect: document.getElementById("btn-connect"),
  btnDisconnect: document.getElementById("btn-disconnect"),
  btnAllOff: document.getElementById("btn-all-off"),
  btnRecStart: document.getElementById("btn-record-start"),
  btnRecStop: document.getElementById("btn-record-stop"),
  btnPause: document.getElementById("btn-pause"),
  btnReset: document.getElementById("btn-reset"),
  recordStatus: document.getElementById("record-status"),
  connStatus: document.getElementById("conn-status"),
  browserWarn: document.getElementById("browser-warn"),
  plotMode: document.getElementById("plot-mode"),
  log: document.getElementById("log"),
  ledPump: document.getElementById("led-pump"),
  ledValve1: document.getElementById("led-valve1"),
  ledValve2: document.getElementById("led-valve2"),
};

const state = {
  port: null,
  reader: null,
  writer: null,
  pump: 0,
  valve1: 0,
  valve2: 0,
};

const xs = new Array(MAX_POINTS).fill(0).map((_, i) => i);
const raws = new Array(MAX_POINTS).fill(null);
const lpfs = new Array(MAX_POINTS).fill(null);

const fmtInt = (v) => (v == null ? "--" : Math.round(v).toString());

// view state — when paused, plot freezes scales until reset
const view = {
  paused: false,
  customX: null, // [min, max] when zoomed/panned
  customY: null,
};

function setMode(paused) {
  view.paused = paused;
  els.plotMode.textContent = paused ? "PAUSED" : "LIVE";
  els.plotMode.className = "pill " + (paused ? "paused" : "live");
  els.btnPause.textContent = paused ? "Resume" : "Pause";
}

function resetView() {
  view.customX = null;
  view.customY = null;
  setMode(false);
  redraw(true);
}

const plot = new uPlot(
  {
    width: document.getElementById("plot").clientWidth,
    height: 420,
    cursor: {
      drag: { x: true, y: false, uni: 30 },
      sync: { key: "cuff" },
    },
    scales: {
      x: {
        time: false,
        range: (u, dataMin, dataMax) => {
          if (view.customX) return view.customX;
          return [dataMin ?? 0, dataMax ?? 1];
        },
      },
      y: {
        auto: true,
        range: (u, dataMin, dataMax) => {
          if (view.customY) return view.customY;
          if (dataMin == null || dataMax == null) return [0, 1];
          const pad = Math.max((dataMax - dataMin) * 0.1, 1);
          return [dataMin - pad, dataMax + pad];
        },
      },
    },
    axes: [
      {
        label: "sample",
        labelSize: 14,
        labelFont: "10px var(--mono, monospace)",
        font: "10px var(--mono, monospace)",
        stroke: "#5b6573",
        ticks: { stroke: "#1f2630", width: 1 },
        grid: { stroke: "#1a212a", width: 1 },
      },
      {
        label: "ADC",
        labelSize: 14,
        labelFont: "10px var(--mono, monospace)",
        font: "10px var(--mono, monospace)",
        stroke: "#5b6573",
        ticks: { stroke: "#1f2630", width: 1 },
        grid: { stroke: "#1a212a", width: 1 },
        values: (_u, ticks) => ticks.map(fmtInt),
      },
    ],
    series: [
      { value: (_u, v) => fmtInt(v) },
      { label: "Raw",     stroke: "#06b6d4", width: 1, value: (_u, v) => fmtInt(v) },
      { label: "LPF 2Hz", stroke: "#f59e0b", width: 1.5, value: (_u, v) => fmtInt(v) },
    ],
    hooks: {
      // pause when user box-selects (zoom)
      setSelect: [(u) => {
        if (u.select.width > 0) {
          const xMin = u.posToVal(u.select.left, "x");
          const xMax = u.posToVal(u.select.left + u.select.width, "x");
          view.customX = [xMin, xMax];
          setMode(true);
        }
      }],
    },
  },
  [xs, raws, lpfs],
  document.getElementById("plot"),
);

window.addEventListener("resize", () => {
  plot.setSize({ width: document.getElementById("plot").clientWidth, height: 420 });
});

// ---- pan via drag (no shift) + wheel zoom ----
const plotEl = document.getElementById("plot");

let isPanning = false;
let panStart = null;

plotEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.shiftKey) return; // shift+drag = box-zoom (uPlot default)
  const rect = plot.over.getBoundingClientRect();
  const xVal = plot.posToVal(e.clientX - rect.left, "x");
  if (!Number.isFinite(xVal)) return;
  isPanning = true;
  panStart = { clientX: e.clientX, xVal, scale: { ...plot.scales.x } };
  setMode(true);
  e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
  if (!isPanning) return;
  const rect = plot.over.getBoundingClientRect();
  const dx = e.clientX - panStart.clientX;
  const xRange = plot.scales.x.max - plot.scales.x.min;
  const dxVal = (dx / rect.width) * xRange;
  view.customX = [panStart.scale.min - dxVal, panStart.scale.max - dxVal];
  redraw(true);
});

window.addEventListener("mouseup", () => {
  isPanning = false;
});

plotEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = plot.over.getBoundingClientRect();
  const xPos = e.clientX - rect.left;
  const xVal = plot.posToVal(xPos, "x");
  if (!Number.isFinite(xVal)) return;

  const xMin = plot.scales.x.min;
  const xMax = plot.scales.x.max;
  const factor = e.deltaY < 0 ? 0.8 : 1.25;
  const newMin = xVal - (xVal - xMin) * factor;
  const newMax = xVal + (xMax - xVal) * factor;
  view.customX = [newMin, newMax];
  setMode(true);
  redraw(true);
}, { passive: false });

plotEl.addEventListener("dblclick", (e) => {
  e.preventDefault();
  resetView();
});

// ---- redraw scheduler ----
let pendingRedraw = false;
function redraw(force) {
  if (force) {
    plot.setData([xs, raws, lpfs]);
    return;
  }
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
  if (!view.paused) redraw();
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

// ---- recording ----
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

// ---- serial ----
async function connect() {
  if (!("serial" in navigator)) { log("Web Serial not supported"); return; }
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
      ? `VID:${info.usbVendorId.toString(16).toUpperCase()} PID:${info.usbProductId.toString(16).toUpperCase()}`
      : "connected";
    setConnStatus(true, label);
    log("Connected: " + label);

    readLoop(port);
  } catch (e) {
    log("Connect failed: " + e.message);
  }
}

async function disconnect() {
  if (!state.port) return;
  try {
    if (state.reader) { await state.reader.cancel(); state.reader = null; }
    if (state.writer) { try { await state.writer.close(); } catch {} state.writer = null; }
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
els.btnPause.addEventListener("click", () => setMode(!view.paused));
els.btnReset.addEventListener("click", resetView);

document.querySelectorAll("button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => sendCmd(btn.dataset.cmd));
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT" && e.target.tagName !== "BUTTON") {
    e.preventDefault();
    allOff();
    log("[hotkey] ALL OFF");
  }
});

if (!("serial" in navigator)) {
  els.browserWarn.style.display = "";
  els.btnConnect.disabled = true;
  log("Web Serial API tidak tersedia. Pakai Chrome atau Edge.");
}

setMode(false);
