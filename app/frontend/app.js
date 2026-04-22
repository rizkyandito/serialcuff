const MAX_POINTS = 2000;

const els = {
  portSelect: document.getElementById("port-select"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnConnect: document.getElementById("btn-connect"),
  btnDisconnect: document.getElementById("btn-disconnect"),
  btnAllOff: document.getElementById("btn-all-off"),
  btnRecStart: document.getElementById("btn-record-start"),
  btnRecStop: document.getElementById("btn-record-stop"),
  recordStatus: document.getElementById("record-status"),
  connStatus: document.getElementById("conn-status"),
  log: document.getElementById("log"),
  ledPump: document.getElementById("led-pump"),
  ledValve1: document.getElementById("led-valve1"),
  ledValve2: document.getElementById("led-valve2"),
};

// plot data (ring buffer)
const xs = new Array(MAX_POINTS).fill(0).map((_, i) => i);
const raws = new Array(MAX_POINTS).fill(null);
const lpfs = new Array(MAX_POINTS).fill(null);
let sampleIdx = 0;

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
        range: (u, min, max) => {
          if (min == null || max == null) return [0, 1];
          const pad = Math.max((max - min) * 0.1, 1);
          return [min - pad, max + pad];
        },
      },
    },
    axes: [
      { label: "Sample", stroke: "#aaa", grid: { stroke: "#333" } },
      { label: "ADC",    stroke: "#aaa", grid: { stroke: "#333" }, values: (u, ticks) => ticks.map(fmtInt) },
    ],
    series: [
      {},
      { label: "Raw",    stroke: "#60a5fa", width: 1, value: (u, v) => fmtInt(v) },
      { label: "LPF 2Hz", stroke: "#f59e0b", width: 2, value: (u, v) => fmtInt(v) },
    ],
  },
  [xs, raws, lpfs],
  document.getElementById("plot"),
);

window.addEventListener("resize", () => {
  plot.setSize({ width: document.getElementById("plot").clientWidth, height: 360 });
});

// throttle plot redraw to ~30 fps (data comes in at 100 Hz)
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
  sampleIdx++;
  scheduleRedraw();
}

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  els.log.textContent += `[${ts}] ${msg}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function applyState(state) {
  els.connStatus.textContent = state.connected ? `connected: ${state.port}` : "disconnected";
  els.connStatus.className = "status " + (state.connected ? "on" : "off");

  els.ledPump.classList.toggle("on", !!state.pump);
  els.ledValve1.classList.toggle("on", !!state.valve1);
  els.ledValve2.classList.toggle("on", !!state.valve2);

  if (state.recording) {
    els.recordStatus.textContent = `recording → ${state.record_path}`;
    els.recordStatus.className = "on";
  } else {
    els.recordStatus.textContent = "not recording";
    els.recordStatus.className = "";
  }
}

// websocket
let ws = null;
function connectWS() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => log("WS connected");
  ws.onclose = () => { log("WS closed, retrying in 1s..."); setTimeout(connectWS, 1000); };
  ws.onerror = () => log("WS error");
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case "sample": pushSample(msg.raw, msg.lpf); break;
      case "log":    log(msg.msg); break;
      case "state":  applyState(msg.state); break;
    }
  };
}
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  else log("WS not open");
}

// port list
async function refreshPorts() {
  try {
    const res = await fetch("/api/ports");
    const { ports } = await res.json();
    els.portSelect.innerHTML = "";
    if (ports.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "(no ports found)";
      opt.value = "";
      els.portSelect.appendChild(opt);
    } else {
      ports.forEach((p) => {
        const opt = document.createElement("option");
        opt.textContent = p;
        opt.value = p;
        els.portSelect.appendChild(opt);
      });
    }
    log("Ports: " + (ports.join(", ") || "(none)"));
  } catch (e) {
    log("Refresh ports failed: " + e);
  }
}

// wire up controls
els.btnRefresh.addEventListener("click", refreshPorts);
els.btnConnect.addEventListener("click", () => {
  const port = els.portSelect.value;
  if (!port) { log("No port selected"); return; }
  send({ type: "connect", port });
});
els.btnDisconnect.addEventListener("click", () => send({ type: "disconnect" }));

document.querySelectorAll("button[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => send({ type: "cmd", cmd: btn.dataset.cmd }));
});

els.btnAllOff.addEventListener("click", () => send({ type: "all_off" }));
els.btnRecStart.addEventListener("click", () => send({ type: "record_start" }));
els.btnRecStop.addEventListener("click", () => send({ type: "record_stop" }));

// keyboard shortcut: spacebar = ALL OFF (emergency)
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") {
    e.preventDefault();
    send({ type: "all_off" });
    log("[hotkey] ALL OFF");
  }
});

// boot
refreshPorts();
connectWS();
