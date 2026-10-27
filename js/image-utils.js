/** Canvas image helpers — all processing stays in the browser. */
(function (global) {
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("请选择图片文件"));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片加载失败"));
      };
      img.src = url;
    });
  }

  /** Rotate a CanvasImageSource 90° clockwise; returns a canvas (usable as image). */
  function rotateImageCW90(source) {
    if (!source) return null;
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    if (!w || !h) return null;
    const c = document.createElement("canvas");
    c.width = h;
    c.height = w;
    const ctx = c.getContext("2d");
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(source, 0, 0);
    return c;
  }

  function imageToImageData(img, w, h, opts) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const smooth = !opts || opts.smooth !== false;
    ctx.imageSmoothingEnabled = smooth;
    if (smooth && "imageSmoothingQuality" in ctx) {
      ctx.imageSmoothingQuality = "high";
    }
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, ctx, data: ctx.getImageData(0, 0, w, h) };
  }

  /**
   * Fit source into side×side.
   * mode: "cover" (crop center) | "contain" (letterbox) | "stretch"
   */
  function fitImageToSquare(img, side, mode, opts) {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const smooth = !opts || opts.smooth !== false;
    ctx.imageSmoothingEnabled = smooth;
    if (smooth && "imageSmoothingQuality" in ctx) {
      ctx.imageSmoothingQuality = "high";
    }

    const m = mode || "cover";
    if (m === "stretch") {
      ctx.drawImage(img, 0, 0, side, side);
    } else if (m === "contain") {
      /* Transparent letterbox by default so pads are not quantized as beads
         and do not steal edge seeds from Remove BG. Pass padColor to force a fill. */
      if (opts && opts.padColor) {
        ctx.fillStyle = opts.padColor;
        ctx.fillRect(0, 0, side, side);
      } else {
        ctx.clearRect(0, 0, side, side);
      }
      const s = Math.min(side / sw, side / sh);
      const dw = Math.max(1, Math.round(sw * s));
      const dh = Math.max(1, Math.round(sh * s));
      ctx.drawImage(img, ((side - dw) / 2) | 0, ((side - dh) / 2) | 0, dw, dh);
    } else {
      // cover — center crop
      const s = Math.max(side / sw, side / sh);
      const dw = sw * s;
      const dh = sh * s;
      const ox = (side - dw) / 2;
      const oy = (side - dh) / 2;
      ctx.drawImage(img, ox, oy, dw, dh);
    }
    return { canvas, ctx, data: ctx.getImageData(0, 0, side, side) };
  }

  /** Weighted RGB distance (closer to human perception than plain Euclidean). */
  function dist2(a, b) {
    const rmean = (a[0] + b[0]) * 0.5;
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
  }

  function nearestColor(r, g, b, paletteColors) {
    let best = paletteColors[0];
    let bestD = Infinity;
    for (const c of paletteColors) {
      const d = dist2([r, g, b], c.rgb);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Contrast / saturation tweak before quantize (in-place copy). */
  function adjustImageData(imageData, opts) {
    const contrast = opts && opts.contrast != null ? opts.contrast : 1;
    const sat = opts && opts.saturation != null ? opts.saturation : 1;
    const out = new ImageData(imageData.width, imageData.height);
    const src = imageData.data;
    const dst = out.data;
    const c = contrast;
    const s = sat;
    for (let i = 0; i < src.length; i += 4) {
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];
      const a = src[i + 3];
      r = (r - 128) * c + 128;
      g = (g - 128) * c + 128;
      b = (b - 128) * c + 128;
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = y + (r - y) * s;
      g = y + (g - y) * s;
      b = y + (b - y) * s;
      dst[i] = clamp(r, 0, 255);
      dst[i + 1] = clamp(g, 0, 255);
      dst[i + 2] = clamp(b, 0, 255);
      dst[i + 3] = a;
    }
    return out;
  }

  /**
   * Clear solid letterbox / pillarbox bands (uniform rows/cols from a side).
   * Typical contain-fit white pads that block edge-flood from reaching real BG.
   */
  function clearUniformBorderBands(imageData, opts) {
    const o = opts || {};
    const tol = Math.max(0, Math.min(180, o.tolerance != null ? +o.tolerance : 36));
    const tol2 = tol * tol;
    const w = imageData.width;
    const h = imageData.height;
    const d = imageData.data;
    const minCover = 0.88;
    const maxFrac = 0.42;

    function colorDist2(r, g, b, rgb) {
      const dr = r - rgb[0];
      const dg = g - rgb[1];
      const db = b - rgb[2];
      return dr * dr + dg * dg + db * db;
    }

    function rowBand(y) {
      const counts = Object.create(null);
      let total = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 16) continue;
        const key = d[i] + "," + d[i + 1] + "," + d[i + 2];
        counts[key] = (counts[key] || 0) + 1;
        total += 1;
      }
      if (total < w * minCover) return null;
      let bestKey = null;
      let bestN = 0;
      for (const k in counts) {
        if (counts[k] > bestN) {
          bestN = counts[k];
          bestKey = k;
        }
      }
      if (!bestKey || bestN < total * minCover) return null;
      const parts = bestKey.split(",");
      const rgb = [+parts[0], +parts[1], +parts[2]];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 16) continue;
        if (colorDist2(d[i], d[i + 1], d[i + 2], rgb) > tol2) return null;
      }
      return rgb;
    }

    function colBand(x) {
      const counts = Object.create(null);
      let total = 0;
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 16) continue;
        const key = d[i] + "," + d[i + 1] + "," + d[i + 2];
        counts[key] = (counts[key] || 0) + 1;
        total += 1;
      }
      if (total < h * minCover) return null;
      let bestKey = null;
      let bestN = 0;
      for (const k in counts) {
        if (counts[k] > bestN) {
          bestN = counts[k];
          bestKey = k;
        }
      }
      if (!bestKey || bestN < total * minCover) return null;
      const parts = bestKey.split(",");
      const rgb = [+parts[0], +parts[1], +parts[2]];
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 16) continue;
        if (colorDist2(d[i], d[i + 1], d[i + 2], rgb) > tol2) return null;
      }
      return rgb;
    }

    function clearRow(y) {
      for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = 0;
    }
    function clearCol(x) {
      for (let y = 0; y < h; y++) d[(y * w + x) * 4 + 3] = 0;
    }

    function measureTop() {
      const first = rowBand(0);
      if (!first) return 0;
      const maxD = Math.max(2, Math.floor(h * maxFrac));
      let depth = 1;
      while (depth < maxD) {
        const c = rowBand(depth);
        if (!c || colorDist2(c[0], c[1], c[2], first) > tol2) break;
        depth++;
      }
      return depth >= 2 ? depth : 0;
    }
    function measureBottom() {
      const first = rowBand(h - 1);
      if (!first) return 0;
      const maxD = Math.max(2, Math.floor(h * maxFrac));
      let depth = 1;
      while (depth < maxD) {
        const c = rowBand(h - 1 - depth);
        if (!c || colorDist2(c[0], c[1], c[2], first) > tol2) break;
        depth++;
      }
      return depth >= 2 ? depth : 0;
    }
    function measureLeft() {
      const first = colBand(0);
      if (!first) return 0;
      const maxD = Math.max(2, Math.floor(w * maxFrac));
      let depth = 1;
      while (depth < maxD) {
        const c = colBand(depth);
        if (!c || colorDist2(c[0], c[1], c[2], first) > tol2) break;
        depth++;
      }
      return depth >= 2 ? depth : 0;
    }
    function measureRight() {
      const first = colBand(w - 1);
      if (!first) return 0;
      const maxD = Math.max(2, Math.floor(w * maxFrac));
      let depth = 1;
      while (depth < maxD) {
        const c = colBand(w - 1 - depth);
        if (!c || colorDist2(c[0], c[1], c[2], first) > tol2) break;
        depth++;
      }
      return depth >= 2 ? depth : 0;
    }

    const top = measureTop();
    const bottom = measureBottom();
    const left = measureLeft();
    const right = measureRight();
    for (let y = 0; y < top; y++) clearRow(y);
    for (let y = 0; y < bottom; y++) clearRow(h - 1 - y);
    for (let x = 0; x < left; x++) clearCol(x);
    for (let x = 0; x < right; x++) clearCol(w - 1 - x);
    return { top, bottom, left, right };
  }

  /**
   * Clear edge-connected background by setting alpha=0 (does not mutate input).
   * Seeds from dominant edge colors, then 4-neighbor flood within RGB tolerance.
   * First clears uniform letterbox bands so contain-fit pads do not steal seeds.
   * opts.tolerance: 0–180 Euclidean RGB distance (default 36).
   */
  function removeBackgroundEdgeFlood(imageData, opts) {
    const o = opts || {};
    const tol = Math.max(0, Math.min(180, o.tolerance != null ? +o.tolerance : 36));
    const tol2 = tol * tol;
    const w = imageData.width;
    const h = imageData.height;
    if (!w || !h) return new ImageData(w || 1, h || 1);
    const out = new ImageData(new Uint8ClampedArray(imageData.data), w, h);
    const d = out.data;
    const n = w * h;
    const seen = new Uint8Array(n);

    if (o.clearLetterbox !== false) {
      clearUniformBorderBands(out, { tolerance: Math.max(tol, 28) });
    }

    function edgeKey(x, y) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 16) return null;
      return d[i] + "," + d[i + 1] + "," + d[i + 2];
    }

    let contentX0 = w;
    let contentY0 = h;
    let contentX1 = -1;
    let contentY1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] < 16) continue;
        if (x < contentX0) contentX0 = x;
        if (y < contentY0) contentY0 = y;
        if (x > contentX1) contentX1 = x;
        if (y > contentY1) contentY1 = y;
      }
    }
    if (contentX1 < contentX0 || contentY1 < contentY0) return out;

    const edgeCounts = Object.create(null);
    let edgeTotal = 0;
    function tally(x, y) {
      const key = edgeKey(x, y);
      if (!key) return;
      edgeCounts[key] = (edgeCounts[key] || 0) + 1;
      edgeTotal += 1;
    }
    for (let x = 0; x < w; x++) {
      tally(x, 0);
      if (h > 1) tally(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
      tally(0, y);
      if (w > 1) tally(w - 1, y);
    }
    /* After transparent / cleared letterbox, canvas border may be empty —
       also seed from the opaque content rectangle perimeter. */
    for (let x = contentX0; x <= contentX1; x++) {
      tally(x, contentY0);
      if (contentY1 !== contentY0) tally(x, contentY1);
    }
    for (let y = contentY0 + 1; y < contentY1; y++) {
      tally(contentX0, y);
      if (contentX1 !== contentX0) tally(contentX1, y);
    }
    if (!edgeTotal) return out;

    const sorted = Object.keys(edgeCounts).sort(
      (a, b) => edgeCounts[b] - edgeCounts[a]
    );
    const minShare = Math.max(2, Math.ceil(edgeTotal * 0.12));
    const seedRgbs = [];
    const seedSet = Object.create(null);
    for (let i = 0; i < sorted.length; i++) {
      const key = sorted[i];
      if (i > 0 && edgeCounts[key] < minShare) break;
      if (seedSet[key]) continue;
      seedSet[key] = 1;
      const parts = key.split(",");
      seedRgbs.push([+parts[0], +parts[1], +parts[2]]);
      if (seedRgbs.length >= 4) break;
    }
    if (!seedRgbs.length) return out;

    function isBgPixel(i) {
      if (d[i + 3] < 16) return false;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      for (let s = 0; s < seedRgbs.length; s++) {
        const sr = seedRgbs[s][0];
        const sg = seedRgbs[s][1];
        const sb = seedRgbs[s][2];
        const dr = r - sr;
        const dg = g - sg;
        const db = b - sb;
        if (dr * dr + dg * dg + db * db <= tol2) return true;
      }
      return false;
    }

    const q = new Int32Array(n);
    function floodFrom(sx, sy) {
      const start = sy * w + sx;
      if (seen[start]) return;
      const si = start * 4;
      if (!isBgPixel(si)) return;
      let head = 0;
      let tail = 0;
      q[tail++] = start;
      seen[start] = 1;
      while (head < tail) {
        const idx = q[head++];
        const i = idx * 4;
        d[i + 3] = 0;
        const x = idx % w;
        const y = (idx / w) | 0;
        const nx0 = x - 1;
        const nx1 = x + 1;
        const ny0 = y - 1;
        const ny1 = y + 1;
        if (nx0 >= 0) {
          const nidx = y * w + nx0;
          if (!seen[nidx] && isBgPixel(nidx * 4)) {
            seen[nidx] = 1;
            q[tail++] = nidx;
          }
        }
        if (nx1 < w) {
          const nidx = y * w + nx1;
          if (!seen[nidx] && isBgPixel(nidx * 4)) {
            seen[nidx] = 1;
            q[tail++] = nidx;
          }
        }
        if (ny0 >= 0) {
          const nidx = ny0 * w + x;
          if (!seen[nidx] && isBgPixel(nidx * 4)) {
            seen[nidx] = 1;
            q[tail++] = nidx;
          }
        }
        if (ny1 < h) {
          const nidx = ny1 * w + x;
          if (!seen[nidx] && isBgPixel(nidx * 4)) {
            seen[nidx] = 1;
            q[tail++] = nidx;
          }
        }
      }
    }

    for (let x = 0; x < w; x++) {
      floodFrom(x, 0);
      if (h > 1) floodFrom(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
      floodFrom(0, y);
      if (w > 1) floodFrom(w - 1, y);
    }
    for (let x = contentX0; x <= contentX1; x++) {
      floodFrom(x, contentY0);
      if (contentY1 !== contentY0) floodFrom(x, contentY1);
    }
    for (let y = contentY0 + 1; y < contentY1; y++) {
      floodFrom(contentX0, y);
      if (contentX1 !== contentX0) floodFrom(contentX1, y);
    }
    return out;
  }

  /** Horizontal mirror of ImageData (new buffer). */
  function mirrorImageDataH(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;
    const out = new ImageData(w, h);
    const dst = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4;
        const di = (y * w + (w - 1 - x)) * 4;
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      }
    }
    return out;
  }

  /** Draw quantized cells as circles (perler-like preview / export). */
  function drawBeadGrid(canvas, imageData, cell, gap, opts) {
    const o = opts && typeof opts === "object" && !Array.isArray(opts) ? opts : {};
    const cols = imageData.width;
    const rows = imageData.height;
    const csize = Math.max(4, cell | 0);
    const g = Math.max(0, gap | 0);
    const step = csize + g;
    canvas.width = cols * step - (g > 0 ? g : 0);
    canvas.height = rows * step - (g > 0 ? g : 0);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = o.bg || "#1a1f28";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    const rBead = csize * 0.46;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        if (d[i + 3] < 16) continue;
        const cx = x * step + csize / 2;
        const cy = y * step + csize / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rBead, 0, Math.PI * 2);
        ctx.fillStyle = rgbToHex(d[i], d[i + 1], d[i + 2]);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - rBead * 0.25, cy - rBead * 0.25, rBead * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fill();
      }
    }
  }

  /**
   * Overlay short bottle codes on each opaque cell (existing canvas).
   * opts: { beads, gap, paletteColors, labelFn, sharp }
   * sharp (print/preview): no stroke, ~34% cell height, measureText padding.
   */
  function drawCellCodeOverlay(canvas, imageData, cell, opts) {
    const o = opts || {};
    const colors = o.paletteColors || [];
    if (!colors.length) return;
    const cols = imageData.width;
    const rows = imageData.height;
    const csize = Math.max(4, cell | 0);
    const g = o.beads ? Math.max(0, o.gap | 0) : 0;
    const step = o.beads ? csize + g : csize;
    const d = imageData.data;
    const byHex = Object.create(null);
    colors.forEach((c) => {
      if (!c || !c.hex) return;
      const key = String(c.hex).toLowerCase();
      let lab = "";
      if (typeof o.labelFn === "function") lab = o.labelFn(c) || "";
      else if (c.code) lab = String(c.code);
      else if (c.id != null) lab = String(c.id);
      byHex[key] = lab;
    });
    const ctx = canvas.getContext("2d");
    const fontFamily = "Arial,\"Helvetica Neue\",system-ui,sans-serif";
    const maxW = csize * (1 - 0.18 * 2);
    const targetPx = o.sharp
      ? Math.max(7, Math.floor(csize * 0.34))
      : Math.max(7, Math.min(12, Math.floor(csize * 0.36)));
    const minPx = o.sharp ? Math.max(5, Math.floor(csize * 0.22)) : 6;
    const fontCache = Object.create(null);

    function fontForLabel(lab) {
      if (fontCache[lab] != null) return fontCache[lab];
      let px = targetPx;
      ctx.font = "600 " + px + "px " + fontFamily;
      while (px > minPx && ctx.measureText(lab).width > maxW) {
        px -= 1;
        ctx.font = "600 " + px + "px " + fontFamily;
      }
      fontCache[lab] = px;
      return px;
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        if (d[i + 3] < 16) continue;
        const hex = rgbToHex(d[i], d[i + 1], d[i + 2]).toLowerCase();
        let lab = byHex[hex];
        if (!lab) {
          const near = nearestColor(d[i], d[i + 1], d[i + 2], colors);
          if (!near) continue;
          lab =
            (typeof o.labelFn === "function" && o.labelFn(near)) ||
            (near.code && String(near.code)) ||
            (near.id != null ? String(near.id) : "");
          if (lab) byHex[hex] = lab;
        }
        if (!lab) continue;
        if (lab.length > 4) lab = lab.slice(0, 4);
        const px = fontForLabel(lab);
        ctx.font = "600 " + px + "px " + fontFamily;
        const cx = Math.floor(x * step + csize / 2) + 0.5;
        const cy = Math.floor(y * step + csize / 2) + 0.5;
        const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        ctx.fillStyle = lum > 0.55 ? "#111111" : "#ffffff";
        ctx.fillText(lab, cx, cy);
      }
    }
    ctx.restore();
  }

  /** Median-cut style simple quantize to N colors (max 64). */
  function extractPalette(imageData, n) {
    const count = Math.max(2, Math.min(64, n | 0));
    const samples = [];
    const d = imageData.data;
    const step = Math.max(1, Math.floor((d.length / 4) / 8000));
    for (let i = 0; i < d.length; i += 4 * step) {
      if (d[i + 3] < 16) continue;
      samples.push([d[i], d[i + 1], d[i + 2]]);
    }
    if (samples.length === 0) {
      return [{ id: 1, hex: "#000000", name: "#000000", rgb: [0, 0, 0] }];
    }

    let buckets = [samples];
    while (buckets.length < count) {
      let bi = -1;
      let bestRange = -1;
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        if (b.length < 2) continue;
        let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
        for (const p of b) {
          rMin = Math.min(rMin, p[0]); rMax = Math.max(rMax, p[0]);
          gMin = Math.min(gMin, p[1]); gMax = Math.max(gMax, p[1]);
          bMin = Math.min(bMin, p[2]); bMax = Math.max(bMax, p[2]);
        }
        const range = Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
        if (range > bestRange) {
          bestRange = range;
          bi = i;
        }
      }
      if (bi < 0) break;
      const bucket = buckets[bi];
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
      for (const p of bucket) {
        rMin = Math.min(rMin, p[0]); rMax = Math.max(rMax, p[0]);
        gMin = Math.min(gMin, p[1]); gMax = Math.max(gMax, p[1]);
        bMin = Math.min(bMin, p[2]); bMax = Math.max(bMax, p[2]);
      }
      const rr = rMax - rMin, gr = gMax - gMin, br = bMax - bMin;
      const ch = rr >= gr && rr >= br ? 0 : gr >= br ? 1 : 2;
      bucket.sort((a, b) => a[ch] - b[ch]);
      const mid = bucket.length >> 1;
      buckets.splice(bi, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    return buckets.map((b, i) => {
      let r = 0, g = 0, bl = 0;
      for (const p of b) {
        r += p[0]; g += p[1]; bl += p[2];
      }
      const nPix = b.length || 1;
      const rgb = [(r / nPix) | 0, (g / nPix) | 0, (bl / nPix) | 0];
      const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
      return { id: i + 1, hex, name: hex, rgb };
    });
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function quantizeImageData(imageData, paletteColors, opts) {
    const dither = (opts && opts.dither) || "none";
    const alphaCut = (opts && opts.alphaCut) != null ? opts.alphaCut : 16;
    const strength = opts && opts.ditherStrength != null ? opts.ditherStrength : 1;
    const out = new ImageData(imageData.width, imageData.height);
    const src = imageData.data;
    const dst = out.data;
    const w = imageData.width;
    const h = imageData.height;

    if (!dither || dither === "none" || dither === false) {
      for (let i = 0; i < src.length; i += 4) {
        if (src[i + 3] < alphaCut) {
          dst[i] = dst[i + 1] = dst[i + 2] = 0;
          dst[i + 3] = 0;
          continue;
        }
        const c = nearestColor(src[i], src[i + 1], src[i + 2], paletteColors);
        dst[i] = c.rgb[0];
        dst[i + 1] = c.rgb[1];
        dst[i + 2] = c.rgb[2];
        dst[i + 3] = 255;
      }
      return out;
    }

    if (dither === "bayer") {
      const bayer = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5],
      ];
      const amp = 16 * strength;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (src[i + 3] < alphaCut) {
            dst[i] = dst[i + 1] = dst[i + 2] = 0;
            dst[i + 3] = 0;
            continue;
          }
          const t = (bayer[y & 3][x & 3] / 16 - 0.5) * amp;
          const c = nearestColor(
            clamp(src[i] + t, 0, 255),
            clamp(src[i + 1] + t, 0, 255),
            clamp(src[i + 2] + t, 0, 255),
            paletteColors
          );
          dst[i] = c.rgb[0];
          dst[i + 1] = c.rgb[1];
          dst[i + 2] = c.rgb[2];
          dst[i + 3] = 255;
        }
      }
      return out;
    }

    // Floyd–Steinberg (default when dither truthy / "fs")
    const buf = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) buf[i] = src[i];

    for (let y = 0; y < h; y++) {
      const leftToRight = y % 2 === 0;
      for (let xi = 0; xi < w; xi++) {
        const x = leftToRight ? xi : w - 1 - xi;
        const i = (y * w + x) * 4;
        if (src[i + 3] < alphaCut) {
          dst[i] = dst[i + 1] = dst[i + 2] = 0;
          dst[i + 3] = 0;
          continue;
        }
        const r = clamp(buf[i], 0, 255);
        const g = clamp(buf[i + 1], 0, 255);
        const b = clamp(buf[i + 2], 0, 255);
        const c = nearestColor(r, g, b, paletteColors);
        dst[i] = c.rgb[0];
        dst[i + 1] = c.rgb[1];
        dst[i + 2] = c.rgb[2];
        dst[i + 3] = 255;
        const er = (r - c.rgb[0]) * strength;
        const eg = (g - c.rgb[1]) * strength;
        const eb = (b - c.rgb[2]) * strength;
        const dir = leftToRight ? 1 : -1;
        diffuse(buf, w, h, x + dir, y, er, eg, eb, 7 / 16);
        diffuse(buf, w, h, x - dir, y + 1, er, eg, eb, 3 / 16);
        diffuse(buf, w, h, x, y + 1, er, eg, eb, 5 / 16);
        diffuse(buf, w, h, x + dir, y + 1, er, eg, eb, 1 / 16);
      }
    }
    return out;
  }

  /**
   * Merge sparse dither colors into nearby colors that already have enough beads.
   * Same idea as weapp grid-edit.mergeSparseColors; works on quantized ImageData RGB.
   * threshold: colors with 0 < count < threshold are remapped (clamped 1–20).
   * @returns {{ imageData, mergedColors: number, cells: number }}
   */
  function mergeSparseColors(imageData, threshold) {
    const thr = Math.max(1, Math.min(20, Math.round(Number(threshold) || 5)));
    const w = imageData.width | 0;
    const h = imageData.height | 0;
    const src = imageData.data;
    const alphaCut = 16;
    const counts = Object.create(null);
    const rgbs = Object.create(null);
    for (let i = 0; i < src.length; i += 4) {
      if (src[i + 3] < alphaCut) continue;
      const key = src[i] + "," + src[i + 1] + "," + src[i + 2];
      counts[key] = (counts[key] || 0) + 1;
      if (!rgbs[key]) rgbs[key] = [src[i], src[i + 1], src[i + 2]];
    }
    const keys = Object.keys(counts);
    let sparse = [];
    let keepers = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (counts[k] < thr) sparse.push(k);
      else keepers.push(k);
    }
    if (!keepers.length && sparse.length) {
      let maxC = 0;
      for (let i = 0; i < sparse.length; i++) {
        if (counts[sparse[i]] > maxC) maxC = counts[sparse[i]];
      }
      keepers = sparse.filter((k) => counts[k] === maxC);
      sparse = sparse.filter((k) => counts[k] < maxC);
    }
    if (!sparse.length || !keepers.length) {
      return { imageData, mergedColors: 0, cells: 0 };
    }
    sparse.sort((a, b) => counts[a] - counts[b] || (a < b ? -1 : 1));
    const remap = Object.create(null);
    for (let i = 0; i < sparse.length; i++) {
      const from = sparse[i];
      const srcRgb = rgbs[from];
      let best = keepers[0];
      let bestD = dist2(srcRgb, rgbs[best]);
      for (let k = 1; k < keepers.length; k++) {
        const t = keepers[k];
        const d = dist2(srcRgb, rgbs[t]);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      remap[from] = best;
    }
    const out =
      typeof ImageData !== "undefined"
        ? new ImageData(new Uint8ClampedArray(src), w, h)
        : { width: w, height: h, data: new Uint8ClampedArray(src) };
    const dst = out.data;
    let cells = 0;
    for (let i = 0; i < dst.length; i += 4) {
      if (dst[i + 3] < alphaCut) continue;
      const key = dst[i] + "," + dst[i + 1] + "," + dst[i + 2];
      const to = remap[key];
      if (!to) continue;
      const rgb = rgbs[to];
      dst[i] = rgb[0];
      dst[i + 1] = rgb[1];
      dst[i + 2] = rgb[2];
      cells++;
    }
    return { imageData: out, mergedColors: sparse.length, cells };
  }

  function diffuse(buf, w, h, x, y, er, eg, eb, factor) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] += er * factor;
    buf[i + 1] += eg * factor;
    buf[i + 2] += eb * factor;
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function countColors(imageData, paletteColors, alphaCut) {
    const cut = alphaCut != null ? alphaCut : 16;
    const counts = Object.create(null);
    const byKey = Object.create(null);
    for (const c of paletteColors) {
      byKey[c.rgb[0] + "," + c.rgb[1] + "," + c.rgb[2]] = c.id;
    }
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < cut) continue;
      const key = d[i] + "," + d[i + 1] + "," + d[i + 2];
      let id = byKey[key];
      if (id == null) {
        id = nearestColor(d[i], d[i + 1], d[i + 2], paletteColors).id;
      }
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }

  function drawImageData(canvas, imageData, scale) {
    const s = Math.max(1, scale | 0);
    const tmp = document.createElement("canvas");
    tmp.width = imageData.width;
    tmp.height = imageData.height;
    tmp.getContext("2d").putImageData(imageData, 0, 0);
    canvas.width = imageData.width * s;
    canvas.height = imageData.height * s;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }

  function drawGridOverlay(canvas, cols, rows, scale, color) {
    const ctx = canvas.getContext("2d");
    const s = scale;
    ctx.strokeStyle = color || "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * s + 0.5, 0);
      ctx.lineTo(x * s + 0.5, rows * s);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * s + 0.5);
      ctx.lineTo(cols * s + 0.5, y * s + 0.5);
      ctx.stroke();
    }
  }

  function isIosDevice() {
    try {
      const ua = navigator.userAgent || "";
      if (/iPad|iPhone|iPod/i.test(ua)) return true;
      return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    } catch (_) {
      return false;
    }
  }

  function pngBlobFromDataUrl(canvas) {
    const url = canvas.toDataURL("image/png");
    const bin = atob(url.split(",")[1] || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "image/png" });
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve) => {
      let parked = false;
      try {
        if (!canvas.isConnected) {
          canvas.style.position = "fixed";
          canvas.style.left = "-10000px";
          canvas.style.top = "0";
          canvas.style.pointerEvents = "none";
          document.body.appendChild(canvas);
          parked = true;
        }
        if (canvas.toBlob) {
          canvas.toBlob((blob) => {
            try {
              if (blob) {
                resolve(blob);
                return;
              }
              resolve(pngBlobFromDataUrl(canvas));
            } catch (_) {
              resolve(null);
            } finally {
              if (parked && canvas.parentNode) canvas.remove();
            }
          }, "image/png");
          return;
        }
      } catch (_) { /* fall through */ }
      if (parked && canvas.parentNode) canvas.remove();
      try {
        resolve(pngBlobFromDataUrl(canvas));
      } catch (_) {
        resolve(null);
      }
    });
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "export.png";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function i18nOr(key, fallback) {
    try {
      const v = global.FGi18n && global.FGi18n.t && global.FGi18n.t(key);
      if (v && v !== key) return v;
    } catch (_) { /* ignore */ }
    return fallback;
  }

  let saveSheetEl = null;
  let saveSeq = 0;

  function ensureSaveSheet() {
    if (saveSheetEl) return saveSheetEl;
    const style = document.createElement("style");
    style.textContent =
      ".fg-save-sheet{position:fixed;inset:0;z-index:200;display:flex;align-items:flex-end;justify-content:center;background:rgba(20,12,4,.55);padding:12px 12px calc(12px + env(safe-area-inset-bottom,0px))}" +
      ".fg-save-sheet[hidden],.fg-save-sheet [hidden]{display:none!important}" +
      ".fg-save-sheet__card{width:min(520px,100%);max-height:min(88vh,760px);overflow:auto;background:#fffaf3;color:#1a1208;border-radius:16px 16px 12px 12px;padding:16px 16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.28)}" +
      ".fg-save-sheet__hint{margin:0 0 12px;font-size:.95rem;line-height:1.45}" +
      ".fg-save-sheet__imgs{display:flex;flex-direction:column;gap:12px}" +
      ".fg-save-sheet__imgs img{width:100%;height:auto;background:#fff;border-radius:8px;-webkit-touch-callout:default;-webkit-user-select:auto;user-select:auto}" +
      ".fg-save-sheet__actions{display:flex;flex-direction:column;gap:8px;margin-top:14px}" +
      "@media(min-width:720px){.fg-save-sheet{align-items:center}}";
    document.head.appendChild(style);
    const el = document.createElement("div");
    el.className = "fg-save-sheet";
    el.hidden = true;
    el.innerHTML =
      '<div class="fg-save-sheet__card" role="dialog" aria-modal="true">' +
      '<p class="fg-save-sheet__hint"></p>' +
      '<div class="fg-save-sheet__imgs"></div>' +
      '<div class="fg-save-sheet__actions">' +
      '<button type="button" class="btn btn--primary" data-act="share"></button>' +
      '<button type="button" class="btn btn--ghost" data-act="close"></button>' +
      "</div></div>";
    el.addEventListener("click", (e) => {
      if (e.target === el) closeSaveSheet();
    });
    el.querySelector("[data-act=close]").addEventListener("click", closeSaveSheet);
    el.querySelector("[data-act=share]").addEventListener("click", () => {
      const files = el._files || [];
      if (!files.length || !navigator.share) return;
      navigator.share({ files: files }).catch((err) => {
        if (err && err.name === "AbortError") return;
      });
    });
    document.body.appendChild(el);
    saveSheetEl = el;
    return el;
  }

  function closeSaveSheet() {
    saveSeq += 1;
    if (!saveSheetEl) return;
    saveSheetEl.hidden = true;
    const box = saveSheetEl.querySelector(".fg-save-sheet__imgs");
    if (box) box.innerHTML = "";
    (saveSheetEl._urls || []).forEach((u) => URL.revokeObjectURL(u));
    saveSheetEl._urls = [];
    saveSheetEl._files = [];
  }

  function showIosSaveSheet(files) {
    const el = ensureSaveSheet();
    (el._urls || []).forEach((u) => URL.revokeObjectURL(u));
    const box = el.querySelector(".fg-save-sheet__imgs");
    box.innerHTML = "";
    const urls = [];
    (files || []).forEach((file) => {
      const url = URL.createObjectURL(file);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = file.name || "";
      box.appendChild(img);
    });
    el._urls = urls;
    el._files = files || [];
    el.querySelector(".fg-save-sheet__hint").textContent = files && files.length
      ? i18nOr(
          "common.iosSaveHint",
          "长按图片，点「存储到照片」。也可以点下方按钮，在分享菜单里选「存储图像」。"
        )
      : i18nOr("common.iosSaveFail", "图片生成失败，请换小一点的尺寸再试。");
    const shareBtn = el.querySelector("[data-act=share]");
    let canShare = false;
    try {
      canShare = !!(files && files.length && navigator.canShare && navigator.canShare({ files: files }));
    } catch (_) {
      canShare = false;
    }
    shareBtn.hidden = !canShare;
    shareBtn.textContent = i18nOr("common.iosSaveShare", "存储到照片");
    el.querySelector("[data-act=close]").textContent = i18nOr("common.cancel", "关闭");
    el.hidden = false;
  }

  function downloadCanvasNow(canvas, filename) {
    const a = document.createElement("a");
    a.download = filename || "export.png";
    a.href = canvas.toDataURL("image/png");
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 2000);
  }

  /**
   * Desktop: download PNG. iOS Safari ignores a detached download link and
   * never puts files in Photos — show the image so long-press / share can save it.
   */
  function downloadCanvas(canvas, filename) {
    saveCanvases([{ canvas: canvas, filename: filename || "export.png" }]);
  }

  function saveCanvases(items) {
    const list = (items || []).filter((it) => it && it.canvas);
    if (!list.length) return;
    if (isIosDevice()) {
      const seq = ++saveSeq;
      const el = ensureSaveSheet();
      el.querySelector(".fg-save-sheet__hint").textContent = i18nOr(
        "common.iosSaveWorking",
        "正在生成图片…"
      );
      el.querySelector(".fg-save-sheet__imgs").innerHTML = "";
      el.querySelector("[data-act=share]").hidden = true;
      el.querySelector("[data-act=close]").textContent = i18nOr("common.cancel", "关闭");
      el.hidden = false;
      Promise.all(
        list.map((it) =>
          canvasToPngBlob(it.canvas).then((blob) => {
            if (!blob) return null;
            const name = it.filename || "export.png";
            try {
              return new File([blob], name, { type: "image/png" });
            } catch (_) {
              blob.name = name;
              return blob;
            }
          })
        )
      ).then((files) => {
        if (seq !== saveSeq || !saveSheetEl || saveSheetEl.hidden) return;
        showIosSaveSheet(files.filter(Boolean));
      });
      return;
    }
    list.forEach((it, i) => {
      setTimeout(() => downloadCanvasNow(it.canvas, it.filename), i * 400);
    });
  }

  /**
   * Scale canvas CSS box to show the full bitmap inside a wrap (no crop / no scroll).
   * Bitmap width/height attributes stay at native resolution for export.
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} [wrap] parent .canvas-wrap; defaults to canvas.parentElement
   * @param {{ maxHeightPx?: number, maxHeightVh?: number }} [opts]
   */
  function fitCanvasInWrap(canvas, wrap, opts) {
    if (!canvas || !canvas.width || !canvas.height) return;
    const box = wrap || canvas.parentElement;
    if (!box) return;
    const o = opts || {};
    const styles = getComputedStyle(box);
    const padX =
      (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    const padY =
      (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    const maxW = Math.max(64, (box.clientWidth || box.offsetWidth || 0) - padX);
    const vhCap = ((o.maxHeightVh != null ? o.maxHeightVh : 70) / 100) * window.innerHeight;
    const pxCap = o.maxHeightPx != null ? o.maxHeightPx : 560;
    const maxH = Math.max(64, Math.min(vhCap, pxCap) - padY);
    const scale = Math.min(1, maxW / canvas.width, maxH / canvas.height);
    const dw = Math.max(1, Math.round(canvas.width * scale));
    const dh = Math.max(1, Math.round(canvas.height * scale));
    canvas.style.width = dw + "px";
    canvas.style.height = dh + "px";
  }

  function sliceImageData(imageData, x0, y0, w, h) {
    const sw = imageData.width;
    const out = new ImageData(w, h);
    const src = imageData.data;
    const dst = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((y0 + y) * sw + (x0 + x)) * 4;
        const di = (y * w + x) * 4;
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      }
    }
    return out;
  }

  /** Square-cell pattern for print (physical alignment friendlier than bead circles). */
  function drawPrintCellGrid(canvas, imageData, cell, opts) {
    const o = opts || {};
    const cols = imageData.width;
    const rows = imageData.height;
    const csize = Math.max(4, cell | 0);
    const majorEvery = Math.max(0, o.majorEvery | 0);
    canvas.width = cols * csize;
    canvas.height = rows * csize;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = o.bg || "#f2f2f0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        if (d[i + 3] < 16) continue;
        ctx.fillStyle = rgbToHex(d[i], d[i + 1], d[i + 2]);
        ctx.fillRect(x * csize, y * csize, csize, csize);
      }
    }
    // Minor grid
    ctx.strokeStyle = o.minorColor || "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * csize + 0.5, 0);
      ctx.lineTo(x * csize + 0.5, rows * csize);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * csize + 0.5);
      ctx.lineTo(cols * csize + 0.5, y * csize + 0.5);
      ctx.stroke();
    }
    if (majorEvery > 0) {
      ctx.strokeStyle = o.majorColor || "rgba(0,0,0,0.55)";
      ctx.lineWidth = 2;
      for (let x = 0; x <= cols; x += majorEvery) {
        ctx.beginPath();
        ctx.moveTo(x * csize + 0.5, 0);
        ctx.lineTo(x * csize + 0.5, rows * csize);
        ctx.stroke();
      }
      for (let y = 0; y <= rows; y += majorEvery) {
        ctx.beginPath();
        ctx.moveTo(0, y * csize + 0.5);
        ctx.lineTo(cols * csize + 0.5, y * csize + 0.5);
        ctx.stroke();
      }
    }
  }

  function drawAlignMarks(ctx, px, py, pw, ph) {
    const len = 14;
    const gap = 6;
    ctx.strokeStyle = "#1a1208";
    ctx.lineWidth = 1.5;
    const corners = [
      [px, py, 1, 1],
      [px + pw, py, -1, 1],
      [px, py + ph, 1, -1],
      [px + pw, py + ph, -1, -1],
    ];
    corners.forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x - sx * gap, y - sy * (gap + len));
      ctx.lineTo(x - sx * gap, y - sy * gap);
      ctx.lineTo(x - sx * (gap + len), y - sy * gap);
      ctx.stroke();
    });
  }

  /**
   * Print-friendly sheet: white page, pattern + bead legend with counts.
   * opts: { imageData, palette, counts, title, subtitle, footer, cell,
   *         printGrid, majorEvery, alignMarks, pegPitchMm, pageLabel }
   */
  function composePrintSheet(opts) {
    const imageData = opts.imageData;
    const palette = opts.palette;
    const counts = opts.counts || {};
    /* Allow larger cells when overlaying bead codes for print readability. */
    const cell = Math.max(6, Math.min(28, opts.cell | 0 || 8));
    const pad = 36;
    const markPad = opts.alignMarks === false ? 0 : 18;
    const title = opts.title || "Perler pattern";
    const subtitle = opts.subtitle || "";
    const footer = opts.footer || "";
    const majorEvery = opts.majorEvery != null ? opts.majorEvery : 10;

    const pattern = document.createElement("canvas");
    if (opts.printGrid) {
      drawPrintCellGrid(pattern, imageData, cell, {
        bg: "#f2f2f0",
        majorEvery: majorEvery,
        minorColor: opts.minorColor,
        majorColor: opts.majorColor,
      });
    } else {
      drawBeadGrid(pattern, imageData, cell, 1, { bg: "#f2f2f0" });
    }
    if (opts.cellCodes && palette && palette.colors) {
      drawCellCodeOverlay(pattern, imageData, cell, {
        beads: !opts.printGrid,
        gap: opts.printGrid ? 0 : 1,
        paletteColors: palette.colors,
        labelFn: opts.labelFn,
        sharp: true,
      });
    }

    const rows = (palette.colors || [])
      .map((c) => ({ c, n: counts[c.id] || 0 }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n);

    const mode = opts.sheetMode || "both";
    const showPattern = mode !== "legend";
    const showLegend = mode !== "pattern";

    /* Base legend metrics — scale up when the pattern is much wider (codes PNG). */
    const baseSwW = 44;
    const baseSwH = 18;
    const baseCodeCol = 108;
    const baseQtyCol = 56;
    const baseGap = 16;
    const baseUnitW = 8 + baseSwW + 10 + baseCodeCol + 8 + baseQtyCol;
    const baseRowH = 28;
    let legendCols = Math.max(
      1,
      Math.min(3, rows.length > 24 ? 3 : rows.length > 12 ? 2 : 1)
    );
    if (showPattern && showLegend && pattern.width > baseUnitW * 2) {
      const fitCols = Math.floor((pattern.width + baseGap) / (baseUnitW + baseGap));
      legendCols = Math.max(
        legendCols,
        Math.min(6, Math.min(rows.length || 1, Math.max(1, fitCols)))
      );
    }
    let legendInnerW = legendCols * baseUnitW + (legendCols - 1) * baseGap;
    let legendScale = 1;
    if (opts.legendScale != null && +opts.legendScale > 0) {
      legendScale = Math.max(0.75, Math.min(4, +opts.legendScale));
    } else if (showPattern && showLegend && pattern.width > legendInnerW * 1.25) {
      /* Fill most of the pattern width; soft cap so rows stay readable, not huge. */
      legendScale = Math.min(2.75, Math.max(1, (pattern.width * 0.96) / legendInnerW));
    }
    const s = legendScale;
    const swW = Math.round(baseSwW * s);
    const swH = Math.round(baseSwH * s);
    const codeCol = Math.round(baseCodeCol * s);
    const qtyCol = Math.round(baseQtyCol * s);
    const gap = Math.round(baseGap * s);
    const unitW = Math.round((8 + baseSwW + 10 + baseCodeCol + 8 + baseQtyCol) * s);
    const rowH = Math.round(baseRowH * s);
    const padL = Math.round(8 * s);
    const fontTitle = Math.max(14, Math.round(15 * s));
    const fontHead = Math.max(11, Math.round(12 * s));
    const fontBody = Math.max(12, Math.round(13 * s));
    const textY = Math.round(rowH * 0.64);
    legendInnerW = legendCols * unitW + (legendCols - 1) * gap;
    const legendBodyRows = Math.ceil(rows.length / legendCols) || 1;
    const legendTitleH = Math.round(22 * s);
    const legendH = showLegend
      ? legendTitleH + 8 + (legendBodyRows + 1) * rowH
      : 0;
    const headerH = subtitle ? 72 : 52;
    const footerH = footer ? 36 : 16;
    const legendGap = Math.round(28 * Math.min(s, 1.6));

    const contentW = Math.max(showPattern ? pattern.width : 0, showLegend ? legendInnerW : 0, 280);
    const patternBlock = showPattern ? markPad + pattern.height + markPad : 0;
    const w = pad * 2 + (showPattern ? markPad * 2 : 0) + contentW;
    const h = pad + headerH + patternBlock + (showLegend ? legendGap + legendH : 8) + footerH + pad;

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#1a1208";
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.fillText(title, pad, pad + 22);
    if (subtitle) {
      ctx.fillStyle = "#5a5348";
      ctx.font = "400 14px system-ui, sans-serif";
      ctx.fillText(subtitle, pad, pad + 46);
    }
    if (opts.pageLabel) {
      ctx.fillStyle = "#8a8070";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillText(opts.pageLabel, w - pad - 160, pad + 22);
    }

    let ly = pad + headerH;
    let legendX0 = pad;
    if (showPattern) {
      const px = pad + markPad + Math.floor((contentW - pattern.width) / 2);
      const py = pad + markPad + headerH;
      ctx.drawImage(pattern, px, py);
      if (opts.alignMarks !== false) {
        drawAlignMarks(ctx, px, py, pattern.width, pattern.height);
      }
      ly = py + pattern.height + markPad + legendGap;
      legendX0 = px;
    }

    if (showLegend) {
      const headers = opts.legendHeaders || ["Color", "Code", "Count"];
      ctx.fillStyle = "#1a1208";
      ctx.font = "600 " + fontTitle + "px system-ui, sans-serif";
      ctx.fillText(opts.legendTitle || "Bead counts", legendX0, ly);
      ly += legendTitleH;
      const stride = unitW + gap;
      function cellLabel(c) {
        return (
          (global.FGPalettes && FGPalettes.legendLabel(c)) ||
          (c.code && String(c.code)) ||
          (c.name && typeof c.name === "object" ? c.name.en || c.name.zh : c.name) ||
          (c.id != null ? "#" + c.id : "") ||
          c.hex
        );
      }
      function drawTableHead(x, y) {
        ctx.fillStyle = "#f4efe6";
        ctx.fillRect(x, y, unitW, rowH);
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.strokeRect(x + 0.5, y + 0.5, unitW - 1, rowH - 1);
        ctx.fillStyle = "#3a3228";
        ctx.font = "600 " + fontHead + "px system-ui, sans-serif";
        ctx.fillText(headers[0] || "Color", x + padL, y + textY);
        ctx.fillText(headers[1] || "Code", x + padL + swW + Math.round(10 * s), y + textY);
        ctx.fillText(
          headers[2] || "Count",
          x + padL + swW + Math.round(10 * s) + codeCol,
          y + textY
        );
      }
      for (let col = 0; col < legendCols; col++) drawTableHead(legendX0 + col * stride, ly);
      ly += rowH;
      rows.forEach((r, i) => {
        const col = i % legendCols;
        const row = (i / legendCols) | 0;
        const x = legendX0 + col * stride;
        const y = ly + row * rowH;
        ctx.fillStyle = row % 2 ? "#faf8f4" : "#ffffff";
        ctx.fillRect(x, y, unitW, rowH);
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.strokeRect(x + 0.5, y + 0.5, unitW - 1, rowH - 1);
        const sy = y + Math.floor((rowH - swH) / 2);
        ctx.fillStyle = r.c.hex;
        ctx.fillRect(x + padL, sy, swW, swH);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.strokeRect(x + padL + 0.5, sy + 0.5, swW - 1, swH - 1);
        ctx.fillStyle = "#1a1208";
        ctx.font = "400 " + fontBody + "px system-ui, sans-serif";
        ctx.fillText(
          String(cellLabel(r.c)),
          x + padL + swW + Math.round(10 * s),
          y + textY
        );
        ctx.font = "700 " + fontBody + "px system-ui, sans-serif";
        ctx.fillText(
          String(r.n),
          x + padL + swW + Math.round(10 * s) + codeCol,
          y + textY
        );
      });
    }

    if (footer) {
      ctx.fillStyle = "#7a7268";
      ctx.font = "400 12px system-ui, sans-serif";
      ctx.fillText(footer, pad, h - pad);
    }

    return out;
  }

  /**
   * Split a large grid into board-sized print pages (e.g. 29×29).
   * Returns an array of canvases. tileSize <= 0 → single full sheet.
   */
  function composePrintBoardPages(opts) {
    const imageData = opts.imageData;
    const tile = Math.max(0, opts.tileSize | 0);
    const cols = imageData.width;
    const rows = imageData.height;
    if (!tile || (cols <= tile && rows <= tile)) {
      return [
        composePrintSheet(
          Object.assign({}, opts, {
            printGrid: opts.printGrid !== false,
            pageLabel: opts.pageLabel || "",
          })
        ),
      ];
    }

    const pages = [];
    let page = 0;
    const tilesX = Math.ceil(cols / tile);
    const tilesY = Math.ceil(rows / tile);
    const total = tilesX * tilesY;
    for (let ty = 0; ty < rows; ty += tile) {
      for (let tx = 0; tx < cols; tx += tile) {
        const tw = Math.min(tile, cols - tx);
        const th = Math.min(tile, rows - ty);
        const slice = sliceImageData(imageData, tx, ty, tw, th);
        const tileCounts = countColors(slice, (opts.palette && opts.palette.colors) || []);
        page += 1;
        const col = (tx / tile) | 0;
        const row = (ty / tile) | 0;
        const pageLabel = `${page}/${total} · R${row + 1}C${col + 1} · (${tx},${ty})-(${tx + tw},${ty + th})`;
        pages.push(
          composePrintSheet(
            Object.assign({}, opts, {
              imageData: slice,
              counts: tileCounts,
              printGrid: opts.printGrid !== false,
              pageLabel: pageLabel,
              subtitle:
                (opts.subtitle || "") +
                (opts.subtitle ? " · " : "") +
                pageLabel,
            })
          )
        );
      }
    }
    return pages;
  }

  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    triggerBlobDownload(blob, filename || "export.txt");
  }

  /** WeChat / QQ WebView — file picker quirks. */
  function isInAppBrowser() {
    try {
      return /MicroMessenger|QQ\//i.test(navigator.userAgent || "");
    } catch (_) {
      return false;
    }
  }

  /**
   * Tune & expose a file input so WeChat/iOS can open the album.
   * Never use display:none / [hidden] + programmatic .click() in WeChat.
   */
  function prepareFileInput(input, opts) {
    if (!input) return null;
    const accept =
      (opts && opts.accept) ||
      input.getAttribute("accept") ||
      "image/jpeg,image/jpg,image/png,image/webp,image/gif,image/*";
    input.setAttribute("accept", accept);
    input.removeAttribute("capture");
    input.removeAttribute("hidden");
    input.style.display = "";
    input.classList.add("fg-file-input");
    return input;
  }

  /**
   * Dropzone: opaque hit-target is the <input> itself (opacity ~0 overlay).
   * Do NOT call input.click() from a parent listener — WeChat blocks that.
   */
  function setupDropzone(el, onFile, opts) {
    if (!el) return;
    el.classList.add("dropzone--file");
    let input = el.querySelector('input[type="file"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      el.appendChild(input);
    }
    prepareFileInput(input, opts);

    // Tip once for in-app browsers (album may still work after overlay fix)
    if (isInAppBrowser() && !el.querySelector(".dropzone__wx-tip")) {
      const tip = document.createElement("div");
      tip.className = "dropzone__wx-tip";
      const tipText =
        (opts && opts.wxTip) ||
        (global.FGi18n && global.FGi18n.t && global.FGi18n.t("common.wxTip")) ||
        "微信内请直接点此区域选图；若无反应，点右上角 ⋯ 用系统浏览器打开";
      tip.textContent = tipText;
      tip.setAttribute("data-i18n", "common.wxTip");
      el.appendChild(tip);
    }

    function onDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("is-drag");
    }
    function onDragLeave(e) {
      e.preventDefault();
      el.classList.remove("is-drag");
    }
    function onDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("is-drag");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    }
    // Bind on both zone and the overlay <input> — some browsers deliver drop to the input only.
    [el, input].forEach((target) => {
      target.addEventListener("dragover", onDragOver);
      target.addEventListener("dragleave", onDragLeave);
      target.addEventListener("drop", onDrop);
    });

    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      if (f) onFile(f);
      try {
        input.value = "";
      } catch (_) {
        /* ignore */
      }
    });
  }

  global.FGImage = {
    loadImageFromFile,
    rotateImageCW90,
    imageToImageData,
    fitImageToSquare,
    adjustImageData,
    nearestColor,
    extractPalette,
    quantizeImageData,
    mergeSparseColors,
    countColors,
    drawImageData,
    drawBeadGrid,
    drawCellCodeOverlay,
    removeBackgroundEdgeFlood,
    mirrorImageDataH,
    drawGridOverlay,
    downloadCanvas,
    saveCanvases,
    fitCanvasInWrap,
    downloadText,
    composePrintSheet,
    composePrintBoardPages,
    drawPrintCellGrid,
    sliceImageData,
    setupDropzone,
    prepareFileInput,
    isInAppBrowser,
    rgbToHex,
    dist2,
  };
})(typeof window !== "undefined" ? window : globalThis);
