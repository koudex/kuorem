# KuoRem

> Minecraft-themed AI background remover. Drop an image → server strips the background with a free AI model → download a transparent PNG. No API keys, no sign-up, no cloud calls.

![theme](https://img.shields.io/badge/theme-Minecraft-79c05c) ![stack](https://img.shields.io/badge/stack-Express%20%2B%20EJS-000) ![model](https://img.shields.io/badge/AI-ISNet%20(fp16)-4aedd9) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## What it does

1. You upload an image (PNG / JPG / WebP / BMP, up to 12 MB).
2. The server runs the **ISNet** ONNX model via [`@imgly/background-removal-node`](https://github.com/imgly/background-removal-js) — a **free, MIT-licensed, no-API-key** AI model that runs fully on your server.
3. The server returns a transparent PNG (lossless, alpha channel preserved).
4. You preview the original vs the cut-out, then download.

All processing happens **on the server**. No image ever leaves your deployment. No third-party API calls.

---

## Quality & performance notes

- **Model**: `isnet_fp16` — ISNet at fp16 precision. Best balance of quality (~97% IoU on benchmark datasets) and speed. ~85 MB download, cached on disk after first run.
- **Output**: lossless PNG, quality `1.0`. Alpha channel preserved for transparency.
- **Model warm-up**: on boot, the server kicks off a tiny 1×1 PNG through the model so the ONNX session is hot before the first real request lands. This means cold starts cost ~10–20 s of model download but the first user request is fast.
- **No quality damage**: input bytes are passed straight to the model; output is the raw model prediction encoded as PNG. No JPEG re-encoding, no resize, no crop.
- **Mobile-first**: layout is built mobile-up. Buttons are large, dropzone is large, touch targets are ≥48 px. Safe-area insets respected for iOS notches.
- **Progress UX**: upload progress drives the first 30% of the bar; AI processing drives 30→100%. Users always know something is happening.

---

## Run locally

```bash
# 1. install deps
npm install

# 2. start
npm start
# or, with auto-reload on file change:
npm run dev

# 3. open
# http://localhost:3000
```

First startup downloads the ISNet model (~85 MB) into your OS temp dir. Subsequent starts are instant.

---

## Deploy

### Render (recommended — free tier works)

1. Push this folder to a GitHub repo.
2. In Render: **New → Web Service → connect your repo**.
3. Render auto-detects `render.yaml` — accept the defaults.
4. Set build command `npm install`, start command `npm start`.
5. Deploy. First deploy downloads the model on cold start; subsequent requests are fast.

> Render free tier: 512 MB RAM, 15-min sleep on idle. The model loads in ~3 s after a cold start, so first request after sleep may take ~5 s — fine for personal use.

### Vercel

1. Push to GitHub.
2. In Vercel: **New Project → import repo**.
3. Vercel auto-reads `vercel.json`. Set the function memory to **1024 MB** and max duration to **60 s** (already configured in `vercel.json`).
4. Deploy.

> ⚠️ **Vercel caveat**: serverless functions are ephemeral — the model (~85 MB) is re-downloaded on cold starts. Each request after a cold start takes ~15–25 s. For frequent use, **Render is strongly recommended** over Vercel.

### Other Node hosts (Railway, Fly.io, etc.)

Any host that runs `npm install && npm start` and gives you ≥512 MB RAM works. Set `PORT` env var if the host requires it (the server already reads `process.env.PORT`).

---

## File structure

```
KuoRem/
├── server.js              # Express server + AI pipeline
├── package.json
├── render.yaml            # Render blueprint
├── vercel.json            # Vercel config
├── .gitignore
├── README.md
├── views/
│   └── index.ejs          # Minecraft-themed UI
└── public/
    ├── css/
    │   └── style.css       # Pixelated, blocky, mobile-first
    ├── js/
    │   └── main.js         # Upload, progress, preview, download
    └── fonts/
        └── Minecraft.woff  # Minecraft font
```

---

## API

### `POST /api/remove-bg`

**Body**: `multipart/form-data` with field `image` (PNG/JPG/WebP/BMP, ≤12 MB).

**Response 200**:
```json
{
  "success": true,
  "image": "data:image/png;base64,<...>",
  "bytes": 123456,
  "ms": 870,
  "originalSize": 987654,
  "originalType": "image/png"
}
```

**Response 4xx/5xx**:
```json
{ "success": false, "error": "Human-readable message." }
```

### `GET /health`

Returns `{ ok, modelReady, modelError, uptime }` — useful for uptime monitors.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| First request takes 15+ s | Model is downloading on cold start. Subsequent requests are fast. |
| `Model failed to load` in `/health` | Check `npm install` completed; check the host has ≥512 MB RAM. |
| Large image times out | Resize to ≤2000×2000 before upload; or bump `xhr.timeout` in `main.js`. |
| Font looks generic | The bundled `Minecraft.woff` is used; if missing, the CSS falls back to `VT323`/`Press Start 2P` from Google Fonts. |

---

## License

MIT. The ISNet model is also MIT-licensed (via `@imgly/background-removal`). Minecraft is a trademark of Mojang — this is a fan project, not affiliated.

Built with ♥. Arigato.
