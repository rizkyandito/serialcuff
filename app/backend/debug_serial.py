import sys
import serial
import serial.tools.list_ports


def pick_port() -> str:
    ports = [p.device for p in serial.tools.list_ports.comports()]
    if not ports:
        print("No serial ports found")
        sys.exit(1)
    for p in ports:
        if "usbmodem" in p or "usbserial" in p:
            return p
    return ports[0]


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else pick_port()
    print(f"Opening {port} @ 921600")
    ser = serial.Serial(port, 921600, timeout=1.0)
    for i in range(40):
        line = ser.readline().decode(errors="ignore").strip()
        print(f"{i:02d}: {line!r}")
    ser.close()


if __name__ == "__main__":
    main()
