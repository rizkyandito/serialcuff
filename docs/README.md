# Cuff Control — Web Serial (no backend)

Versi standalone yang **langsung jalan di browser** lewat
[Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
Tidak butuh Python, tidak butuh backend — cukup buka URL.

## Browser

Wajib **Chrome** atau **Edge** (desktop). Safari & Firefox tidak support
Web Serial. Harus diakses via **HTTPS** (atau `http://localhost` /
`http://127.0.0.1`).

## Cara pakai

1. Colok alat ke labtop via USB
2. Buka URL deploy (lihat di bawah) di Chrome/Edge
3. Klik **Connect** → dialog browser muncul → pilih port `usbmodem...`
4. Plot mulai update otomatis (firmware kirim CSV `t_ms,raw,lpf`)
5. Tombol Pump/Valve untuk kontrol manual
6. **Start Recording** → eksperimen → **Stop & Download CSV** → file
   `record_<timestamp>.csv` masuk folder Downloads

## Deploy ke GitHub Pages

1. Push folder repo ke GitHub
2. Settings → Pages → Source: `Deploy from a branch` → `main` / folder `/web`
3. Tunggu 1-2 menit → URL aktif di `https://<user>.github.io/<repo>/`

## Test lokal

```
cd web
python3 -m http.server 5500
```
Buka <http://localhost:5500> di Chrome/Edge.

## Format CSV

```
t_seconds,raw,lpf,pump,valve1,valve2
0.0123,31163,31162.99,0,0,0
...
```

`t_seconds` dimulai dari 0 saat tombol Start Recording ditekan.
