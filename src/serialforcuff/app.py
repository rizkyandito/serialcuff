from __future__ import annotations

import queue
import time
import tkinter as tk
from collections import deque
from tkinter import ttk

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
from serial.tools import list_ports

from serialforcuff.serial_reader import SerialReader


class SerialPlotterApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Serial Plotter - Cuff")
        self.root.geometry("980x620")

        self.reader: SerialReader | None = None
        self.data_queue: queue.Queue[tuple[float, str]] = queue.Queue()

        self.max_points = 300
        self.values = deque(maxlen=self.max_points)
        self.times = deque(maxlen=self.max_points)

        self.port_var = tk.StringVar()
        self.baud_var = tk.StringVar(value="115200")
        self.command_var = tk.StringVar()
        self.status_var = tk.StringVar(value="Status: idle")

        self._build_ui()
        self.refresh_ports()
        self._schedule_queue_poll()

    def _build_ui(self) -> None:
        top = ttk.Frame(self.root, padding=10)
        top.pack(fill=tk.X)

        ttk.Label(top, text="Port").pack(side=tk.LEFT)
        self.port_box = ttk.Combobox(top, textvariable=self.port_var, width=24, state="readonly")
        self.port_box.pack(side=tk.LEFT, padx=(6, 10))

        ttk.Button(top, text="Refresh", command=self.refresh_ports).pack(side=tk.LEFT)

        ttk.Label(top, text="Baud").pack(side=tk.LEFT, padx=(12, 0))
        ttk.Entry(top, textvariable=self.baud_var, width=10).pack(side=tk.LEFT, padx=(6, 10))

        ttk.Button(top, text="Connect", command=self.connect).pack(side=tk.LEFT)
        ttk.Button(top, text="Disconnect", command=self.disconnect).pack(side=tk.LEFT, padx=(6, 0))

        mid = ttk.Frame(self.root, padding=(10, 0, 10, 0))
        mid.pack(fill=tk.BOTH, expand=True)

        fig = Figure(figsize=(8, 4), dpi=100)
        self.ax = fig.add_subplot(111)
        self.ax.set_title("Real-time Serial Data")
        self.ax.set_xlabel("Time (s)")
        self.ax.set_ylabel("Value")
        self.line, = self.ax.plot([], [], linewidth=1.5)

        self.canvas = FigureCanvasTkAgg(fig, master=mid)
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)

        bottom = ttk.Frame(self.root, padding=10)
        bottom.pack(fill=tk.X)

        ttk.Label(bottom, text="Command").pack(side=tk.LEFT)
        ttk.Entry(bottom, textvariable=self.command_var, width=30).pack(side=tk.LEFT, padx=(6, 8))
        ttk.Button(bottom, text="Send", command=self.send_manual_command).pack(side=tk.LEFT)

        ttk.Button(bottom, text="Run Tool Algorithm", command=self.run_tool_algorithm).pack(
            side=tk.LEFT, padx=(12, 0)
        )

        ttk.Label(self.root, textvariable=self.status_var, anchor="w").pack(fill=tk.X, padx=10, pady=(0, 8))

    def refresh_ports(self) -> None:
        ports = [p.device for p in list_ports.comports()]
        self.port_box["values"] = ports
        if ports:
            self.port_var.set(ports[0])
            self.status_var.set(f"Status: {len(ports)} port ditemukan")
        else:
            self.port_var.set("")
            self.status_var.set("Status: tidak ada port")

    def connect(self) -> None:
        if self.reader and self.reader.is_running:
            self.status_var.set("Status: sudah connect")
            return

        port = self.port_var.get().strip()
        if not port:
            self.status_var.set("Status: pilih port dulu")
            return

        try:
            baudrate = int(self.baud_var.get())
        except ValueError:
            self.status_var.set("Status: baudrate invalid")
            return

        try:
            self.reader = SerialReader(
                port=port,
                baudrate=baudrate,
                on_data=self._on_data,
                on_error=self._on_error,
            )
            self.reader.start()
            self.status_var.set(f"Status: connected ke {port} @ {baudrate}")
        except Exception as exc:
            self.status_var.set(f"Status: gagal connect ({exc})")

    def disconnect(self) -> None:
        if self.reader:
            self.reader.stop()
        self.reader = None
        self.status_var.set("Status: disconnected")

    def send_manual_command(self) -> None:
        payload = self.command_var.get().strip()
        if not payload:
            self.status_var.set("Status: command kosong")
            return

        self._send_command(payload)

    def run_tool_algorithm(self) -> None:
        # Placeholder strategi kontrol: ganti fungsi ini dengan algoritmamu.
        if not self.values:
            self.status_var.set("Status: belum ada data sensor")
            return

        latest = self.values[-1]
        cmd = "PUMP_ON" if latest < 100 else "PUMP_OFF"
        self._send_command(cmd)
        self.status_var.set(f"Status: algorithm kirim -> {cmd} (latest={latest:.2f})")

    def _send_command(self, payload: str) -> None:
        try:
            if self.reader is None or not self.reader.is_running:
                self.status_var.set("Status: belum connect")
                return

            self.reader.send(payload)
            self.status_var.set(f"Status: command terkirim -> {payload}")
        except Exception as exc:
            self.status_var.set(f"Status: gagal kirim ({exc})")

    def _on_data(self, value: float, raw_line: str) -> None:
        self.data_queue.put((value, raw_line))

    def _on_error(self, message: str) -> None:
        self.status_var.set(f"Status: {message}")

    def _schedule_queue_poll(self) -> None:
        self._drain_data_queue()
        self.root.after(50, self._schedule_queue_poll)

    def _drain_data_queue(self) -> None:
        dirty = False

        while True:
            try:
                value, _raw = self.data_queue.get_nowait()
            except queue.Empty:
                break

            now = time.time()
            self.values.append(value)
            self.times.append(now)
            dirty = True

        if dirty:
            self._redraw_plot()

    def _redraw_plot(self) -> None:
        if not self.values:
            return

        base = self.times[0]
        x = [t - base for t in self.times]
        y = list(self.values)

        self.line.set_data(x, y)
        self.ax.relim()
        self.ax.autoscale_view()
        self.canvas.draw_idle()


def run_app() -> None:
    root = tk.Tk()
    app = SerialPlotterApp(root)

    def _on_close() -> None:
        app.disconnect()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", _on_close)
    root.mainloop()
