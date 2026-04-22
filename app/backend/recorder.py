import csv
import os
import threading
from datetime import datetime
from typing import Optional


class Recorder:
    def __init__(self, out_dir: str):
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)

        self._file = None
        self._writer: Optional[csv.writer] = None
        self._lock = threading.Lock()
        self._path: Optional[str] = None

    def is_recording(self) -> bool:
        return self._file is not None

    def start(self) -> str:
        with self._lock:
            if self._file is not None:
                raise RuntimeError("Already recording")

            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            path = os.path.join(self.out_dir, f"record_{ts}.csv")
            self._file = open(path, "w", newline="", buffering=1)
            self._writer = csv.writer(self._file)
            self._writer.writerow(["t_seconds", "raw", "lpf", "pump", "valve1", "valve2"])
            self._path = path
            return path

    def write(self, t: float, raw: float, lpf: float, pump: int, valve1: int, valve2: int) -> None:
        with self._lock:
            if self._writer is None:
                return
            self._writer.writerow([f"{t:.4f}", raw, lpf, pump, valve1, valve2])

    def stop(self) -> Optional[str]:
        with self._lock:
            if self._file is None:
                return None
            self._file.close()
            self._file = None
            self._writer = None
            path = self._path
            self._path = None
            return path
