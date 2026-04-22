import asyncio
import json
import os
from pathlib import Path
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from recorder import Recorder
from serial_io import Sample, SerialIO


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
RECORDINGS_DIR = BASE_DIR / "recordings"

app = FastAPI()

clients: Set[WebSocket] = set()
loop: asyncio.AbstractEventLoop = None  # set on startup

# device state (authoritative in backend)
state = {
    "connected": False,
    "port": None,
    "pump": 0,
    "valve1": 0,
    "valve2": 0,
    "recording": False,
    "record_path": None,
}

recorder = Recorder(str(RECORDINGS_DIR))


def broadcast_threadsafe(msg: dict) -> None:
    if loop is None:
        return
    asyncio.run_coroutine_threadsafe(_broadcast(msg), loop)


async def _broadcast(msg: dict) -> None:
    dead = []
    text = json.dumps(msg)
    for ws in list(clients):
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


def on_sample(sample: Sample) -> None:
    # write to CSV if recording
    if recorder.is_recording():
        recorder.write(
            sample.t, sample.raw, sample.lpf,
            state["pump"], state["valve1"], state["valve2"],
        )
    broadcast_threadsafe({
        "type": "sample",
        "t": sample.t,
        "raw": sample.raw,
        "lpf": sample.lpf,
    })


def on_log(msg: str) -> None:
    broadcast_threadsafe({"type": "log", "msg": msg})


serial_io = SerialIO(on_sample=on_sample, on_log=on_log)


def push_state() -> None:
    broadcast_threadsafe({"type": "state", "state": state})


@app.on_event("startup")
async def on_startup():
    global loop
    loop = asyncio.get_running_loop()


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/api/ports")
async def api_ports():
    return {"ports": SerialIO.list_ports()}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        await ws.send_text(json.dumps({"type": "state", "state": state}))
        while True:
            text = await ws.receive_text()
            try:
                msg = json.loads(text)
            except Exception:
                continue
            await handle_message(msg)
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


# command -> state-key / value pairs used to update local state
CMD_STATE = {
    "p1": ("pump", 1),
    "p0": ("pump", 0),
    "q1": ("valve1", 1),
    "q0": ("valve1", 0),
    "r1": ("valve2", 1),
    "r0": ("valve2", 0),
}


async def handle_message(msg: dict) -> None:
    t = msg.get("type")

    if t == "connect":
        port = msg.get("port")
        if not port:
            on_log("connect: no port")
            return
        if serial_io.is_open():
            serial_io.disconnect()
            state["connected"] = False
            state["port"] = None
        try:
            serial_io.connect(port)
            state["connected"] = True
            state["port"] = port
            push_state()
        except Exception as e:
            on_log(f"Connect failed: {e}")

    elif t == "disconnect":
        try:
            serial_io.disconnect()
        finally:
            state["connected"] = False
            state["port"] = None
            push_state()

    elif t == "cmd":
        cmd = msg.get("cmd", "")
        if cmd not in CMD_STATE:
            on_log(f"Unknown cmd: {cmd}")
            return
        try:
            serial_io.send(cmd)
            key, val = CMD_STATE[cmd]
            state[key] = val
            push_state()
        except Exception as e:
            on_log(f"Send failed: {e}")

    elif t == "all_off":
        for c in ("p0", "q0", "r0"):
            try:
                serial_io.send(c)
                key, val = CMD_STATE[c]
                state[key] = val
            except Exception as e:
                on_log(f"Send failed: {e}")
        push_state()

    elif t == "record_start":
        if recorder.is_recording():
            on_log("Already recording")
            return
        try:
            path = recorder.start()
            state["recording"] = True
            state["record_path"] = os.path.basename(path)
            on_log(f"Recording to {os.path.basename(path)}")
            push_state()
        except Exception as e:
            on_log(f"Record start failed: {e}")

    elif t == "record_stop":
        path = recorder.stop()
        state["recording"] = False
        state["record_path"] = None
        if path:
            on_log(f"Recording saved: {os.path.basename(path)}")
        push_state()

    else:
        on_log(f"Unknown message: {t}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
