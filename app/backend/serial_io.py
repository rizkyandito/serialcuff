import asyncio
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

import serial
import serial.tools.list_ports


@dataclass
class Sample:
    t: float
    raw: float
    lpf: float


class SerialIO:
    def __init__(self, on_sample: Callable[[Sample], None], on_log: Callable[[str], None]):
        self.on_sample = on_sample
        self.on_log = on_log

        self._ser: Optional[serial.Serial] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._lock = threading.Lock()

        self._t0: float = 0.0

    @staticmethod
    def list_ports() -> list[str]:
        return [p.device for p in serial.tools.list_ports.comports()]

    def is_open(self) -> bool:
        return self._ser is not None and self._ser.is_open

    def connect(self, port: str, baudrate: int = 921600) -> None:
        if self.is_open():
            raise RuntimeError("Already connected")

        self._ser = serial.Serial(port, baudrate, timeout=0.1)
        time.sleep(1.5)  # let the board reset

        self._t0 = time.time()
        self._running = True
        self._thread = threading.Thread(target=self._reader_loop, daemon=True)
        self._thread.start()

        self.on_log(f"Connected to {port} @ {baudrate}")

    def disconnect(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None

        if self._ser:
            try:
                if self._ser.is_open:
                    self._ser.close()
            except Exception as e:
                self.on_log(f"Disconnect error: {e}")
            self._ser = None

        self.on_log("Disconnected")

    def send(self, cmd: str) -> None:
        with self._lock:
            if not self.is_open():
                raise RuntimeError("Not connected")
            self._ser.write((cmd + "\n").encode("utf-8"))
        self.on_log(f"Sent: {cmd}")

    def _reader_loop(self) -> None:
        while self._running and self._ser and self._ser.is_open:
            try:
                line = self._ser.readline().decode(errors="ignore").strip()
                if not line:
                    continue

                parts = line.split(",")
                if len(parts) == 3:
                    try:
                        t_ms = float(parts[0])
                        raw = float(parts[1])
                        lpf = float(parts[2])
                    except ValueError:
                        self.on_log(f"[device] {line}")
                        continue

                    sample = Sample(t=t_ms / 1000.0, raw=raw, lpf=lpf)
                    self.on_sample(sample)
                else:
                    self.on_log(f"[device] {line}")

            except Exception as e:
                self.on_log(f"Read error: {e}")
                break
