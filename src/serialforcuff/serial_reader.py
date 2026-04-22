from __future__ import annotations

import threading
from typing import Callable, Optional

import serial


class SerialReader:
    """Read line-based numeric data from a serial port in a background thread."""

    def __init__(
        self,
        port: str,
        baudrate: int,
        on_data: Callable[[float, str], None],
        on_error: Optional[Callable[[str], None]] = None,
    ) -> None:
        self._port = port
        self._baudrate = baudrate
        self._on_data = on_data
        self._on_error = on_error

        self._serial: Optional[serial.Serial] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.is_running:
            return

        self._stop_event.clear()
        self._serial = serial.Serial(self._port, self._baudrate, timeout=0.25)
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None

        if self._serial is not None:
            self._serial.close()
            self._serial = None

    def send(self, payload: str) -> None:
        if self._serial is None or not self._serial.is_open:
            raise RuntimeError("Serial belum terkoneksi")

        self._serial.write((payload + "\n").encode("utf-8", errors="ignore"))

    def _read_loop(self) -> None:
        assert self._serial is not None

        while not self._stop_event.is_set():
            try:
                raw = self._serial.readline()
                if not raw:
                    continue

                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                # Format default: angka tunggal per baris, contoh: 123.4
                value = float(line.split(",")[0])
                self._on_data(value, line)
            except ValueError:
                if self._on_error is not None:
                    self._on_error("Data bukan angka, dilewati")
            except Exception as exc:  # pragma: no cover
                if self._on_error is not None:
                    self._on_error(f"Error serial: {exc}")
                break
