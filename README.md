# SerialForCuff

Aplikasi serial plotter sederhana untuk:
- baca data serial real-time,
- plot data ke grafik,
- kirim command manual,
- jalankan hook algoritma kontrol alat.

## Fitur
- Auto-detect serial port.
- Koneksi/disconnect serial (`pyserial`).
- Plot real-time (`matplotlib` + `tkinter`).
- Kirim command manual dari UI.
- Tombol `Run Tool Algorithm` sebagai placeholder untuk algoritma kamu.

## Format Data Serial
Default parser membaca satu baris dan mengambil angka pertama.
Contoh data valid:
- `123.4`
- `123.4,56,78`

## Setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run
Dari root project:
```bash
PYTHONPATH=src python3 -m serialforcuff.main
```

## Isi Algoritma Kamu
Edit fungsi berikut:
- `run_tool_algorithm()` di `src/serialforcuff/app.py`

Contoh sekarang masih dummy logic:
- jika nilai terakhir < 100 -> kirim `PUMP_ON`
- jika tidak -> kirim `PUMP_OFF`

Nanti tinggal kamu ganti dengan algoritma kontrol alat yang sebenarnya.
