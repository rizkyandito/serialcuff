import tkinter as tk
from tkinter import messagebox
import serial
import serial.tools.list_ports
from collections import deque
import threading
import time

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure


BAUDRATE = 921600
MAX_POINTS = 1000


class SerialControlGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Black Pill Pump / Valve / A0 Monitor")

        self.ser = None
        self.running = False
        self.reader_thread = None

        # raw and filtered data buffers
        self.raw_data = deque([0] * MAX_POINTS, maxlen=MAX_POINTS)
        self.lpf_data = deque([0] * MAX_POINTS, maxlen=MAX_POINTS)

        self.build_ui()
        self.refresh_ports()
        self.update_plot()

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def build_ui(self):
        top = tk.Frame(self.root, padx=10, pady=10)
        top.pack(fill="x")

        tk.Label(top, text="Serial Port:").pack(side="left")

        self.port_var = tk.StringVar()
        self.port_menu = tk.OptionMenu(top, self.port_var, "")
        self.port_menu.pack(side="left", padx=5)

        tk.Button(top, text="Refresh", command=self.refresh_ports).pack(side="left", padx=5)
        tk.Button(top, text="Connect", command=self.connect_serial).pack(side="left", padx=5)
        tk.Button(top, text="Disconnect", command=self.disconnect_serial).pack(side="left", padx=5)

        controls = tk.Frame(self.root, padx=10, pady=10)
        controls.pack(fill="x")

        pump_frame = tk.LabelFrame(controls, text="Pump", padx=10, pady=10)
        pump_frame.grid(row=0, column=0, padx=10, pady=5)
        tk.Button(pump_frame, text="Pump ON", width=12, command=lambda: self.send_cmd("p1")).pack(pady=4)
        tk.Button(pump_frame, text="Pump OFF", width=12, command=lambda: self.send_cmd("p0")).pack(pady=4)

        valve1_frame = tk.LabelFrame(controls, text="Valve 1 (q)", padx=10, pady=10)
        valve1_frame.grid(row=0, column=1, padx=10, pady=5)
        tk.Button(valve1_frame, text="Valve1 ON", width=12, command=lambda: self.send_cmd("q1")).pack(pady=4)
        tk.Button(valve1_frame, text="Valve1 OFF", width=12, command=lambda: self.send_cmd("q0")).pack(pady=4)

        valve2_frame = tk.LabelFrame(controls, text="Valve 2 (r)", padx=10, pady=10)
        valve2_frame.grid(row=0, column=2, padx=10, pady=5)
        tk.Button(valve2_frame, text="Valve2 ON", width=12, command=lambda: self.send_cmd("r1")).pack(pady=4)
        tk.Button(valve2_frame, text="Valve2 OFF", width=12, command=lambda: self.send_cmd("r0")).pack(pady=4)

        tk.Button(controls, text="ALL OFF", width=14, command=self.all_off).grid(row=1, column=1, pady=8)

        plot_frame = tk.Frame(self.root, padx=10, pady=10)
        plot_frame.pack(fill="both", expand=True)

        self.figure = Figure(figsize=(8, 4), dpi=100)
        self.ax = self.figure.add_subplot(111)
        self.ax.set_title("A0 Live Plot")
        self.ax.set_xlabel("Samples")
        self.ax.set_ylabel("ADC")

        # two lines: raw and filtered
        self.raw_line, = self.ax.plot(range(MAX_POINTS), list(self.raw_data), label="Raw")
        self.lpf_line, = self.ax.plot(range(MAX_POINTS), list(self.lpf_data), label="LPF 2 Hz")
        self.ax.legend()

        self.canvas = FigureCanvasTkAgg(self.figure, master=plot_frame)
        self.canvas.get_tk_widget().pack(fill="both", expand=True)

        bottom = tk.Frame(self.root, padx=10, pady=10)
        bottom.pack(fill="both", expand=False)

        tk.Label(bottom, text="Log:").pack(anchor="w")
        self.log_text = tk.Text(bottom, height=10, width=80)
        self.log_text.pack(fill="both", expand=True)

    def log(self, msg):
        self.log_text.insert(tk.END, msg + "\n")
        self.log_text.see(tk.END)

    def refresh_ports(self):
        ports = [p.device for p in serial.tools.list_ports.comports()]
        menu = self.port_menu["menu"]
        menu.delete(0, "end")

        if not ports:
            ports = [""]

        for p in ports:
            menu.add_command(label=p, command=lambda value=p: self.port_var.set(value))

        self.port_var.set(ports[0])
        self.log("Ports: " + ", ".join([p for p in ports if p]))

    def connect_serial(self):
        port = self.port_var.get().strip()
        if not port:
            messagebox.showwarning("No Port", "No serial port selected.")
            return

        try:
            self.ser = serial.Serial(port, BAUDRATE, timeout=0.1)
            time.sleep(1.5)

            self.running = True
            self.reader_thread = threading.Thread(target=self.reader_loop, daemon=True)
            self.reader_thread.start()

            self.log(f"Connected to {port} @ {BAUDRATE}")
        except Exception as e:
            messagebox.showerror("Connection Error", str(e))
            self.log(f"Connection failed: {e}")

    def disconnect_serial(self):
        self.running = False
        try:
            if self.ser and self.ser.is_open:
                self.ser.close()
                self.log("Disconnected.")
        except Exception as e:
            self.log(f"Disconnect error: {e}")

    def send_cmd(self, cmd):
        try:
            if not self.ser or not self.ser.is_open:
                messagebox.showwarning("Not Connected", "Serial port is not connected.")
                return

            self.ser.write((cmd + "\n").encode("utf-8"))
            self.log(f"Sent: {cmd}")
        except Exception as e:
            messagebox.showerror("Serial Error", str(e))
            self.log(f"Send failed: {e}")

    def all_off(self):
        self.send_cmd("p0")
        self.send_cmd("q0")
        self.send_cmd("r0")

    def reader_loop(self):
        while self.running and self.ser and self.ser.is_open:
            try:
                line = self.ser.readline().decode(errors="ignore").strip()
                if not line:
                    continue

                if line.startswith("A0:"):
                    try:
                        parts = line.split(",")
                        raw = float(parts[0].split(":")[1])
                        lpf = float(parts[1].split(":")[1])

                        self.raw_data.append(raw)
                        self.lpf_data.append(lpf)
                    except Exception as e:
                        self.log_threadsafe(f"Parse error: {line} ({e})")

            except Exception as e:
                self.log_threadsafe(f"Read error: {e}")
                break

    def log_threadsafe(self, msg):
        self.root.after(0, lambda: self.log(msg))

    def update_plot(self):
        raw = list(self.raw_data)
        lpf = list(self.lpf_data)
        x = range(len(raw))

        self.raw_line.set_xdata(x)
        self.raw_line.set_ydata(raw)

        self.lpf_line.set_xdata(x)
        self.lpf_line.set_ydata(lpf)

        self.ax.set_xlim(0, max(len(raw) - 1, 10))

        # autoscale Y manually with padding
        combined = raw + lpf
        if combined:
            ymin = min(combined)
            ymax = max(combined)
            if ymin == ymax:
                pad = 1.0
            else:
                pad = 0.05 * (ymax - ymin)
            self.ax.set_ylim(ymin - pad, ymax + pad)

        self.canvas.draw()
        self.root.after(50, self.update_plot)

    def on_close(self):
        self.disconnect_serial()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = SerialControlGUI(root)
    root.mainloop()