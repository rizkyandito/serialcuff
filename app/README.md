# Cuff Control — Web Serial Plotter

Aplikasi web untuk ambil data serial dari alat (pump + 2 valve + ADC A0) dan
kontrol manual lewat browser. Backend Python (FastAPI) pegang serial port,
frontend HTML/JS ngobrol lewat WebSocket.

Kompatibel dengan firmware [pindahan/main1.cpp](../pindahan/main1.cpp) (ADC
internal STM32U585) dan [pindahan/main2.cpp](../pindahan/main2.cpp)
(ADS1115) — protokol serialnya sama.

## Cara jalan

```bash
cd app/backend
pip install -r requirements.txt
python main.py
```

Lalu buka <http://localhost:8000> di browser.

## Fitur

- Pilih serial port → Connect/Disconnect
- Tombol manual: Pump, Valve1, Valve2, ALL OFF
- Indikator status (lampu hijau) tiap aktuator
- Grafik live ADC (raw + LPF) pakai uPlot
- Recording ke CSV: `t_seconds, raw, lpf, pump, valve1, valve2`
  - File tersimpan di `app/recordings/record_YYYYMMDD_HHMMSS.csv`
- **Hotkey: Spacebar = ALL OFF** (darurat)

## Protokol serial (sama dengan firmware)

Command ke alat: `p1`/`p0` (pump), `q1`/`q0` (valve1), `r1`/`r0` (valve2)
Data dari alat: `A0:<raw>,LPF:<filtered>` @ 100 Hz

## Struktur

```
app/
├── backend/
│   ├── main.py         # FastAPI + WebSocket endpoint
│   ├── serial_io.py    # serial port reader/writer (thread)
│   ├── recorder.py     # CSV recorder
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js          # uPlot + WebSocket + controls
└── recordings/         # CSV files
```
