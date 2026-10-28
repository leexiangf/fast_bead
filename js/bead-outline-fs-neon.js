/**
 * FGBeadOutlineFsNeon — glow / neon on dark canvases.
 *
 * Keeps the bright / high-chroma neon CORE only; soft bloom and black canvas
 * are flooded away so the sticker is actually cut out (unlike full-frame FS).
 * Light outline for contrast on dark previews.
 * History: docs/bead-outline-fs.md
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.FGBeadOutlineFsNeon = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const DEFAULTS = {
    alphaCut: 16,
    ditherStrength: 0.85,
    smoothPasses: 1,
    expandBeads: 1,
    rimCleanDepth: 2,
    rimCleanPasses: 2,
    satelliteGap: 6,
    satelliteMinSize: 2,
    /* Hard neon: clearly brighter than dark paper. */
    neonDL: 16,
    /* Neon tubes: strong chroma even if only moderately bright. */
    neonChroma: 18,
    neonDLSoft: 9,
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

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
    for (let i = 0; i < paletteColors.length; i++) {
      const c = paletteColors[i];
      const d = dist2([r, g, b], c.rgb || [0, 0, 0]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  function diffuse(buf, w, h, x, y, er, eg, eb, factor) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] += er * factor;
    buf[i + 1] += eg * factor;
    buf[i + 2] += eb * factor;
  }

  function floydSteinberg(imageData, paletteColors, strength, alphaCut) {
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;
    const out = new ImageData(w, h);
    const dst = out.data;
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

  function neighbors4(w, h, idx) {
    const x = idx % w;
    const y = (idx / w) | 0;
    const out = [];
    if (x > 0) out.push(idx - 1);
    if (x + 1 < w) out.push(idx + 1);
    if (y > 0) out.push(idx - w);
    if (y + 1 < h) out.push(idx + w);
    return out;
  }

  function neighbors8(w, h, idx) {
    const x = idx % w;
    const y = (idx / w) | 0;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        out.push(ny * w + nx);
      }
    }
    return out;
  }

  function countSubject(mask, indices) {
    let n = 0;
    for (let i = 0; i < indices.length; i++) {
      if (mask[indices[i]]) n++;
    }
    return n;
  }

  function dilate4(mask, w, h) {
    const n = w * h;
    const out = new Uint8Array(mask);
    for (let p = 0; p < n; p++) {
      if (mask[p]) continue;
      const nbs = neighbors4(w, h, p);
      for (let k = 0; k < nbs.length; k++) {
        if (mask[nbs[k]]) {
          out[p] = 1;
          break;
        }
      }
    }
    return out;
  }

  function erode4(mask, w, h) {
    const n = w * h;
    const out = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (!mask[p]) continue;
      const nbs = neighbors4(w, h, p);
      let keep = nbs.length === 4;
      for (let k = 0; k < nbs.length && keep; k++) {
        if (!mask[nbs[k]]) keep = false;
      }
      if (keep) out[p] = 1;
    }
    return out;
  }

  /**
   *「完美」crab tidy: morph close + fill shallow notches + light despike.
   * Keeps leg crotches as exterior so outward outline still strokes joints.
   */
  function smoothSilhouette(subject, w, h, passes) {
    let cur = fillHoles(subject, w, h);
    cur = erode4(dilate4(cur, w, h), w, h);
    cur = fillHoles(cur, w, h);

    const nPass = Math.max(0, passes | 0);
    for (let pass = 0; pass < nPass; pass++) {
      const next = new Uint8Array(cur);
      for (let p = 0; p < w * h; p++) {
        const n8 = neighbors8(w, h, p);
        const c8 = countSubject(cur, n8);
        if (!cur[p]) {
          if (c8 >= 5) next[p] = 1;
        } else {
          const n4 = neighbors4(w, h, p);
          const c4 = countSubject(cur, n4);
          let touchesOut = n4.length < 4;
          for (let k = 0; k < n4.length && !touchesOut; k++) {
            if (!cur[n4[k]]) touchesOut = true;
          }
          if (touchesOut && c8 <= 2) next[p] = 0;
          else if (touchesOut && c4 === 2 && c8 <= 4) {
            const x = p % w;
            const y = (p / w) | 0;
            let hasH = false;
            let hasV = false;
            for (let k = 0; k < n4.length; k++) {
              if (!cur[n4[k]]) continue;
              const nx = n4[k] % w;
              const ny = (n4[k] / w) | 0;
              if (ny === y) hasH = true;
              if (nx === x) hasV = true;
            }
            if (hasH && hasV) next[p] = 0;
          }
        }
      }
      cur = fillHoles(next, w, h);
    }
    /* Re-attach satellites after despike; do not largestCc-only. */
    return keepMainAndSatellites(cur, w, h).mask;
  }

  function rgbToLab(r, g, b) {
    let R = r / 255;
    let G = g / 255;
    let B = b / 255;
    R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
    G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
    B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
    let x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    let y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / 1.0;
    let z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = f(x);
    y = f(y);
    z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  function labDist2(a, b) {
    const dL = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return dL * dL + da * da + db * db;
  }

  /** Lab ΔE-ish to paper — catches gray fur that opp-chroma misses. */
  function paperDist(r, g, b, paperLab) {
    return Math.sqrt(labDist2(rgbToLab(r, g, b), paperLab));
  }

  function borderPaperMean(imageData, alphaCut) {
    const w = imageData.width;
    const h = imageData.height;
    const d = imageData.data;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let cnt = 0;
    function add(x, y) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < alphaCut) return;
      sr += d[i];
      sg += d[i + 1];
      sb += d[i + 2];
      cnt++;
    }
    for (let x = 0; x < w; x++) {
      add(x, 0);
      if (h > 1) add(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
      add(0, y);
      if (w > 1) add(w - 1, y);
    }
    if (cnt < 4) {
      const rgb = [245, 240, 230];
      return { rgb: rgb, lab: rgbToLab(rgb[0], rgb[1], rgb[2]) };
    }
    const r = (sr / cnt) | 0;
    const g = (sg / cnt) | 0;
    const b = (sb / cnt) | 0;
    return { rgb: [r, g, b], lab: rgbToLab(r, g, b) };
  }

  function otsuThreshold(scores, valid) {
    const hist = new Float64Array(256);
    let total = 0;
    for (let i = 0; i < scores.length; i++) {
      if (!valid[i]) continue;
      let v = scores[i];
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      hist[v | 0]++;
      total++;
    }
    if (total < 8) return 40;
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let bestT = 40;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) {
        best = between;
        bestT = t;
      }
    }
    return bestT;
  }

  function listCCs(cand, w, h) {
    const n = w * h;
    const seen = new Uint8Array(n);
    const q = new Int32Array(n);
    const list = [];
    for (let seed = 0; seed < n; seed++) {
      if (!cand[seed] || seen[seed]) continue;
      let head = 0;
      let tail = 0;
      const members = [];
      q[tail++] = seed;
      seen[seed] = 1;
      while (head < tail) {
        const idx = q[head++];
        members.push(idx);
        const nbs = neighbors4(w, h, idx);
        for (let k = 0; k < nbs.length; k++) {
          const nidx = nbs[k];
          if (seen[nidx] || !cand[nidx]) continue;
          seen[nidx] = 1;
          q[tail++] = nidx;
        }
      }
      list.push(members);
    }
    list.sort((a, b) => b.length - a.length);
    return list;
  }

  function largestCc(cand, w, h) {
    const list = listCCs(cand, w, h);
    const n = w * h;
    const bestMask = new Uint8Array(n);
    if (!list.length) return { mask: bestMask, size: 0 };
    for (let m = 0; m < list[0].length; m++) bestMask[list[0][m]] = 1;
    return { mask: bestMask, size: list[0].length };
  }

  /**
   * Main blob + nearby paint islands (horns). Dark ink only in the corridor
   * between main and satellites — never around the whole silhouette (crab).
   */
  function keepMainAndSatellites(cand, w, h, srcRgba, alphaCut) {
    const list = listCCs(cand, w, h);
    const n = w * h;
    const out = new Uint8Array(n);
    const protect = new Uint8Array(n);
    if (!list.length) return { mask: out, protect: protect };

    const main = list[0];
    const mainOnly = new Uint8Array(n);
    for (let m = 0; m < main.length; m++) {
      out[main[m]] = 1;
      mainOnly[main[m]] = 1;
    }

    const gap = DEFAULTS.satelliteGap;
    const minSz = DEFAULTS.satelliteMinSize;
    if (list.length < 2) return { mask: out, protect: protect };

    let prox = mainOnly;
    for (let i = 0; i < gap; i++) prox = dilate4(prox, w, h);

    const sats = new Uint8Array(n);
    let merged = 0;
    for (let c = 1; c < list.length; c++) {
      const members = list[c];
      if (members.length < minSz) continue;
      let near = false;
      for (let m = 0; m < members.length; m++) {
        if (prox[members[m]]) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      merged++;
      for (let m = 0; m < members.length; m++) {
        out[members[m]] = 1;
        sats[members[m]] = 1;
        protect[members[m]] = 1;
      }
    }

    if (merged && srcRgba) {
      let nearMain = mainOnly;
      let nearSat = sats;
      const bridge = Math.min(gap, 3);
      for (let i = 0; i < bridge; i++) {
        nearMain = dilate4(nearMain, w, h);
        nearSat = dilate4(nearSat, w, h);
      }
      const cut = alphaCut != null ? alphaCut : 16;
      for (let p = 0; p < n; p++) {
        if (out[p] || !nearMain[p] || !nearSat[p]) continue;
        const i = p * 4;
        if (srcRgba[i + 3] < cut) continue;
        if (luminance(srcRgba[i], srcRgba[i + 1], srcRgba[i + 2]) > 70) continue;
        out[p] = 1;
      }
    }
    return { mask: out, protect: protect };
  }

  function markExterior(subject, w, h) {
    const n = w * h;
    const exterior = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0;
    let tail = 0;
    function trySeed(p) {
      if (p < 0 || p >= n || exterior[p] || subject[p]) return;
      exterior[p] = 1;
      q[tail++] = p;
    }
    for (let x = 0; x < w; x++) {
      trySeed(x);
      if (h > 1) trySeed((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      trySeed(y * w);
      if (w > 1) trySeed(y * w + (w - 1));
    }
    while (head < tail) {
      const idx = q[head++];
      const nbs = neighbors4(w, h, idx);
      for (let k = 0; k < nbs.length; k++) trySeed(nbs[k]);
    }
    return exterior;
  }

  function fillHoles(subject, w, h) {
    const exterior = markExterior(subject, w, h);
    const n = w * h;
    const out = new Uint8Array(subject);
    for (let p = 0; p < n; p++) {
      if (!subject[p] && !exterior[p]) out[p] = 1;
    }
    return out;
  }

  function outlineOutward(subject, w, h) {
    const n = w * h;
    const exterior = markExterior(subject, w, h);
    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (!exterior[p]) continue;
      const nbs = neighbors4(w, h, p);
      for (let k = 0; k < nbs.length; k++) {
        if (subject[nbs[k]]) {
          mask[p] = 1;
          break;
        }
      }
    }
    return mask;
  }

  function expandNearPaint(subject, scores, maxScore, w, h, passes) {
    const nPass = Math.max(0, passes | 0);
    if (!nPass) return subject;
    const soft = Math.max(1e-3, maxScore * 0.12);
    let cur = subject;
    for (let pass = 0; pass < nPass; pass++) {
      const grown = dilate4(cur, w, h);
      const next = new Uint8Array(cur);
      for (let p = 0; p < w * h; p++) {
        if (!grown[p] || cur[p]) continue;
        if (scores[p] >= soft) next[p] = 1;
      }
      cur = fillHoles(next, w, h);
    }
    return keepMainAndSatellites(cur, w, h).mask;
  }

  /**
   * Paper = low Lab distance. Flood from image border through paper-like pixels;
   * everything the flood cannot reach is the sticker.
   */
  function floodPaperExterior(paperLike, w, h) {
    const n = w * h;
    const exterior = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0;
    let tail = 0;
    function trySeed(p) {
      if (p < 0 || p >= n || exterior[p] || !paperLike[p]) return;
      exterior[p] = 1;
      q[tail++] = p;
    }
    for (let x = 0; x < w; x++) {
      trySeed(x);
      if (h > 1) trySeed((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      trySeed(y * w);
      if (w > 1) trySeed(y * w + (w - 1));
    }
    while (head < tail) {
      const idx = q[head++];
      const nbs = neighbors4(w, h, idx);
      for (let k = 0; k < nbs.length; k++) trySeed(nbs[k]);
    }
    return exterior;
  }

  function extractSubject(imageData, alphaCut, smoothPasses, expandBeads, neonOpts) {
    const w = imageData.width;
    const h = imageData.height;
    const d = imageData.data;
    const n = w * h;
    const paper = borderPaperMean(imageData, alphaCut);
    const paperL = paper.lab[0];
    const scores = new Float32Array(n);
    const valid = new Uint8Array(n);
    const core = new Uint8Array(n);
    let maxScore = 1;

    const neonDL =
      neonOpts && neonOpts.neonDL != null ? +neonOpts.neonDL : DEFAULTS.neonDL;
    const neonChroma =
      neonOpts && neonOpts.neonChroma != null
        ? +neonOpts.neonChroma
        : DEFAULTS.neonChroma;
    const neonDLSoft =
      neonOpts && neonOpts.neonDLSoft != null
        ? +neonOpts.neonDLSoft
        : DEFAULTS.neonDLSoft;

    for (let p = 0; p < n; p++) {
      const i = p * 4;
      if (d[i + 3] < alphaCut) continue;
      const lab = rgbToLab(d[i], d[i + 1], d[i + 2]);
      const s = Math.sqrt(labDist2(lab, paper.lab));
      scores[p] = s;
      valid[p] = 1;
      if (s > maxScore) maxScore = s;
      const dL = lab[0] - paperL;
      const chroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
      /* Neon core only — soft bloom stays out so we can clear the canvas. */
      if (dL >= neonDL || (chroma >= neonChroma && dL >= neonDLSoft)) {
        core[p] = 1;
      }
    }

    function buildCore(dl, ch, dlSoft) {
      const c = new Uint8Array(n);
      for (let p = 0; p < n; p++) {
        if (!valid[p]) continue;
        const i = p * 4;
        const lab = rgbToLab(d[i], d[i + 1], d[i + 2]);
        const dL = lab[0] - paperL;
        const chroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
        if (dL >= dl || (chroma >= ch && dL >= dlSoft)) c[p] = 1;
      }
      /* Everything that is not neon core is traversable "paper" (black + glow). */
      const paperLike = new Uint8Array(n);
      for (let p = 0; p < n; p++) {
        if (!valid[p] || !c[p]) paperLike[p] = 1;
      }
      const exterior = floodPaperExterior(paperLike, w, h);
      const cand = new Uint8Array(n);
      for (let p = 0; p < n; p++) {
        if (c[p] || (valid[p] && !exterior[p])) cand[p] = 1;
      }
      return keepMainAndSatellites(cand, w, h, d, alphaCut);
    }

    function scoreNeon(mask) {
      let area = 0;
      let validN = 0;
      let coreKeep = 0;
      let coreAll = 0;
      for (let p = 0; p < n; p++) {
        if (!valid[p]) continue;
        validN++;
        if (core[p]) coreAll++;
        if (mask[p]) {
          area++;
          if (core[p]) coreKeep++;
        }
      }
      if (area < 8) return -1e9;
      const frac = validN ? area / validN : 0;
      let q = area;
      /* Prefer a real cutout — penalize near-full-frame masks (FS lookalike). */
      if (frac > 0.85) q *= 0.08;
      else if (frac > 0.65) q *= 0.35;
      if (frac < 0.01) q *= 0.2;
      const cr = coreAll ? coreKeep / coreAll : 0;
      q *= 0.15 + 0.85 * cr;
      return q;
    }

    const trials = [
      { dl: neonDL, ch: neonChroma, soft: neonDLSoft },
      { dl: neonDL * 0.85, ch: neonChroma * 0.85, soft: neonDLSoft * 0.85 },
      { dl: neonDL * 1.15, ch: neonChroma, soft: neonDLSoft },
      { dl: Math.max(12, neonDL - 4), ch: Math.max(12, neonChroma - 4), soft: 7 },
    ];

    let best = null;
    let bestQ = -Infinity;
    for (let t = 0; t < trials.length; t++) {
      const merged = buildCore(trials[t].dl, trials[t].ch, trials[t].soft);
      const q = scoreNeon(merged.mask);
      if (q > bestQ) {
        bestQ = q;
        best = merged;
      }
    }

    let mask = best.mask;
    const rimProtect = best.protect;

    /* If still almost full-frame, fall back to core-only (no flood pockets). */
    let area = 0;
    let validN = 0;
    for (let p = 0; p < n; p++) {
      if (valid[p]) validN++;
      if (mask[p]) area++;
    }
    if (validN && area / validN > 0.75) {
      const coreOnly = new Uint8Array(core);
      best = keepMainAndSatellites(coreOnly, w, h, d, alphaCut);
      mask = best.mask;
      for (let p = 0; p < n; p++) if (best.protect[p]) rimProtect[p] = 1;
    }

    mask = smoothSilhouette(
      mask,
      w,
      h,
      smoothPasses != null ? smoothPasses : DEFAULTS.smoothPasses
    );
    mask = expandNearPaint(
      mask,
      scores,
      maxScore,
      w,
      h,
      expandBeads != null ? expandBeads : DEFAULTS.expandBeads
    );
    /* Drop soft glow that expand pulled in: keep only pixels still neon-ish or core-adjacent. */
    {
      const kept = new Uint8Array(mask);
      for (let p = 0; p < n; p++) {
        if (!mask[p] || !valid[p]) continue;
        if (core[p]) continue;
        const i = p * 4;
        const lab = rgbToLab(d[i], d[i + 1], d[i + 2]);
        const dL = lab[0] - paperL;
        if (dL < neonDLSoft * 0.75) kept[p] = 0;
      }
      mask = kept;
    }
    mask = keepMainAndSatellites(mask, w, h, d, alphaCut).mask;
    mask = fillHoles(mask, w, h);
    return { mask: mask, rimProtect: rimProtect, paperRgb: paper.rgb };
  }

  /** Dark canvas → light outline so the stroke stays visible. */
  function pickOutlineInk(paletteColors, paperRgb) {
    const pL = luminance(paperRgb[0], paperRgb[1], paperRgb[2]);
    if (pL < 55) return nearestColor(245, 245, 250, paletteColors);
    return nearestColor(0, 0, 0, paletteColors);
  }

  /**「完美」rim: snap fringe to body. Satellite accents skipped via rimProtect. */
  function cleanRimColors(dst, subject, outline, w, h, rimDepth, passes, rimProtect) {
    const n = w * h;
    const depth = Math.max(1, rimDepth | 0);
    const nPass = Math.max(1, passes | 0);

    const dist = new Int16Array(n);
    for (let i = 0; i < n; i++) dist[i] = -1;
    const q = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let p = 0; p < n; p++) {
      if (!outline[p]) continue;
      dist[p] = 0;
      q[tail++] = p;
    }
    while (head < tail) {
      const p = q[head++];
      const d0 = dist[p];
      if (d0 >= depth) continue;
      const nbs = neighbors4(w, h, p);
      for (let k = 0; k < nbs.length; k++) {
        const nb = nbs[k];
        if (!subject[nb] || outline[nb]) continue;
        if (dist[nb] !== -1) continue;
        dist[nb] = d0 + 1;
        q[tail++] = nb;
      }
    }

    for (let pass = 0; pass < nPass; pass++) {
      const nr = new Uint8Array(n);
      const ng = new Uint8Array(n);
      const nbArr = new Uint8Array(n);
      const use = new Uint8Array(n);
      for (let p = 0; p < n; p++) {
        if (!subject[p] || outline[p]) continue;
        if (dist[p] < 1 || dist[p] > depth) continue;
        if (rimProtect && rimProtect[p]) continue;

        const votes = Object.create(null);
        let bestKey = -1;
        let bestN = 0;
        let bestDeepN = -1;
        const n8 = neighbors8(w, h, p);
        for (let k = 0; k < n8.length; k++) {
          const j = n8[k];
          if (!subject[j] || outline[j]) continue;
          const ji = j * 4;
          if (dst[ji + 3] < 16) continue;
          const jd = dist[j];
          const weight = jd < 0 || jd > depth ? 3 : jd > dist[p] ? 2 : 1;
          const key = (dst[ji] << 16) | (dst[ji + 1] << 8) | dst[ji + 2];
          const c = (votes[key] = (votes[key] || 0) + weight);
          if (c > bestN || (c === bestN && weight >= bestDeepN)) {
            bestN = c;
            bestKey = key;
            bestDeepN = weight;
          }
        }
        if (bestN < 2 || bestKey < 0) continue;
        const cr = (bestKey >> 16) & 255;
        const cg = (bestKey >> 8) & 255;
        const cb = bestKey & 255;
        const pi = p * 4;
        if (dst[pi] === cr && dst[pi + 1] === cg && dst[pi + 2] === cb) continue;
        nr[p] = cr;
        ng[p] = cg;
        nbArr[p] = cb;
        use[p] = 1;
      }
      for (let p = 0; p < n; p++) {
        if (!use[p]) continue;
        const pi = p * 4;
        dst[pi] = nr[p];
        dst[pi + 1] = ng[p];
        dst[pi + 2] = nbArr[p];
        dst[pi + 3] = 255;
      }
    }
  }

  function quantizeImageData(imageData, paletteColors, opts) {
    if (!paletteColors || !paletteColors.length) {
      return new ImageData(imageData.width, imageData.height);
    }
    const o = opts || {};
    const alphaCut = o.alphaCut != null ? o.alphaCut | 0 : DEFAULTS.alphaCut;
    const strength =
      o.ditherStrength != null ? +o.ditherStrength : DEFAULTS.ditherStrength;
    const smoothPasses =
      o.smoothPasses != null ? o.smoothPasses | 0 : DEFAULTS.smoothPasses;
    const expandBeads =
      o.expandBeads != null ? o.expandBeads | 0 : DEFAULTS.expandBeads;
    const rimCleanDepth =
      o.rimCleanDepth != null ? o.rimCleanDepth | 0 : DEFAULTS.rimCleanDepth;
    const rimCleanPasses =
      o.rimCleanPasses != null ? o.rimCleanPasses | 0 : DEFAULTS.rimCleanPasses;
    const clearExterior = o.clearExterior !== false;

    let colors = paletteColors;
    if (o.maxColors != null && +o.maxColors > 0) {
      const g =
        typeof globalThis !== "undefined"
          ? globalThis
          : typeof window !== "undefined"
            ? window
            : null;
      const lim =
        g && g.FGImage && typeof g.FGImage.limitPaletteToBudget === "function"
          ? g.FGImage.limitPaletteToBudget
          : null;
      if (lim) {
        colors = lim(imageData, paletteColors, +o.maxColors, alphaCut);
      } else if (paletteColors.length > +o.maxColors) {
        colors = paletteColors.slice(0, +o.maxColors | 0);
      }
    }

    const w = imageData.width;
    const h = imageData.height;
    const extracted = extractSubject(
      imageData,
      alphaCut,
      smoothPasses,
      expandBeads,
      {
        neonDL: o.neonDL,
        neonChroma: o.neonChroma,
        neonDLSoft: o.neonDLSoft,
      }
    );
    const subject = extracted.mask;
    const rimProtect = extracted.rimProtect;
    const exterior = markExterior(subject, w, h);
    const outline = outlineOutward(subject, w, h);
    const out = floydSteinberg(imageData, colors, strength, alphaCut);
    const dst = out.data;

    if (rimCleanDepth > 0) {
      cleanRimColors(
        dst,
        subject,
        outline,
        w,
        h,
        rimCleanDepth,
        rimCleanPasses,
        rimProtect
      );
    }

    const ink = pickOutlineInk(
      colors,
      extracted.paperRgb || [0, 0, 0]
    );
    const n = w * h;
    const ir = ink.rgb[0];
    const ig = ink.rgb[1];
    const ib = ink.rgb[2];

    for (let p = 0; p < n; p++) {
      const i = p * 4;
      if (outline[p]) {
        dst[i] = ir;
        dst[i + 1] = ig;
        dst[i + 2] = ib;
        dst[i + 3] = 255;
        continue;
      }
      if (clearExterior && exterior[p]) {
        dst[i] = dst[i + 1] = dst[i + 2] = 0;
        dst[i + 3] = 0;
      }
    }
    return out;
  }

  return {
    version: "1.0.0-outline-fs-neon",
    quantizeImageData,
  };
});
