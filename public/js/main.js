/* =========================================================
   KuoRem — client logic
   Handles: file pick, drag-drop, XHR upload with progress,
   result preview, download, error display, reset flow.
   ========================================================= */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    uploadCard:   $('uploadCard'),
    fileInput:    $('fileInput'),
    dropzone:     $('dropzone'),
    processing:   $('processing'),
    procText:     $('procText'),
    procBarFill:  $('procBarFill'),
    result:       $('result'),
    origImg:      $('origImg'),
    outImg:       $('outImg'),
    actions:      $('actions'),
    downloadBtn:  $('downloadBtn'),
    againBtn:     $('againBtn'),
    statusLine:   $('statusLine'),
  };

  let lastResultUrl = null;
  let lastResultBlob = null;
  let lastFileName = 'kuorem-result.png';

  /* ------------------------- file pick ------------------------- */
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  els.fileInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  });

  /* ------------------------- drag & drop ----------------------- */
  ['dragenter', 'dragover'].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.remove('dragover');
    })
  );
  els.dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  // Also accept drop anywhere on the upload card (bigger target on mobile)
  ['dragenter', 'dragover', 'drop'].forEach((evt) =>
    els.uploadCard.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
    })
  );

  /* ------------------------- paste support --------------------- */
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          handleFile(f);
          return;
        }
      }
    }
  });

  /* ------------------------- file handling --------------------- */
  function handleFile(file) {
    // Validate type
    const okTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp'];
    if (!okTypes.includes(file.type)) {
      setStatus(`Unsupported type: ${file.type || 'unknown'}. Use PNG, JPG, WebP.`, 'error');
      return;
    }
    // 12MB client-side check (server also enforces)
    if (file.size > 12 * 1024 * 1024) {
      setStatus('File too large. Max 12MB.', 'error');
      return;
    }

    // Preview original
    const reader = new FileReader();
    reader.onload = (ev) => {
      els.origImg.style.backgroundImage = `url(${ev.target.result})`;
    };
    reader.readAsDataURL(file);

    // Remember a friendly download name
    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    lastFileName = `${base}-kuorem.png`;

    // Switch to processing UI
    showProcessing();
    setStatus('Uploading to the smelter...', 'info');

    // Upload with progress
    uploadFile(file);
  }

  /* ------------------------- upload ---------------------------- */
  function uploadFile(file) {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('image', file);

    xhr.open('POST', '/api/remove-bg');

    // Upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        // Reserve 0-30% for upload, 30-100% for AI processing
        const visual = Math.min(30, Math.round(pct * 0.3));
        setProgress(visual, pct < 100 ? `Uploading... ${pct}%` : 'AI is mining pixels...');
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { return fail('Bad response from server.'); }

        if (data.success && data.image) {
          // Simulate progress to 100 then reveal
          setProgress(100, 'Done!');
          // Convert data URL -> blob for download efficiency
          lastResultUrl = data.image;
          lastResultBlob = dataURLtoBlob(data.image);
          showResult(data);
        } else {
          fail(data.error || 'Server returned no image.');
        }
      } else {
        let msg = `Server error (${xhr.status})`;
        try {
          const err = JSON.parse(xhr.responseText);
          if (err.error) msg = err.error;
        } catch {}
        fail(msg);
      }
    };

    xhr.onerror = () => fail('Network error. Check connection.');
    xhr.ontimeout = () => fail('Request timed out. Try a smaller image.');

    xhr.timeout = 120000; // 2 min for big images / cold start
    xhr.send(fd);
  }

  /* ------------------------- UI states ------------------------- */
  function showProcessing() {
    els.dropzone.hidden = true;
    els.result.hidden = true;
    els.actions.hidden = true;
    els.processing.hidden = false;
    setProgress(0, 'Smelting image...');
  }

  function showResult(data) {
    setProgress(100, 'Done!');
    els.processing.hidden = true;

    els.outImg.style.setProperty('--result-url', `url(${data.image})`);
    els.outImg.classList.add('has-img');
    // Also set as background so non-supporting browsers still show
    els.outImg.style.backgroundImage = `url(${data.image}), linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%)`;
    els.outImg.style.backgroundSize = 'contain, 16px 16px, 16px 16px, 16px 16px, 16px 16px';
    els.outImg.style.backgroundPosition = 'center, 0 0, 0 8px, 8px -8px, -8px 0';
    els.outImg.style.backgroundRepeat = 'no-repeat, repeat, repeat, repeat, repeat';
    els.outImg.style.backgroundColor = '#ccc';

    els.result.hidden = false;
    els.actions.hidden = false;

    const kb = Math.round(data.bytes / 1024);
    const ms = data.ms;
    setStatus(`Done! ${kb} KB · ${ms} ms`, 'success');
  }

  function fail(msg) {
    els.processing.hidden = true;
    els.dropzone.hidden = false;
    setStatus(msg, 'error');
  }

  function reset() {
    els.fileInput.value = '';
    els.origImg.style.backgroundImage = '';
    els.outImg.style.backgroundImage = '';
    els.outImg.style.removeProperty('--result-url');
    els.outImg.classList.remove('has-img');
    els.dropzone.hidden = false;
    els.processing.hidden = true;
    els.result.hidden = true;
    els.actions.hidden = true;
    setStatus('', 'info');
    setProgress(0, '');
    lastResultUrl = null;
    lastResultBlob = null;
  }

  /* ------------------------- actions --------------------------- */
  els.downloadBtn.addEventListener('click', () => {
    if (!lastResultUrl) return;
    const a = document.createElement('a');
    a.href = lastResultUrl;
    a.download = lastFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus('Downloaded. Build something epic!', 'success');
  });

  els.againBtn.addEventListener('click', reset);

  /* ------------------------- helpers --------------------------- */
  function setProgress(pct, text) {
    els.procBarFill.style.width = `${pct}%`;
    if (text) els.procText.textContent = text;
  }

  function setStatus(msg, kind) {
    els.statusLine.textContent = msg || '';
    els.statusLine.className = 'status-line' + (kind ? ` ${kind}` : '');
  }

  function dataURLtoBlob(dataURL) {
    try {
      const [head, body] = dataURL.split(',');
      const mime = head.match(/:(.*?);/)?.[1] || 'image/png';
      const bin = atob(body);
      const len = bin.length;
      const u8 = new Uint8Array(len);
      for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: mime });
    } catch {
      return null;
    }
  }
})();
