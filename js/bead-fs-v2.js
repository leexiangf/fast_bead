/**
 * FGBeadFsV2 — perler quantize with three product goals:
 *   1. LINE  — strengthen outlines (ink|fill, no mud)
 *   2. FLAT  — kill dither speckles in solids
 *   3. SHADE — keep FS for soft shadow/highlight ramps
 *
 * Standalone: no dependency on FGImage / bead-handlike.
 * Spec / changelog: docs/bead-fs-v2-algorithm.md
 * Archived as cartoon/flat preset — not for portraits (use classic FS).
 * Portrait add-ons deprecated: docs/bead-beyond-fs-research.md
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.FGBeadFsV2 = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const DEFAULTS = {
    maxColors: 0,
    /**
     * Bias toward classic FS smoothness on shade/highlight/mouth;
     * only deep flats stay quieter than stock FS (~0.85).
     */
    strength: 0.85,
    /** Goal 2: quiet solids (was 0.48 — still peppered flats). */
    flatStrength: 0.18,
    /** Goal 3: soft shade/highlight like classic FS. */
    shadeStrength: 0.92,
    /** Goal 1: almost no FS on structure lines. */
    edgeStrength: 0.06,
    edgeCut: true,
    skinHueLock: 0.35,
    skinHueSlack: 16,
    despeckle: 1,
    alphaCut: 16,
    serpentine: true,
    /** Only extremely flat → flatStrength. */
    flatGrad: 3,
    /** Enter shade diffusion early (soft shadows / highlights). */
    shadeGrad: 4,
    edgeGrad: 28,
    chromaEdge: 12,
    /** Higher than 0.3 so shade/highlight midtones dither like classic FS. */
    skinChromaBleed: 0.55,
    chromaBleed: 0.95,
    errorClamp: 72,
    stickyFlat: true,
    chromaSmooth: true,
    featureProtect: true,
    /** Mouth/eyes: near-classic chroma diffusion for soft edges. */
    featureBleed: 0.95,
    /**
     * contentMode: 'auto' | 'photo' | 'flat'
     * flat = cartoon / few solid fills — kill edge dither junk.
     */
    contentMode: "auto",
    /** Snap AA fringes to local majority before FS (helps cartoons a lot). */
    snapEdges: true,
  };

  function optsWith(opts) {
    const o = opts || {};
    return {
      maxColors: o.maxColors != null ? Math.max(0, o.maxColors | 0) : DEFAULTS.maxColors,
      strength: o.strength != null ? +o.strength : DEFAULTS.strength,
      flatStrength: o.flatStrength != null ? +o.flatStrength : DEFAULTS.flatStrength,
      shadeStrength: o.shadeStrength != null ? +o.shadeStrength : DEFAULTS.shadeStrength,
      edgeStrength: o.edgeStrength != null ? +o.edgeStrength : DEFAULTS.edgeStrength,
      edgeCut: o.edgeCut != null ? !!o.edgeCut : DEFAULTS.edgeCut,
      skinHueLock: o.skinHueLock != null ? +o.skinHueLock : DEFAULTS.skinHueLock,
      skinHueSlack: o.skinHueSlack != null ? +o.skinHueSlack : DEFAULTS.skinHueSlack,
      despeckle: o.despeckle != null ? o.despeckle | 0 : DEFAULTS.despeckle,
      alphaCut: o.alphaCut != null ? o.alphaCut | 0 : DEFAULTS.alphaCut,
      serpentine: o.serpentine != null ? !!o.serpentine : DEFAULTS.serpentine,
      flatGrad: o.flatGrad != null ? +o.flatGrad : DEFAULTS.flatGrad,
      shadeGrad: o.shadeGrad != null ? +o.shadeGrad : DEFAULTS.shadeGrad,
      edgeGrad: o.edgeGrad != null ? +o.edgeGrad : DEFAULTS.edgeGrad,
      chromaEdge: o.chromaEdge != null ? +o.chromaEdge : DEFAULTS.chromaEdge,
      skinChromaBleed: o.skinChromaBleed != null ? +o.skinChromaBleed : DEFAULTS.skinChromaBleed,
      chromaBleed: o.chromaBleed != null ? +o.chromaBleed : DEFAULTS.chromaBleed,
      errorClamp: o.errorClamp != null ? +o.errorClamp : DEFAULTS.errorClamp,
      stickyFlat: o.stickyFlat != null ? !!o.stickyFlat : DEFAULTS.stickyFlat,
      chromaSmooth: o.chromaSmooth != null ? !!o.chromaSmooth : DEFAULTS.chromaSmooth,
      featureProtect: o.featureProtect != null ? !!o.featureProtect : DEFAULTS.featureProtect,
      featureBleed: o.featureBleed != null ? +o.featureBleed : DEFAULTS.featureBleed,
      contentMode: o.contentMode === "photo" || o.contentMode === "flat" ? o.contentMode : "auto",
      snapEdges: o.snapEdges != null ? !!o.snapEdges : DEFAULTS.snapEdges,
    };
  }

  function luma(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  /**
   * Cartoon / logo-ish: few dominant colors, large solids.
   * Photo: many hues, soft gradients.
   * AA cartoons inflate unique bins — use top-share + dominant fill, not unique alone.
   */
  function detectFlatArt(src, w, h, alphaCut) {
    const counts = Object.create(null);
    let opaque = 0;
    const step = Math.max(1, Math.floor((w * h) / 12000));
    for (let i = 0, pix = 0; i < src.length; i += 4, pix++) {
      if (pix % step !== 0) continue;
      if (src[i + 3] < alphaCut) continue;
      opaque++;
      const key = (src[i] >> 4) + "," + (src[i + 1] >> 4) + "," + (src[i + 2] >> 4);
      counts[key] = (counts[key] || 0) + 1;
    }
    if (opaque < 32) return false;
    const keys = Object.keys(counts);
    keys.sort((a, b) => counts[b] - counts[a]);
    let top8 = 0;
    let top4 = 0;
    const n8 = Math.min(8, keys.length);
    for (let i = 0; i < n8; i++) {
      top8 += counts[keys[i]];
      if (i < 4) top4 += counts[keys[i]];
    }
    const unique = keys.length;
    const share8 = top8 / opaque;
    const share4 = top4 / opaque;
    const top1 = counts[keys[0]] / opaque;
    /* Strict clean flats */
    if (unique <= 48 && share8 >= 0.68) return true;
    /* Keroppi-like AA: many fringe bins, but 4–8 fills still dominate */
    if (unique <= 120 && share8 >= 0.52 && top1 >= 0.1) return true;
    if (unique <= 160 && share4 >= 0.48 && top1 >= 0.14) return true;
    return false;
  }

  /**
   * Photo / soft path: snap AA mud to 3×3 majority (may erase thin ink — OK for photos).
   */
  function snapEdgeFringes(src, w, h, maps, alphaCut, minVotes) {
    const need = minVotes != null ? minVotes | 0 : 4;
    const out = new Uint8ClampedArray(src);
    const labs = maps.labs;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gi = y * w + x;
        const lab = labs[gi];
        if (!lab) continue;
        if (maps.lumG[gi] < 10 && maps.chrG[gi] < 8) continue;
        const buckets = Object.create(null);
        let bestKey = null;
        let bestN = 0;
        let bestRgb = null;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ni = ((y + dy) * w + (x + dx)) * 4;
            if (src[ni + 3] < alphaCut) continue;
            const key = (src[ni] >> 3) + "," + (src[ni + 1] >> 3) + "," + (src[ni + 2] >> 3);
            if (!buckets[key]) {
              buckets[key] = { n: 0, r: 0, g: 0, b: 0 };
            }
            const b = buckets[key];
            b.n++;
            b.r += src[ni];
            b.g += src[ni + 1];
            b.b += src[ni + 2];
            if (b.n > bestN) {
              bestN = b.n;
              bestKey = key;
              bestRgb = b;
            }
          }
        }
        if (bestN < need || !bestRgb) continue;
        const i = gi * 4;
        const selfKey = (src[i] >> 3) + "," + (src[i + 1] >> 3) + "," + (src[i + 2] >> 3);
        if (selfKey === bestKey) continue;
        out[i] = (bestRgb.r / bestN) | 0;
        out[i + 1] = (bestRgb.g / bestN) | 0;
        out[i + 2] = (bestRgb.b / bestN) | 0;
      }
    }
    return out;
  }

  /**
   * Cartoon edges: binary ink|fill — never leave muddy mid greys.
   * Protects thin black outlines (majority snap would eat them into yellow fill).
   */
  function resolveFlatFringes(src, w, h, maps, alphaCut, minContrast) {
    const needContrast = minContrast != null ? +minContrast : 28;
    const out = new Uint8ClampedArray(src);
    const labs = maps.labs;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gi = y * w + x;
        const lab = labs[gi];
        if (!lab) continue;
        if (maps.lumG[gi] < 8 && maps.chrG[gi] < 6) continue;

        let darkY = 1e9;
        let darkRgb = null;
        let brightY = -1;
        let brightRgb = null;
        const buckets = Object.create(null);
        let bestKey = null;
        let bestN = 0;
        let bestRgb = null;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ni = ((y + dy) * w + (x + dx)) * 4;
            if (src[ni + 3] < alphaCut) continue;
            const r = src[ni];
            const g = src[ni + 1];
            const b = src[ni + 2];
            const Y = luma(r, g, b);
            if (Y < darkY) {
              darkY = Y;
              darkRgb = [r, g, b];
            }
            if (Y > brightY) {
              brightY = Y;
              brightRgb = [r, g, b];
            }
            /* Majority among non-ink neighbors → fill color */
            if (Y < 42) continue;
            const key = (r >> 3) + "," + (g >> 3) + "," + (b >> 3);
            if (!buckets[key]) buckets[key] = { n: 0, r: 0, g: 0, b: 0 };
            const bk = buckets[key];
            bk.n++;
            bk.r += r;
            bk.g += g;
            bk.b += b;
            if (bk.n > bestN) {
              bestN = bk.n;
              bestKey = key;
              bestRgb = bk;
            }
          }
        }

        const i = gi * 4;
        const selfY = luma(src[i], src[i + 1], src[i + 2]);
        if (!darkRgb || brightY < 0) continue;

        const contrast = brightY - darkY;
        const isEdge =
          contrast >= needContrast || maps.lumG[gi] >= 14 || maps.chrG[gi] >= 10;
        if (!isEdge) continue;

        let fillRgb = null;
        if (bestRgb && bestN >= 2) {
          fillRgb = [(bestRgb.r / bestN) | 0, (bestRgb.g / bestN) | 0, (bestRgb.b / bestN) | 0];
        } else if (brightRgb && brightY >= 50) {
          fillRgb = brightRgb;
        }

        /* Thin ink or dark-side AA → promote darkest neighbor (keeps outlines). */
        const mid = darkY + contrast * 0.45;
        const wantInk =
          darkY < 55 &&
          (selfY <= mid || selfY < 48 || (selfY < darkY + 18 && contrast >= 40));

        if (wantInk) {
          out[i] = darkRgb[0];
          out[i + 1] = darkRgb[1];
          out[i + 2] = darkRgb[2];
          continue;
        }

        /* Bright-side mud → snap to fill, not a third grey. */
        if (fillRgb && selfY > mid) {
          const selfKey = (src[i] >> 3) + "," + (src[i + 1] >> 3) + "," + (src[i + 2] >> 3);
          if (selfKey === bestKey) continue;
          out[i] = fillRgb[0];
          out[i + 1] = fillRgb[1];
          out[i + 2] = fillRgb[2];
        }
      }
    }
    return out;
  }

  /** Find darkest working bead (outline ink). */
  function findInkBead(working) {
    let best = null;
    let bestL = 1e9;
    for (let i = 0; i < working.length; i++) {
      const p = working[i];
      if (p.lab[0] < bestL) {
        bestL = p.lab[0];
        best = p;
      }
    }
    return bestL <= 42 ? best : null;
  }

  function isInkLab(lab, ink) {
    if (!lab) return false;
    /* Tight: 0.9.1 was too wide and ate dark body / cheek into pure black. */
    if (lab[0] <= 28) return true;
    if (ink && lab[0] <= 36 && labDist2(lab, ink.lab) <= 90) return true;
    return false;
  }

  /** Saturated fills (yellow/pink/green) — never force into ink. */
  function isChromaticFill(lab) {
    if (!lab) return false;
    return lab[0] >= 38 && Math.abs(lab[1]) + Math.abs(lab[2]) >= 20;
  }

  function isLowChromaMud(lab) {
    if (!lab) return false;
    return Math.abs(lab[1]) + Math.abs(lab[2]) < 22;
  }

  /**
   * After quantize: on high-contrast edges, force mid mud → ink or neighbor fill.
   * Conservative: do not pull chromatic fills into ink.
   */
  function reinforceFlatInk(indexGrid, working, w, h, maps, src, alphaCut) {
    const ink = findInkBead(working);
    if (!ink) return;
    const byIndex = Object.create(null);
    for (let i = 0; i < working.length; i++) byIndex[working[i].index] = working[i];
    const next = new Int16Array(indexGrid);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gi = y * w + x;
        const self = indexGrid[gi];
        if (self < 0) continue;
        if (maps.lumG[gi] < 12 && maps.chrG[gi] < 8) continue;
        const A = byIndex[self];
        if (!A) continue;
        if (A.index === ink.index) continue;
        if (isChromaticFill(A.lab)) continue;
        let darkN = null;
        let brightN = null;
        let darkL = 1e9;
        let brightL = -1;
        let inkN = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const v = indexGrid[(y + dy) * w + (x + dx)];
            if (v < 0) continue;
            const B = byIndex[v];
            if (!B) continue;
            if (isInkLab(B.lab, ink)) inkN++;
            if (B.lab[0] < darkL) {
              darkL = B.lab[0];
              darkN = B;
            }
            if (B.lab[0] > brightL) {
              brightL = B.lab[0];
              brightN = B;
            }
          }
        }
        if (!darkN || !brightN || brightL - darkL < 22) continue;
        const si = gi * 4;
        const srcY =
          src && src[si + 3] >= alphaCut ? luma(src[si], src[si + 1], src[si + 2]) : A.lab[0] * 2.55;
        const mid = darkL + (brightL - darkL) * 0.42;
        /* Only low-chroma dark fringe next to ink → ink */
        if (inkN >= 1 && isLowChromaMud(A.lab) && A.lab[0] < 42 && A.index !== ink.index) {
          next[gi] = ink.index;
          continue;
        }
        if (A.lab[0] <= darkL + 6) continue;
        if (srcY / 2.55 <= mid + 4 || A.lab[0] < mid + 6) {
          if (isLowChromaMud(A.lab) && (darkL <= 38 || inkN > 0)) next[gi] = ink.index;
          else if (A.lab[0] > darkL + 10 && darkN) next[gi] = darkN.index;
        } else if (A.lab[0] > mid && brightN && A.index !== brightN.index) {
          const dInk = labDist2(A.lab, ink.lab);
          const dFill = labDist2(A.lab, brightN.lab);
          if (dFill + 30 < dInk && brightN.lab[0] >= 45) next[gi] = brightN.index;
        }
      }
    }
    indexGrid.set(next);
  }

  /**
   * Light line polish (0.9.2): only bridge mud gaps + clear grey fringe.
   * Never swallow yellow/pink/green fills into ink (0.9.1 overdid that).
   */
  function consolidateLines(indexGrid, working, w, h, maps, passes) {
    const ink = findInkBead(working);
    if (!ink || !passes) return;
    const byIndex = Object.create(null);
    for (let i = 0; i < working.length; i++) byIndex[working[i].index] = working[i];
    const next = new Int16Array(indexGrid);

    for (let pass = 0; pass < passes; pass++) {
      next.set(indexGrid);

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const gi = y * w + x;
          const self = indexGrid[gi];
          if (self < 0) continue;
          const A = byIndex[self];
          if (!A) continue;
          if (isChromaticFill(A.lab)) continue;

          const left = indexGrid[gi - 1];
          const right = indexGrid[gi + 1];
          const up = indexGrid[gi - w];
          const down = indexGrid[gi + w];
          const L = left >= 0 ? byIndex[left] : null;
          const R = right >= 0 ? byIndex[right] : null;
          const U = up >= 0 ? byIndex[up] : null;
          const D = down >= 0 ? byIndex[down] : null;

          let inkN = 0;
          let same = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const v = indexGrid[(y + dy) * w + (x + dx)];
              if (v < 0) continue;
              const B = byIndex[v];
              if (!B) continue;
              if (isInkLab(B.lab, ink)) inkN++;
              if (v === self) same++;
            }
          }

          const selfInk = isInkLab(A.lab, ink);

          /* 1) Bridge: ink — mud gap — ink only (not chromatic gap) */
          if (!selfInk && isLowChromaMud(A.lab)) {
            const bridgeH = L && R && isInkLab(L.lab, ink) && isInkLab(R.lab, ink);
            const bridgeV = U && D && isInkLab(U.lab, ink) && isInkLab(D.lab, ink);
            if (bridgeH || bridgeV) {
              next[gi] = ink.index;
              continue;
            }
          }

          /* 2) Grey/olive loner on stroke (≥2 ink, same≤1, low chroma) → ink */
          if (!selfInk && inkN >= 2 && same <= 1 && isLowChromaMud(A.lab) && A.lab[0] < 50) {
            next[gi] = ink.index;
            continue;
          }

          /* 3) Mid-grey fringe: 1 ink + closer to ink than fill → ink */
          if (!selfInk && inkN >= 1 && same <= 1 && isLowChromaMud(A.lab) && A.lab[0] < 45) {
            next[gi] = ink.index;
            continue;
          }

          /* 4) Unify near-black palette ids that are already ink-class */
          if (selfInk && A.index !== ink.index && inkN >= 1 && labDist2(A.lab, ink.lab) <= 90) {
            next[gi] = ink.index;
          }
        }
      }
      indexGrid.set(next);
    }
  }

  /** Kill salt-pepper inside flat solids (not on structure edges / ink). */
  function flattenSolidIslands(indexGrid, working, w, h, maps, passes) {
    if (!passes) return;
    const byIndex = Object.create(null);
    for (let i = 0; i < working.length; i++) byIndex[working[i].index] = working[i];
    const next = new Int16Array(indexGrid);
    for (let pass = 0; pass < passes; pass++) {
      next.set(indexGrid);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const self = indexGrid[i];
          if (self < 0) continue;
          const A = byIndex[self];
          if (!A) continue;
          /* Never erase ink outlines */
          if (A.lab[0] <= 38) continue;
          if (maps.lumG[i] >= 10 || maps.chrG[i] >= 10) continue;
          let same = 0;
          const counts = Object.create(null);
          let best = -1;
          let bestN = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const v = indexGrid[(y + dy) * w + (x + dx)];
              if (v < 0) continue;
              if (v === self) same++;
              const n = (counts[v] = (counts[v] || 0) + 1);
              if (n > bestN) {
                bestN = n;
                best = v;
              }
            }
          }
          if (same >= 3 || best < 0 || best === self) continue;
          const B = byIndex[best];
          if (!B || B.lab[0] <= 38) continue;
          if (labDist2(A.lab, B.lab) > 520) continue;
          if (bestN >= 4 && same <= 2) next[i] = best;
        }
      }
      indexGrid.set(next);
    }
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
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

  function labToRgb(lab) {
    let y = (lab[0] + 16) / 116;
    let x = lab[1] / 500 + y;
    let z = y - lab[2] / 200;
    const finv = (t) => {
      const t3 = t * t * t;
      return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
    };
    x = finv(x) * 0.95047;
    y = finv(y) * 1.0;
    z = finv(z) * 1.08883;
    let r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    let g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
    let b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
    const comp = (c) => {
      c = c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
      return clamp(Math.round(c * 255), 0, 255);
    };
    return [comp(r), comp(g), comp(b)];
  }

  function labDist2(a, b) {
    const dL = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return dL * dL + da * da + db * db;
  }

  function isSkinLab(lab) {
    const L = lab[0];
    const a = lab[1];
    const b = lab[2];
    return L > 32 && L < 92 && a > 4 && a < 48 && b > -2 && b < 42 && a + Math.max(0, b) > 10;
  }

  function isLipOrAccent(lab) {
    return (lab[1] > 26 && lab[1] > lab[2] + 4) || (lab[0] < 58 && lab[1] > 20 && lab[1] > lab[2]);
  }

  function preparePalette(paletteColors) {
    const list = [];
    for (let i = 0; i < paletteColors.length; i++) {
      const c = paletteColors[i];
      if (!c || !c.rgb) continue;
      const rgb = [c.rgb[0] | 0, c.rgb[1] | 0, c.rgb[2] | 0];
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      list.push({
        index: list.length,
        id: c.id != null ? c.id : list.length + 1,
        rgb,
        lab,
        skin: isSkinLab(lab),
      });
    }
    return list;
  }

  /** Shrink working palette toward N colors via Lab median-cut on usage samples. */
  function budgetPalette(prepared, src, w, h, alphaCut, maxColors) {
    if (!maxColors || maxColors <= 0 || prepared.length <= maxColors) return prepared;
    const samples = [];
    const step = Math.max(1, Math.floor((w * h) / 10000));
    for (let i = 0, pix = 0; i < src.length; i += 4, pix++) {
      if (pix % step !== 0) continue;
      if (src[i + 3] < alphaCut) continue;
      samples.push(rgbToLab(src[i], src[i + 1], src[i + 2]));
    }
    if (samples.length < 4) return prepared.slice(0, maxColors);

    let buckets = [samples];
    while (buckets.length < maxColors) {
      let bi = -1;
      let bestRange = -1;
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        if (b.length < 2) continue;
        let L0 = 1e9;
        let L1 = -1e9;
        let a0 = 1e9;
        let a1 = -1e9;
        let b0 = 1e9;
        let b1 = -1e9;
        for (let j = 0; j < b.length; j++) {
          const lab = b[j];
          if (lab[0] < L0) L0 = lab[0];
          if (lab[0] > L1) L1 = lab[0];
          if (lab[1] < a0) a0 = lab[1];
          if (lab[1] > a1) a1 = lab[1];
          if (lab[2] < b0) b0 = lab[2];
          if (lab[2] > b1) b1 = lab[2];
        }
        const range = Math.max(L1 - L0, a1 - a0, b1 - b0);
        if (range > bestRange) {
          bestRange = range;
          bi = i;
        }
      }
      if (bi < 0) break;
      const bucket = buckets[bi];
      let L0 = 1e9;
      let L1 = -1e9;
      let a0 = 1e9;
      let a1 = -1e9;
      let b0 = 1e9;
      let b1 = -1e9;
      for (let j = 0; j < bucket.length; j++) {
        const lab = bucket[j];
        if (lab[0] < L0) L0 = lab[0];
        if (lab[0] > L1) L1 = lab[0];
        if (lab[1] < a0) a0 = lab[1];
        if (lab[1] > a1) a1 = lab[1];
        if (lab[2] < b0) b0 = lab[2];
        if (lab[2] > b1) b1 = lab[2];
      }
      const rL = L1 - L0;
      const rA = a1 - a0;
      const rB = b1 - b0;
      const ch = rL >= rA && rL >= rB ? 0 : rA >= rB ? 1 : 2;
      bucket.sort((u, v) => u[ch] - v[ch]);
      const mid = bucket.length >> 1;
      buckets.splice(bi, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    const used = new Set();
    const out = [];
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      let L = 0;
      let A = 0;
      let B = 0;
      for (let j = 0; j < b.length; j++) {
        L += b[j][0];
        A += b[j][1];
        B += b[j][2];
      }
      const n = b.length || 1;
      const center = [L / n, A / n, B / n];
      let best = null;
      let bestD = Infinity;
      for (let k = 0; k < prepared.length; k++) {
        if (used.has(prepared[k].index)) continue;
        const d = labDist2(center, prepared[k].lab);
        if (d < bestD) {
          bestD = d;
          best = prepared[k];
        }
      }
      if (best) {
        used.add(best.index);
        out.push(best);
      }
    }
    /* Always keep very dark / very light beads for eyes & highlights. */
    for (let k = 0; k < prepared.length && out.length < maxColors + 4; k++) {
      const p = prepared[k];
      if (used.has(p.index)) continue;
      if (p.lab[0] < 18 || p.lab[0] > 88) {
        used.add(p.index);
        out.push(p);
      }
    }
    /* Ensure a skin L-ladder so shade dither has intermediate beads. */
    const skinAll = prepared.filter((p) => p.skin).sort((a, b) => a.lab[0] - b.lab[0]);
    const skinSlots = Math.min(skinAll.length, Math.max(5, Math.ceil(maxColors * 0.35)));
    if (skinSlots >= 3) {
      for (let s = 0; s < skinSlots; s++) {
        const p = skinAll[Math.round((s / Math.max(1, skinSlots - 1)) * (skinAll.length - 1))];
        if (!used.has(p.index)) {
          used.add(p.index);
          out.push(p);
        }
      }
      while (out.length > maxColors + 6) {
        /* Drop non-skin, non-extreme extras first. */
        let dropped = false;
        for (let i = out.length - 1; i >= 0; i--) {
          const p = out[i];
          if (p.skin || p.lab[0] < 18 || p.lab[0] > 88) continue;
          out.splice(i, 1);
          dropped = true;
          break;
        }
        if (!dropped) break;
      }
    }
    return out.length ? out : prepared.slice(0, maxColors);
  }

  function estimateSkinAnchor(src, w, h, alphaCut) {
    const as = [];
    const bs = [];
    const step = Math.max(1, Math.floor((w * h) / 8000));
    for (let i = 0, pix = 0; i < src.length; i += 4, pix++) {
      if (pix % step !== 0) continue;
      if (src[i + 3] < alphaCut) continue;
      const lab = rgbToLab(src[i], src[i + 1], src[i + 2]);
      if (!isSkinLab(lab) || isLipOrAccent(lab)) continue;
      as.push(lab[1]);
      bs.push(lab[2]);
    }
    if (as.length < 8) return null;
    as.sort((u, v) => u - v);
    bs.sort((u, v) => u - v);
    const mid = as.length >> 1;
    return { a: as[mid], b: bs[mid] };
  }

  /**
   * Separates lighting ramps (ΔL) from structure edges (Δchroma).
   * Soft shadows need FS; cutting them like hard edges makes bands stiff.
   */
  function buildFieldMaps(src, w, h, alphaCut) {
    const n = w * h;
    const lumG = new Float32Array(n);
    const chrG = new Float32Array(n);
    const labs = new Array(n);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const gi = y * w + x;
        if (src[i + 3] < alphaCut) {
          labs[gi] = null;
          continue;
        }
        labs[gi] = rgbToLab(src[i], src[i + 1], src[i + 2]);
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gi = y * w + x;
        const lab = labs[gi];
        if (!lab) continue;
        let dL = 0;
        let dC = 0;
        const consider = (nx, ny) => {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
          const nb = labs[ny * w + nx];
          if (!nb) return;
          dL = Math.max(dL, Math.abs(lab[0] - nb[0]));
          dC = Math.max(
            dC,
            Math.abs(lab[1] - nb[1]) + Math.abs(lab[2] - nb[2])
          );
        };
        consider(x + 1, y);
        consider(x, y + 1);
        consider(x - 1, y);
        consider(x, y - 1);
        lumG[gi] = dL;
        chrG[gi] = dC;
      }
    }
    return { lumG, chrG, labs };
  }

  /** Lips + dark structural pits (pupils / nostrils) — keep chroma & skip sticky. */
  function buildFeatureMask(maps, w, h, o) {
    const feat = new Uint8Array(w * h);
    if (!o.featureProtect) return feat;
    const labs = maps.labs;
    for (let gi = 0; gi < labs.length; gi++) {
      const lab = labs[gi];
      if (!lab) continue;
      if (isLipOrAccent(lab)) {
        feat[gi] = 1;
        continue;
      }
      if (lab[0] < 30 && (maps.lumG[gi] >= o.shadeGrad || maps.chrG[gi] >= o.chromaEdge * 0.45)) {
        feat[gi] = 1;
      }
    }
    return feat;
  }

  /**
   * On flat skin only: replace ab with 3×3 mean, keep L.
   * Cuts input hue noise before FS without flattening shadow ramps.
   */
  function smoothFlatSkinChroma(src, w, h, maps, feat, o) {
    if (!o.chromaSmooth) return src;
    const out = new Uint8ClampedArray(src);
    const labs = maps.labs;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gi = y * w + x;
        const lab = labs[gi];
        if (!lab || feat[gi]) continue;
        if (!isSkinLab(lab) || isLipOrAccent(lab)) continue;
        /* Only deep flats — never shade/highlight ramps (would stiffen vs classic FS). */
        if (maps.lumG[gi] > o.flatGrad || maps.chrG[gi] > o.chromaEdge * 0.4) continue;
        if (lab[0] >= 70 || lab[0] <= 58) continue;
        let A = 0;
        let B = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nb = labs[(y + dy) * w + (x + dx)];
            if (!nb || !isSkinLab(nb) || isLipOrAccent(nb)) continue;
            A += nb[1];
            B += nb[2];
            n++;
          }
        }
        if (n < 4) continue;
        const rgb = labToRgb([lab[0], A / n, B / n]);
        const i = gi * 4;
        out[i] = rgb[0];
        out[i + 1] = rgb[1];
        out[i + 2] = rgb[2];
      }
    }
    return out;
  }

  /**
   * Product regions — maps 1:1 to the three goals.
   * LINE = strengthen lines · FLAT = de-dither · SHADE = smooth transitions
   */
  function classifyRegion(lum, chr, o, lab) {
    /* Goal 1: structure / outline */
    if (chr >= o.chromaEdge || lum >= o.edgeGrad) return "line";
    /*
     * Goal 3: lighting ramps (incl. skin highlight / mid-shadow).
     * Prefer shade over flat whenever luma changes without hard chroma edge.
     */
    if (lab && isSkinLab(lab) && !isLipOrAccent(lab)) {
      if ((lab[0] >= 70 || lab[0] <= 60) && chr < o.chromaEdge) return "shade";
    }
    if (lum >= o.shadeGrad && chr < o.chromaEdge) return "shade";
    /* Goal 2: solid interiors */
    if (lum <= o.flatGrad && chr < o.chromaEdge * 0.45) return "flat";
    /* Between flatGrad and shadeGrad: soft blend → treat as shade for goal 3 */
    if (lum > o.flatGrad && chr < o.chromaEdge) return "shade";
    return "flat";
  }

  function regionStrength(region, o) {
    if (region === "line") return o.edgeStrength;
    if (region === "shade") return o.shadeStrength;
    return o.flatStrength;
  }

  function regionBleed(region, o, isFeat, nearFeat, skinPix) {
    if (region === "line") return 0.2;
    if (isFeat || nearFeat) return o.featureBleed;
    if (region === "shade") return skinPix ? Math.max(o.skinChromaBleed, 0.75) : o.chromaBleed;
    return skinPix ? o.skinChromaBleed * 0.5 : o.chromaBleed * 0.35;
  }

  function scoreBead(lab, p, skin, target, slack2) {
    if (skin && target) {
      const da = target[1] - p.lab[1];
      const db = target[2] - p.lab[2];
      const ab2 = da * da + db * db;
      const dL = lab[0] - p.lab[0];
      let d = dL * dL * 2.1 + ab2 * 0.4;
      if (ab2 > slack2) d += (ab2 - slack2) * 0.85;
      if (!p.skin) d += 80;
      return d;
    }
    return labDist2(lab, p.lab);
  }

  function pickBead(r, g, b, working, anchor, o, stickyCandidates) {
    const lab = rgbToLab(r, g, b);
    const skin = isSkinLab(lab) && !isLipOrAccent(lab);
    let target = lab;
    let lock = o.skinHueLock;
    if (skin && anchor && lock > 0) {
      if (lab[0] < 55) lock *= 0.75;
      const t = clamp(lock, 0, 1);
      target = [lab[0], lab[1] * (1 - t) + anchor.a * t, lab[2] * (1 - t) + anchor.b * t];
    }

    let best = working[0];
    let bestD = Infinity;
    const slack = lab[0] < 55 ? o.skinHueSlack + 3 : o.skinHueSlack;
    const slack2 = slack * slack;
    const skinTarget = skin && anchor ? target : null;

    for (let i = 0; i < working.length; i++) {
      const p = working[i];
      const d = scoreBead(lab, p, skin, skinTarget, slack2);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }

    /* Flat patches / cartoons: prefer already-used neighbor if nearly as good. */
    if (o.stickyFlat && stickyCandidates && stickyCandidates.length) {
        const loose = o.skinHueLock === 0; /* flat-art overrides zero hue lock */
      for (let i = 0; i < stickyCandidates.length; i++) {
        const nb = stickyCandidates[i];
        if (!nb) continue;
        const d = scoreBead(lab, nb, skin, skinTarget, slack2);
        const ok = loose
          ? d <= bestD * 2.1 || d - bestD < 110
          : d <= bestD * 1.06 || d - bestD < 8;
        if (ok) {
          best = nb;
          bestD = d;
        }
      }
    }
    return best;
  }

  /** Shape RGB error: keep luma diffusion, attenuate chroma (skin → less hue noise). */
  function shapeError(r, g, b, qr, qg, qb, s, bleed, clampAbs) {
    let er = (r - qr) * s;
    let eg = (g - qg) * s;
    let eb = (b - qb) * s;
    const eY = 0.299 * er + 0.587 * eg + 0.114 * eb;
    const t = clamp(bleed, 0, 1);
    er = eY + (er - eY) * t;
    eg = eY + (eg - eY) * t;
    eb = eY + (eb - eY) * t;
    const lim = clampAbs > 0 ? clampAbs : 0;
    if (lim > 0) {
      er = clamp(er, -lim, lim);
      eg = clamp(eg, -lim, lim);
      eb = clamp(eb, -lim, lim);
    }
    return [er, eg, eb];
  }

  function diffuse(buf, w, h, x, y, er, eg, eb, factor, maps, o, fromGi) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    if (o.edgeCut && maps) {
      const toGi = y * w + x;
      const fromC = maps.chrG[fromGi];
      const toC = maps.chrG[toGi];
      const fromL = maps.lumG[fromGi];
      const toL = maps.lumG[toGi];
      const fromLine = fromC >= o.chromaEdge || fromL >= o.edgeGrad;
      const toLine = toC >= o.chromaEdge || toL >= o.edgeGrad;
      /* Goal 1: almost no bleed across structure lines */
      if (fromLine || toLine) {
        factor *= 0.12;
      } else if (fromC > o.chromaEdge * 0.75 && toC > o.chromaEdge * 0.75) {
        factor *= 0.55;
      }
    }
    if (factor <= 0) return;
    const i = (y * w + x) * 4;
    buf[i] += er * factor;
    buf[i + 1] += eg * factor;
    buf[i + 2] += eb * factor;
  }

  /** Replace isolated 1-px beads that are close in Lab to neighbor majority. */
  function lightDespeckle(indexGrid, working, w, h, passes, maps, o, feat) {
    if (!passes) return;
    const byIndex = Object.create(null);
    for (let i = 0; i < working.length; i++) byIndex[working[i].index] = working[i];
    const next = new Int16Array(indexGrid);
    for (let pass = 0; pass < passes; pass++) {
      next.set(indexGrid);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const self = indexGrid[i];
          if (self < 0) continue;
          if (feat && feat[i]) continue;
          const A0 = byIndex[self];
          /* Never despeckle away outline ink. */
          if (A0 && A0.lab[0] <= 38) continue;
          /* Keep structure / high-contrast source cells. */
          if (maps && (maps.chrG[i] >= o.chromaEdge * 0.85 || maps.lumG[i] >= o.edgeGrad * 0.9)) {
            continue;
          }
          let same = 0;
          const counts = Object.create(null);
          let best = -1;
          let bestN = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const v = indexGrid[(y + dy) * w + (x + dx)];
              if (v < 0) continue;
              if (v === self) same++;
              const n = (counts[v] = (counts[v] || 0) + 1);
              if (n > bestN) {
                bestN = n;
                best = v;
              }
            }
          }
          if (same > 0 || best < 0 || best === self) continue;
          const A = byIndex[self];
          const B = byIndex[best];
          if (!A || !B) continue;
          if (B.lab[0] <= 38) continue;
          /* Flat cartoons: merge loners more aggressively (edge junk). */
          const maxD = maps && maps.chrG && maps.chrG[i] > 8 ? 380 : 220;
          const need = maps && maps.lumG && maps.lumG[i] > 8 ? 4 : 5;
          if (labDist2(A.lab, B.lab) > maxD) continue;
          if (bestN >= need) next[i] = best;
        }
      }
      indexGrid.set(next);
    }
  }

  function applyFlatArtOverrides(o) {
    /*
     * Cartoon bias: more LINE+FLAT, but keep shadeStrength for goal 3
     * (soft folds / rare gradients). Do NOT zero shade.
     */
    return Object.assign({}, o, {
      flatStrength: 0,
      edgeStrength: 0,
      shadeStrength: Math.max(0.75, o.shadeStrength),
      flatGrad: Math.max(o.flatGrad, 6),
      shadeGrad: Math.max(o.shadeGrad, 14),
      edgeGrad: Math.min(o.edgeGrad, 18),
      chromaEdge: Math.min(o.chromaEdge, 9),
      skinHueLock: 0,
      stickyFlat: true,
      chromaSmooth: false,
      featureProtect: false,
      despeckle: Math.max(3, o.despeckle | 0),
      errorClamp: Math.min(o.errorClamp, 36),
      edgeCut: true,
    });
  }

  function writeIndexToDst(indexGrid, working, dst) {
    for (let gi = 0; gi < indexGrid.length; gi++) {
      const idx = indexGrid[gi];
      const o4 = gi * 4;
      if (idx < 0) continue;
      let bead = null;
      for (let k = 0; k < working.length; k++) {
        if (working[k].index === idx) {
          bead = working[k];
          break;
        }
      }
      if (!bead) continue;
      dst[o4] = bead.rgb[0];
      dst[o4 + 1] = bead.rgb[1];
      dst[o4 + 2] = bead.rgb[2];
      dst[o4 + 3] = 255;
    }
  }

  function runFs(src, w, h, working, baseOpts) {
    const isFlat =
      baseOpts.contentMode === "flat" ||
      (baseOpts.contentMode === "auto" && detectFlatArt(src, w, h, baseOpts.alphaCut));
    const o = isFlat ? applyFlatArtOverrides(baseOpts) : baseOpts;
    const inkBead = findInkBead(working);

    let workSrc = src;
    let maps = buildFieldMaps(workSrc, w, h, o.alphaCut);
    if (o.snapEdges || isFlat) {
      /* Goal 1: ink|fill on structure edges (stricter on photos to spare soft shade). */
      const minC = isFlat ? 24 : 34;
      const passes = isFlat ? 2 : 1;
      for (let p = 0; p < passes; p++) {
        workSrc = resolveFlatFringes(workSrc, w, h, maps, o.alphaCut, minC);
        maps = buildFieldMaps(workSrc, w, h, o.alphaCut);
      }
    }

    const anchor = isFlat ? null : estimateSkinAnchor(workSrc, w, h, o.alphaCut);
    const feat = isFlat ? new Uint8Array(w * h) : buildFeatureMask(maps, w, h, o);
    const smoothed = isFlat ? workSrc : smoothFlatSkinChroma(workSrc, w, h, maps, feat, o);
    const buf = new Float32Array(smoothed.length);
    for (let i = 0; i < smoothed.length; i++) buf[i] = smoothed[i];

    const indexGrid = new Int16Array(w * h);
    const out =
      typeof ImageData !== "undefined"
        ? new ImageData(w, h)
        : { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    const dst = out.data;

    for (let y = 0; y < h; y++) {
      const leftToRight = !o.serpentine || y % 2 === 0;
      for (let xi = 0; xi < w; xi++) {
        const x = leftToRight ? xi : w - 1 - xi;
        const i = (y * w + x) * 4;
        const gi = y * w + x;
        if (workSrc[i + 3] < o.alphaCut) {
          dst[i] = dst[i + 1] = dst[i + 2] = 0;
          dst[i + 3] = 0;
          indexGrid[gi] = -1;
          continue;
        }
        const r = clamp(buf[i], 0, 255);
        const g = clamp(buf[i + 1], 0, 255);
        const b = clamp(buf[i + 2], 0, 255);
        const labNow = rgbToLab(r, g, b);
        const region = classifyRegion(maps.lumG[gi], maps.chrG[gi], o, labNow);
        const isFeat = feat[gi] === 1;

        const nearFeat =
          !isFlat &&
          (isFeat ||
            (x > 0 && feat[gi - 1]) ||
            (x + 1 < w && feat[gi + 1]) ||
            (y > 0 && feat[gi - w]) ||
            (y + 1 < h && feat[gi + w]));

        /* Goal 2: sticky only inside FLAT (not shade — would stair-step light). */
        const sticky = [];
        const allowSticky = o.stickyFlat && region === "flat" && !nearFeat;
        if (allowSticky) {
          const left = leftToRight ? x - 1 : x + 1;
          if (left >= 0 && left < w && indexGrid[y * w + left] >= 0) {
            const idx = indexGrid[y * w + left];
            for (let k = 0; k < working.length; k++) {
              if (working[k].index === idx) {
                sticky.push(working[k]);
                break;
              }
            }
          }
          if (y > 0 && indexGrid[(y - 1) * w + x] >= 0) {
            const idx = indexGrid[(y - 1) * w + x];
            for (let k = 0; k < working.length; k++) {
              if (working[k].index === idx) {
                sticky.push(working[k]);
                break;
              }
            }
          }
        }

        let bead = pickBead(r, g, b, working, anchor, o, sticky.length ? sticky : null);
        /* Goal 1: dark LINE → outline ink */
        if (
          inkBead &&
          region === "line" &&
          luma(r, g, b) < 52
        ) {
          const dInk = labDist2(labNow, inkBead.lab);
          const dBest = labDist2(labNow, bead.lab);
          if (dInk <= dBest * 1.4 || luma(r, g, b) < 36) bead = inkBead;
        }
        dst[i] = bead.rgb[0];
        dst[i + 1] = bead.rgb[1];
        dst[i + 2] = bead.rgb[2];
        dst[i + 3] = 255;
        indexGrid[gi] = bead.index;

        let s = regionStrength(region, o);
        /* Features (mouth/eyes): prefer shade smoothness (goal 3) */
        if (!isFlat && (isFeat || nearFeat) && region !== "line") {
          s = Math.max(s, o.shadeStrength);
        }
        const skinPix = !isFlat && isSkinLab(labNow) && !isLipOrAccent(labNow) && !isFeat;
        let bleed = regionBleed(region, o, isFeat, nearFeat, skinPix);
        if (nearFeat && !isFeat && region !== "line") bleed = Math.max(bleed, 0.75);
        const err = shapeError(r, g, b, bead.rgb[0], bead.rgb[1], bead.rgb[2], s, bleed, o.errorClamp);
        const er = err[0];
        const eg = err[1];
        const eb = err[2];
        const dir = leftToRight ? 1 : -1;
        diffuse(buf, w, h, x + dir, y, er, eg, eb, 7 / 16, maps, o, gi);
        diffuse(buf, w, h, x - dir, y + 1, er, eg, eb, 3 / 16, maps, o, gi);
        diffuse(buf, w, h, x, y + 1, er, eg, eb, 5 / 16, maps, o, gi);
        diffuse(buf, w, h, x + dir, y + 1, er, eg, eb, 1 / 16, maps, o, gi);
      }
    }

    /* Goal 1 + 2 cleanup — keep light; 0.9.1 multi-pass ate features into ink. */
    reinforceFlatInk(indexGrid, working, w, h, maps, workSrc, o.alphaCut);
    consolidateLines(indexGrid, working, w, h, maps, 1);
    flattenSolidIslands(indexGrid, working, w, h, maps, isFlat ? 1 : 1);
    if (o.despeckle > 0) {
      lightDespeckle(indexGrid, working, w, h, Math.min(2, o.despeckle), maps, o, feat);
    }
    if (isFlat) {
      consolidateLines(indexGrid, working, w, h, maps, 1);
    }
    writeIndexToDst(indexGrid, working, dst);

    return { imageData: out, indexGrid, working };
  }

  function quantizeImageData(imageData, paletteColors, opts) {
    const o = optsWith(opts);
    const w = imageData.width | 0;
    const h = imageData.height | 0;
    const src = imageData.data;
    const prepared = preparePalette(paletteColors);
    if (!prepared.length || !w || !h) {
      return typeof ImageData !== "undefined"
        ? new ImageData(Math.max(1, w), Math.max(1, h))
        : { width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) };
    }
    const working = budgetPalette(prepared, src, w, h, o.alphaCut, o.maxColors);
    return runFs(src, w, h, working, o).imageData;
  }

  function imageToGrid(imageData, paletteColors, opts) {
    const o = optsWith(opts);
    const w = imageData.width | 0;
    const h = imageData.height | 0;
    const src = imageData.data;
    const prepared = preparePalette(paletteColors);
    if (!prepared.length) return { cols: w, rows: h, grid: [] };
    const working = budgetPalette(prepared, src, w, h, o.alphaCut, o.maxColors);
    const { indexGrid } = runFs(src, w, h, working, o);
    const byIndex = Object.create(null);
    for (let i = 0; i < working.length; i++) byIndex[working[i].index] = working[i].id;
    const grid = new Array(h);
    for (let y = 0; y < h; y++) {
      const row = new Array(w);
      for (let x = 0; x < w; x++) {
        const idx = indexGrid[y * w + x];
        row[x] = idx < 0 ? -1 : byIndex[idx];
      }
      grid[y] = row;
    }
    return { cols: w, rows: h, grid };
  }

  function version() {
    return "0.9.2-fs-v2";
  }

  return {
    DEFAULTS,
    version,
    quantizeImageData,
    imageToGrid,
    rgbToLab,
    detectFlatArt,
    classifyRegion,
  };
});
