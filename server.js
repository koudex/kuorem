/**
 * KuoRem — Minecraft-themed AI Background Remover
 * Express + EJS server.
 *
 * Pipeline:
 *   client uploads image (multipart/form-data)
 *   -> multer loads it into memory
 *   -> @imgly/background-removal-node strips the background using the
 *      ISNet AI model (free, ONNX-based, runs fully on the server, no API key)
 *   -> server returns a transparent PNG as data URL
 *
 * No external API keys, no cloud calls — everything stays on this server.
 */

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// Optional: pre-warm model on boot so the first request isn't slow.
let removeBackground = null;
try {
  ({ removeBackground } = require('@imgly/background-removal-node'));
  console.log('[KuoRem] @imgly/background-removal-node loaded.');
} catch (e) {
  console.error('[KuoRem] FATAL: background-removal package not available.');
  console.error('         Run `npm install` before starting the server.');
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;

/* ----------------------------- middleware ----------------------------- */
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Cache static assets aggressively (fonts/textures don't change).
const oneWeek = 7 * 24 * 60 * 60 * 1000;
app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: oneWeek,
  immutable: true,
}));
// Root-level static too (for /robots.txt etc.)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: oneWeek }));

// Path to the @imgly bundled wasm/onnx assets. Must be absolute so the
// server works regardless of the cwd it was launched from (important for
// Render/Vercel process managers that may start from a different root).
const IMGLY_DIST = path.join(
  __dirname,
  'node_modules',
  '@imgly',
  'background-removal-node',
  'dist'
);
const IMGLY_PUBLIC_PATH = `file://${IMGLY_DIST}/`;

/* ------------------------------ tmp dir ------------------------------- */
// Used by Node OS for any scratch files. On Render/Vercel ephemeral
// filesystems this is recreated on cold start; the model just re-downloads.
const tmpRoot = path.join(os.tmpdir(), 'kuorem');
fs.mkdirSync(tmpRoot, { recursive: true });

/* ------------------------------- upload ------------------------------- */
const MAX_MB = 12;
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Use PNG, JPG, WebP, or BMP.`));
  },
});

/* ----------------------------- warm cache ----------------------------- */
// Trigger model download + warm ONNX session at boot. Subsequent requests
// become near-instant. We don't await — boot returns immediately and the
// model warms in the background.
//
// Model options (v1.4.x): 'small' (~40MB, quantized, fast) | 'medium' (~80MB, default, best balance) | 'large' (~160MB, best quality).
// We use 'medium' for production-grade balance. Output is lossless PNG with alpha.
let modelReady = false;
let modelError = null;
console.log('[KuoRem] Warming AI model (downloads ~80MB on first run, cached after)...');

// 1x1 RGBA PNG used as warm-up input. Must be 4-channel (RGBA) or the
// inference will reject it. Triggers model download + ONNX session creation
// without doing real work on a real image.
const WARMUP_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=',
  'base64'
);

removeBackground(new Blob([WARMUP_PNG], { type: 'image/png' }), {
  publicPath: IMGLY_PUBLIC_PATH,
  model: 'medium',
  output: { format: 'image/png', quality: 0.8, type: 'foreground' },
  progress: (key, current, total) => {
    if (current === total) console.log(`[KuoRem]   fetched ${key} (${total} bytes)`);
  },
})
  .then(() => { modelReady = true;  console.log('[KuoRem] AI model ready.'); })
  .catch((e) => { modelError = e;   console.error('[KuoRem] Model warm-up failed:', e.message || e); });

/* -------------------------------- routes ------------------------------ */
app.get('/', (req, res) => res.render('index', { appName: 'KuoRem' }));

app.get('/health', (req, res) => res.json({
  ok: true,
  modelReady,
  modelError: modelError ? modelError.message : null,
  uptime: process.uptime(),
}));

/**
 * POST /api/remove-bg
 * multipart/form-data field: image
 * returns: { success: true, image: 'data:image/png;base64,...', bytes, ms }
 */
app.post('/api/remove-bg', upload.single('image'), async (req, res) => {
  const started = Date.now();
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded. Drop a file and try again.' });
    }
    if (modelError) {
      return res.status(503).json({ success: false, error: 'AI model failed to load. Check server logs.' });
    }

    const inBlob = new Blob([req.file.buffer], { type: req.file.mimetype });

    // 'medium' (~80MB) — best balance of quality and speed.
    // Output: PNG with alpha channel for transparency. Quality 0.8 keeps
    // file size reasonable while preserving edge detail; PNG is lossless
    // so quality only affects the alpha matte's encoding, not visible pixels.
    const outBlob = await removeBackground(inBlob, {
      publicPath: IMGLY_PUBLIC_PATH,
      model: 'medium',
      output: { format: 'image/png', quality: 0.8, type: 'foreground' },
    });

    const ab = await outBlob.arrayBuffer();
    const buf = Buffer.from(ab);
    const b64 = buf.toString('base64');
    const dataUrl = `data:image/png;base64,${b64}`;

    return res.json({
      success: true,
      image: dataUrl,
      bytes: buf.length,
      ms: Date.now() - started,
      originalSize: req.file.size,
      originalType: req.file.mimetype,
    });
  } catch (err) {
    console.error('[KuoRem] /api/remove-bg error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Background removal failed.',
    });
  }
});

/* ---------------------------- error handle ---------------------------- */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: `File too large. Max ${MAX_MB}MB.` });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err) return res.status(400).json({ success: false, error: err.message });
  next();
});

/* ------------------------------ listen -------------------------------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[KuoRem] Server listening on http://0.0.0.0:${PORT}`);
  console.log(`[KuoRem] Tmp dir: ${tmpRoot}`);
});
