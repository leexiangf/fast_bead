/**
 * FGBeadHandlike — hand-drawn-style photo → bead grid (no dither).
 *
 * Standalone: no dependency on FGImage / image-utils.
 * Reuse: browser `window.FGBeadHandlike`, or CommonJS `require(...)`.
 *
 * Pipeline (region-first, dither never):
 *   1) cluster pixels in Lab → working hues
 *   2) diversity-aware snap to palette (avoid many clusters → same bead)
 *   3) estimate global skin ab anchor (median of skin samples)
 *   4) assign: lip/hair direct; skin always L-band within hue lock; else cluster
 *   5) soft boundary steps on skin↔skin cliffs only (no dither)
 *   6) gentle color budget (protect highlights / deep darks)
 *   7) despeckle with protect mask; refuse merges across large ΔE
 *
 * Spec / changelog: docs/bead-handlike-algorithm.md
 * NOTE: Product main path REJECTED 2026-10-22 — kept for reference.
 * V2 archived as cartoon: docs/bead-fs-v2-algorithm.md
 * Portrait trials deprecated: docs/bead-beyond-fs-research.md
 *
 * @example
 *   const out = FGBeadHandlike.quantizeImageData(imageData, palette.colors, {
 *     maxColors: 52,
 *     minRegion: 4,
 *   });
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.FGBeadHandlike = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const DEFAULTS = {
    maxColors: 32,
    minRegion: 3,
    alphaCut: 16,
    /** 0 = off, 1 = strong skin hue preference. */
    skinBias: 0.7,
    cleanPasses: 2,
    /** Penalize reusing the same bead when snapping clusters (0–1+). */
    diversity: 0.85,
    /** Soften neighbor pairs with Lab ΔE above this (≈ distance units). */
    edgeSoftDelta: 18,
    /** Protect local L peaks/valleys / detail (catchlights, pupils, lips). */
    protectExtrema: true,
    /** Refuse despeckle merge when bead ΔE exceeds this. */
    mergeMaxDelta: 14,
    /**
     * Skin shading = mostly L. Blend local ab toward image skin-anchor (0–1).
     * Stops soft lighting from becoming left-pink / right-olive hue splits.
     */
    skinHueLock: 0.72,
    /** Soft ab radius (Lab units) around locked hue for preferred skin beads. */
    skinHueSlack: 11,
  };

  function optsWith(opts) {
    const o = opts || {};
    return {
      maxColors: Math.max(2, Math.min(64, o.maxColors != null ? o.maxColors | 0 : DEFAULTS.maxColors)),
      minRegion: Math.max(1, o.minRegion != null ? o.minRegion | 0 : DEFAULTS.minRegion),
      alphaCut: o.alphaCut != null ? o.alphaCut | 0 : DEFAULTS.alphaCut,
      skinBias: o.skinBias != null ? +o.skinBias : DEFAULTS.skinBias,
      cleanPasses: Math.max(1, Math.min(6, o.cleanPasses != null ? o.cleanPasses | 0 : DEFAULTS.cleanPasses)),
      diversity: o.diversity != null ? +o.diversity : DEFAULTS.diversity,
      edgeSoftDelta: o.edgeSoftDelta != null ? +o.edgeSoftDelta : DEFAULTS.edgeSoftDelta,
      protectExtrema: o.protectExtrema != null ? !!o.protectExtrema : DEFAULTS.protectExtrema,
      mergeMaxDelta: o.mergeMaxDelta != null ? +o.mergeMaxDelta : DEFAULTS.mergeMaxDelta,
      skinHueLock: o.skinHueLock != null ? +o.skinHueLock : DEFAULTS.skinHueLock,
      skinHueSlack: o.skinHueSlack != null ? +o.skinHueSlack : DEFAULTS.skinHueSlack,
    };
  }

  function chroma(lab) {
    return Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
  }

  /** Lips / blush accents — redder than flat skin; must not go through skin L-band. */
  function isLipOrAccent(lab) {
    return (lab[1] > 26 && lab[1] > lab[2] + 4) || (lab[0] < 58 && lab[1] > 20 && lab[1] > lab[2]);
  }

  function isHairLike(lab) {
    return lab[0] < 40 && chroma(lab) < 28;
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

  function labDeltaE(a, b) {
    return Math.sqrt(labDist2(a, b));
  }

  /** Skin-ish: mid L, pink–peach ab (positive a*, modest b*). */
  function isSkinLab(lab) {
    const L = lab[0];
    const a = lab[1];
    const b = lab[2];
    return L > 32 && L < 92 && a > 4 && a < 48 && b > -2 && b < 42 && a + Math.max(0, b) > 10;
  }

  /** Too orange / muddy for baby-pink skin shadows. */
  function isMuddyWarm(lab) {
    return lab[2] > 22 && lab[1] < lab[2] * 0.85 && lab[0] < 70;
  }

  function preparePalette(paletteColors) {
    const list = [];
    for (let i = 0; i < paletteColors.length; i++) {
      const c = paletteColors[i];
      if (!c || !c.rgb) continue;
      const rgb = c.rgb;
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      list.push({
        index: list.length,
        id: c.id != null ? c.id : list.length + 1,
        rgb: [rgb[0] | 0, rgb[1] | 0, rgb[2] | 0],
        lab,
        warm: lab[1] + 0.35 * lab[2],
        skin: isSkinLab(lab),
      });
    }
    return list;
  }

  /**
   * Palette match with skin hue fidelity + optional diversity penalty.
   * usedCounts[index] → how often this bead already snapped.
   */
  function nearestPrepared(lab, prepared, skinBias, usedCounts, diversity) {
    let best = prepared[0];
    let bestD = Infinity;
    const skin = skinBias > 0 && isSkinLab(lab);
    const div = diversity > 0 ? diversity : 0;
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i];
      let d = labDist2(lab, p.lab);
      if (skin) {
        const cool = Math.max(0, -p.lab[1]);
        d += skinBias * (cool * cool * 5);
        /* Prefer similar ab hue; penalize muddy orange when source is pinker. */
        const da = lab[1] - p.lab[1];
        const db = lab[2] - p.lab[2];
        d += skinBias * (da * da * 0.35 + db * db * 0.55);
        if (isMuddyWarm(p.lab) && lab[1] >= lab[2] * 0.9) {
          d += skinBias * 220;
        }
        /* Prefer skin-family beads for skin sources. */
        if (!p.skin) d += skinBias * 90;
      }
      if (div > 0 && usedCounts) {
        const u = usedCounts[p.index] || 0;
        if (u > 0) d += div * u * 140;
      }
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Median ab (and mean L) of skin-like samples — global hue anchor for the image. */
  function estimateSkinAnchor(src, w, h, alphaCut) {
    const as = [];
    const bs = [];
    let sumL = 0;
    let n = 0;
    const step = Math.max(1, Math.floor((w * h) / 8000));
    for (let i = 0, pix = 0; i < src.length; i += 4, pix++) {
      if (pix % step !== 0) continue;
      if (src[i + 3] < alphaCut) continue;
      const lab = rgbToLab(src[i], src[i + 1], src[i + 2]);
      if (!isSkinLab(lab) || isLipOrAccent(lab)) continue;
      as.push(lab[1]);
      bs.push(lab[2]);
      sumL += lab[0];
      n++;
    }
    if (n < 8) return null;
    as.sort((u, v) => u - v);
    bs.sort((u, v) => u - v);
    const mid = n >> 1;
    return {
      a: as[mid],
      b: bs[mid],
      L: sumL / n,
      n,
    };
  }

  function lockedSkinLab(lab, anchor, hueLock) {
    if (!anchor || !(hueLock > 0)) return lab;
    const t = Math.max(0, Math.min(1, hueLock));
    return [lab[0], lab[1] * (1 - t) + anchor.a * t, lab[2] * (1 - t) + anchor.b * t];
  }

  /**
   * Skin beads: shade mainly by L inside a locked hue family.
   * Prevents soft lighting (ΔL) from mapping to unrelated olive vs pink families.
   */
  function nearestSkinByL(lab, prepared, skinBias, anchor, hueLock, hueSlack) {
    const target = lockedSkinLab(lab, anchor, hueLock);
    const slack = hueSlack > 0 ? hueSlack : 11;
    const slack2 = slack * slack;
    let best = null;
    let bestD = Infinity;
    let fallback = null;
    let fallbackD = Infinity;
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i];
      if (!p.skin && !isSkinLab(p.lab)) continue;
      const da = target[1] - p.lab[1];
      const db = target[2] - p.lab[2];
      const ab2 = da * da + db * db;
      const dL = lab[0] - p.lab[0];
      /* Primary score: L match; ab only as tie-break inside the family. */
      let d = dL * dL * 3.0 + ab2 * 0.25;
      d += skinBias * Math.max(0, -p.lab[1]) * 6;
      if (isMuddyWarm(p.lab) && target[1] >= target[2] * 0.85) {
        d += 180 * skinBias;
      }
      if (ab2 <= slack2) {
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      } else if (d + ab2 * 0.8 < fallbackD) {
        fallbackD = d + ab2 * 0.8;
        fallback = p;
      }
    }
    return best || fallback;
  }

  function extractLabClusters(src, w, h, alphaCut, k) {
    const samples = [];
    const step = Math.max(1, Math.floor((w * h) / 12000));
    for (let i = 0, pix = 0; i < src.length; i += 4, pix++) {
      if (pix % step !== 0) continue;
      if (src[i + 3] < alphaCut) continue;
      const lab = rgbToLab(src[i], src[i + 1], src[i + 2]);
      samples.push({ r: src[i], g: src[i + 1], b: src[i + 2], lab });
    }
    if (!samples.length) {
      return [{ rgb: [0, 0, 0], lab: rgbToLab(0, 0, 0) }];
    }

    let buckets = [samples];
    const target = Math.max(2, Math.min(k, samples.length));
    while (buckets.length < target) {
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
          const lab = b[j].lab;
          if (lab[0] < L0) L0 = lab[0];
          if (lab[0] > L1) L1 = lab[0];
          if (lab[1] < a0) a0 = lab[1];
          if (lab[1] > a1) a1 = lab[1];
          if (lab[2] < b0) b0 = lab[2];
          if (lab[2] > b1) b1 = lab[2];
        }
        /* Prefer splitting large L ranges (lighting bands on faces). */
        const range = Math.max((L1 - L0) * 1.35, a1 - a0, b1 - b0);
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
        const lab = bucket[j].lab;
        if (lab[0] < L0) L0 = lab[0];
        if (lab[0] > L1) L1 = lab[0];
        if (lab[1] < a0) a0 = lab[1];
        if (lab[1] > a1) a1 = lab[1];
        if (lab[2] < b0) b0 = lab[2];
        if (lab[2] > b1) b1 = lab[2];
      }
      const rL = (L1 - L0) * 1.35;
      const rA = a1 - a0;
      const rB = b1 - b0;
      const ch = rL >= rA && rL >= rB ? 0 : rA >= rB ? 1 : 2;
      bucket.sort((u, v) => u.lab[ch] - v.lab[ch]);
      const mid = bucket.length >> 1;
      buckets.splice(bi, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    return buckets.map((bucket) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let L = 0;
      let A = 0;
      let B = 0;
      const n = bucket.length || 1;
      for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        r += p.r;
        g += p.g;
        b += p.b;
        L += p.lab[0];
        A += p.lab[1];
        B += p.lab[2];
      }
      return {
        rgb: [(r / n) | 0, (g / n) | 0, (b / n) | 0],
        lab: [L / n, A / n, B / n],
      };
    });
  }

  function snapClustersToPalette(clusters, prepared, skinBias, diversity, anchor, hueLock, hueSlack) {
    const usedCounts = Object.create(null);
    const order = clusters
      .map((c, i) => ({ i, L: c.lab[0] }))
      .sort((a, b) => a.L - b.L);
    const out = new Array(clusters.length);
    for (let k = 0; k < order.length; k++) {
      const i = order[k].i;
      const c = clusters[i];
      let bead;
      if (isSkinLab(c.lab) && !isLipOrAccent(c.lab)) {
        bead =
          nearestSkinByL(c.lab, prepared, skinBias, anchor, hueLock, hueSlack) ||
          nearestPrepared(c.lab, prepared, skinBias, usedCounts, diversity);
      } else {
        bead = nearestPrepared(c.lab, prepared, skinBias, usedCounts, diversity);
      }
      out[i] = bead;
      usedCounts[bead.index] = (usedCounts[bead.index] || 0) + 1;
    }
    return out;
  }

  function assignClusterIndex(lab, clusters) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const d = labDist2(lab, clusters[i].lab);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function buildIndexGrid(src, w, h, clusters, snapped, prepared, alphaCut, skinBias, detail, anchor, hueLock, hueSlack) {
    const grid = new Int16Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const gi = y * w + x;
        if (src[i + 3] < alphaCut) {
          grid[gi] = -1;
          continue;
        }
        const lab = rgbToLab(src[i], src[i + 1], src[i + 2]);
        /* Lips / hair: structure colors — free match. */
        if (isLipOrAccent(lab) || isHairLike(lab)) {
          grid[gi] = nearestPrepared(lab, prepared, 0, null, 0).index;
          continue;
        }
        /*
         * All skin (including mild detail): hue-locked L banding.
         * Soft lighting must not escape into unrelated olive/brown families.
         */
        if (isSkinLab(lab)) {
          const skinBead = nearestSkinByL(lab, prepared, skinBias, anchor, hueLock, hueSlack);
          grid[gi] = (skinBead || nearestPrepared(lab, prepared, skinBias, null, 0)).index;
          continue;
        }
        if (detail && detail[gi]) {
          grid[gi] = nearestPrepared(lab, prepared, 0, null, 0).index;
          continue;
        }
        const ci = assignClusterIndex(lab, clusters);
        grid[gi] = snapped[ci].index;
      }
    }
    return grid;
  }

  /**
   * Where two neighbor beads have large ΔE, paint a 1-cell midtone from palette.
   * Flat regions stay flat; only hard cliffs get a step (hand-drawn AA).
   */
  function softenHarshBoundaries(grid, src, w, h, prepared, alphaCut, edgeSoftDelta, protect, anchor, hueLock, hueSlack) {
    if (edgeSoftDelta <= 0) return;
    const next = new Int16Array(grid);
    const thr = edgeSoftDelta;
    const dirs = [
      [1, 0],
      [0, 1],
    ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (grid[i] < 0) continue;
        if (protect && protect[i]) continue;
        const pi = (y * w + x) * 4;
        if (src[pi + 3] < alphaCut) continue;
        const lab = rgbToLab(src[pi], src[pi + 1], src[pi + 2]);
        for (let d = 0; d < dirs.length; d++) {
          const nx = x + dirs[d][0];
          const ny = y + dirs[d][1];
          if (nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (grid[j] < 0 || grid[j] === grid[i]) continue;
          if (protect && protect[j]) continue;
          const A = prepared[grid[i]];
          const B = prepared[grid[j]];
          if (!A || !B) continue;
          if (labDeltaE(A.lab, B.lab) < thr) continue;
          if (
            (isHairLike(A.lab) && isSkinLab(B.lab)) ||
            (isHairLike(B.lab) && isSkinLab(A.lab)) ||
            isLipOrAccent(A.lab) ||
            isLipOrAccent(B.lab)
          ) {
            continue;
          }
          const bothSkin = isSkinLab(A.lab) && isSkinLab(B.lab);
          /* Skin↔skin: midtone must stay in hue-locked family (L step only). */
          let best = null;
          if (bothSkin && anchor) {
            const midL = (A.lab[0] + B.lab[0]) * 0.5;
            const probe = [midL, lab[1], lab[2]];
            best = nearestSkinByL(probe, prepared, 0.7, anchor, hueLock, hueSlack);
            if (best && (best.index === A.index || best.index === B.index)) best = null;
            if (best) {
              const lo = Math.min(A.lab[0], B.lab[0]);
              const hi = Math.max(A.lab[0], B.lab[0]);
              if (best.lab[0] <= lo + 0.5 || best.lab[0] >= hi - 0.5) best = null;
            }
          } else {
            const mid = [
              (A.lab[0] + B.lab[0]) * 0.35 + lab[0] * 0.3,
              (A.lab[1] + B.lab[1]) * 0.35 + lab[1] * 0.3,
              (A.lab[2] + B.lab[2]) * 0.35 + lab[2] * 0.3,
            ];
            let bestD = Infinity;
            for (let k = 0; k < prepared.length; k++) {
              const p = prepared[k];
              if (p.index === A.index || p.index === B.index) continue;
              const lo = Math.min(A.lab[0], B.lab[0]);
              const hi = Math.max(A.lab[0], B.lab[0]);
              if (p.lab[0] <= lo + 1 || p.lab[0] >= hi - 1) continue;
              const dd = labDist2(mid, p.lab);
              if (dd < bestD) {
                bestD = dd;
                best = p;
              }
            }
          }
          if (!best) continue;
          const nj = (ny * w + nx) * 4;
          const labN = rgbToLab(src[nj], src[nj + 1], src[nj + 2]);
          const midL = (A.lab[0] + B.lab[0]) * 0.5;
          const target = Math.abs(lab[0] - midL) <= Math.abs(labN[0] - midL) ? i : j;
          if (protect && protect[target]) continue;
          next[target] = best.index;
        }
      }
    }
    grid.set(next);
  }

  /**
   * Protect + detail masks from source structure.
   * Returns { protect, detail } Uint8Array length w*h.
   */
  function buildStructureMasks(src, w, h, alphaCut) {
    const protect = new Uint8Array(w * h);
    const detail = new Uint8Array(w * h);
    const labs = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3] < alphaCut) {
          labs[y * w + x] = null;
          continue;
        }
        labs[y * w + x] = rgbToLab(src[i], src[i + 1], src[i + 2]);
      }
    }
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gi = y * w + x;
        const lab = labs[gi];
        if (!lab) continue;
        const L = lab[0];
        let minL = L;
        let maxL = L;
        let grad = 0;
        let meanA = 0;
        let meanB = 0;
        let meanL = 0;
        let n = 0;
        let lap = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nb = labs[(y + dy) * w + (x + dx)];
            if (!nb) continue;
            if (nb[0] < minL) minL = nb[0];
            if (nb[0] > maxL) maxL = nb[0];
            grad = Math.max(grad, Math.abs(L - nb[0]));
            meanL += nb[0];
            meanA += nb[1];
            meanB += nb[2];
            n++;
            lap += nb[0];
          }
        }
        if (!n) continue;
        meanL /= n;
        meanA /= n;
        meanB /= n;
        lap = L * n - lap;
        const skin = isSkinLab(lab) && !isLipOrAccent(lab);
        const chromaOut =
          Math.abs(lab[1] - meanA) + Math.abs(lab[2] - meanB) > (skin ? 14 : 10);
        const isPeak = L >= maxL - 0.8 && L > 68 && grad > 6;
        const isValley = L <= minL + 0.8 && L < 36 && grad > 7;
        /* Skin: ignore mild lighting gradients as "detail" (they are ΔL, not features). */
        const strongEdge = grad > (skin ? 18 : 14);
        const midEdge = skin
          ? grad > 16 || Math.abs(lap) > 28
          : grad > 9 || Math.abs(lap) > 18;
        const lip = isLipOrAccent(lab);
        const hairEdge = isHairLike(lab) && grad > 8;

        if (isPeak || isValley || strongEdge || lip || hairEdge || chromaOut) {
          protect[gi] = 1;
        }
        if (lip || hairEdge || chromaOut || isValley || isPeak || (!skin && midEdge) || (skin && strongEdge)) {
          detail[gi] = 1;
        }
      }
    }
    return { protect, detail };
  }

  function countUsage(grid) {
    const counts = Object.create(null);
    for (let i = 0; i < grid.length; i++) {
      const id = grid[i];
      if (id < 0) continue;
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }

  function enforceColorBudget(grid, prepared, maxColors) {
    const counts = countUsage(grid);
    let ids = Object.keys(counts).map(Number);
    if (ids.length <= maxColors) return;

    ids.sort((a, b) => counts[b] - counts[a]);
    const keep = new Set(ids.slice(0, maxColors));
    const drop = ids.slice(maxColors);

    /* Only cull tiny colors if still over budget — never strip extrema beads. */
    const floor = Math.max(3, Math.floor((grid.length * 0.0008) | 0));
    for (let i = 0; i < ids.length && keep.size > Math.min(12, maxColors); i++) {
      const id = ids[i];
      if (!keep.has(id)) continue;
      const lab = prepared[id].lab;
      const extreme = lab[0] > 78 || lab[0] < 22;
      if (extreme) continue;
      if (counts[id] < floor && keep.size > Math.min(16, maxColors)) {
        keep.delete(id);
        drop.push(id);
      }
    }

    const remap = Object.create(null);
    for (let i = 0; i < drop.length; i++) {
      const from = drop[i];
      if (keep.has(from)) continue;
      const fromLab = prepared[from].lab;
      let best = -1;
      let bestD = Infinity;
      keep.forEach((to) => {
        const d = labDist2(fromLab, prepared[to].lab);
        if (d < bestD) {
          bestD = d;
          best = to;
        }
      });
      remap[from] = best;
    }

    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (v >= 0 && remap[v] != null) grid[i] = remap[v];
    }
  }

  function neighborMode(grid, w, h, x, y) {
    const counts = Object.create(null);
    let best = -1;
    let bestN = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const v = grid[ny * w + nx];
        if (v < 0) continue;
        const n = (counts[v] = (counts[v] || 0) + 1);
        if (n > bestN) {
          bestN = n;
          best = v;
        }
      }
    }
    return best;
  }

  function collectComponent(grid, w, h, sx, sy, stamp, visited, stack, cells) {
    const target = grid[sy * w + sx];
    if (target < 0) return 0;
    cells.length = 0;
    stack.length = 0;
    stack.push(sx, sy);
    visited[sy * w + sx] = stamp;
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      cells.push(x, y);
      const tryPush = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const i = ny * w + nx;
        if (visited[i] !== stamp && grid[i] === target) {
          visited[i] = stamp;
          stack.push(nx, ny);
        }
      };
      tryPush(x - 1, y);
      tryPush(x + 1, y);
      tryPush(x, y - 1);
      tryPush(x, y + 1);
    }
    return cells.length >> 1;
  }

  function despeckle(grid, w, h, minRegion, passes, protect, prepared, mergeMaxDelta) {
    const visited = new Int32Array(w * h);
    const stack = [];
    const cells = [];
    let stamp = 1;
    const next = new Int16Array(grid.length);
    const maxD = mergeMaxDelta > 0 ? mergeMaxDelta : 14;

    for (let pass = 0; pass < passes; pass++) {
      next.set(grid);
      if (stamp >= 0x7ffffffe) {
        visited.fill(0);
        stamp = 1;
      }
      const passStamp = stamp++;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (grid[i] < 0 || visited[i] === passStamp) continue;
          const sz = collectComponent(grid, w, h, x, y, passStamp, visited, stack, cells);
          if (sz >= minRegion) continue;
          let hitProtect = false;
          if (protect) {
            for (let c = 0; c < cells.length; c += 2) {
              if (protect[cells[c + 1] * w + cells[c]]) {
                hitProtect = true;
                break;
              }
            }
          }
          if (hitProtect) continue;

          const borderCounts = Object.create(null);
          let best = -1;
          let bestN = 0;
          const self = grid[i];
          for (let c = 0; c < cells.length; c += 2) {
            const cx = cells[c];
            const cy = cells[c + 1];
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const v = grid[ny * w + nx];
                if (v < 0 || v === self) continue;
                const n = (borderCounts[v] = (borderCounts[v] || 0) + 1);
                if (n > bestN) {
                  bestN = n;
                  best = v;
                }
              }
            }
          }
          if (best < 0) continue;
          /* Keep distinct feature colors (mouth vs skin) even if island is small. */
          if (prepared && prepared[self] && prepared[best]) {
            if (labDeltaE(prepared[self].lab, prepared[best].lab) > maxD) continue;
          }
          for (let c = 0; c < cells.length; c += 2) {
            const ci = cells[c + 1] * w + cells[c];
            if (protect && protect[ci]) continue;
            next[ci] = best;
          }
        }
      }
      grid.set(next);
    }
  }

  function fillHoles(grid, w, h, protect) {
    const next = new Int16Array(grid);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (protect && protect[i]) continue;
        const mode = neighborMode(grid, w, h, x, y);
        if (mode < 0) continue;
        let same = 0;
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (let d = 0; d < 4; d++) {
          const v = grid[(y + dirs[d][1]) * w + (x + dirs[d][0])];
          if (v === mode) same++;
        }
        if (same >= 3 && grid[i] !== mode) next[i] = mode;
      }
    }
    grid.set(next);
  }

  function gridToImageData(grid, w, h, prepared) {
    const out =
      typeof ImageData !== "undefined"
        ? new ImageData(w, h)
        : { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    const dst = out.data;
    for (let i = 0; i < grid.length; i++) {
      const pi = prepared[grid[i]];
      const o = i * 4;
      if (!pi || grid[i] < 0) {
        dst[o] = dst[o + 1] = dst[o + 2] = 0;
        dst[o + 3] = 0;
        continue;
      }
      dst[o] = pi.rgb[0];
      dst[o + 1] = pi.rgb[1];
      dst[o + 2] = pi.rgb[2];
      dst[o + 3] = 255;
    }
    return out;
  }

  function gridToIdCells(grid, w, h, prepared) {
    const cells = new Array(h);
    for (let y = 0; y < h; y++) {
      const row = new Array(w);
      for (let x = 0; x < w; x++) {
        const idx = grid[y * w + x];
        row[x] = idx < 0 ? -1 : prepared[idx].id;
      }
      cells[y] = row;
    }
    return cells;
  }

  function runPipeline(src, w, h, prepared, o) {
    const anchor = estimateSkinAnchor(src, w, h, o.alphaCut);
    const clusterCount = Math.min(Math.max(o.maxColors, Math.ceil(o.maxColors * 1.25)), prepared.length);
    const clusters = extractLabClusters(src, w, h, o.alphaCut, clusterCount);
    const snapped = snapClustersToPalette(
      clusters,
      prepared,
      o.skinBias,
      o.diversity,
      anchor,
      o.skinHueLock,
      o.skinHueSlack
    );

    const masks = o.protectExtrema
      ? buildStructureMasks(src, w, h, o.alphaCut)
      : { protect: null, detail: null };

    const grid = buildIndexGrid(
      src,
      w,
      h,
      clusters,
      snapped,
      prepared,
      o.alphaCut,
      o.skinBias,
      masks.detail,
      anchor,
      o.skinHueLock,
      o.skinHueSlack
    );

    softenHarshBoundaries(
      grid,
      src,
      w,
      h,
      prepared,
      o.alphaCut,
      o.edgeSoftDelta,
      masks.protect,
      anchor,
      o.skinHueLock,
      o.skinHueSlack
    );

    enforceColorBudget(grid, prepared, Math.min(o.maxColors, prepared.length));

    const minR = Math.max(o.minRegion, Math.max(2, Math.round(Math.sqrt(w * h) / 64)));
    despeckle(grid, w, h, minR, o.cleanPasses, masks.protect, prepared, o.mergeMaxDelta);
    fillHoles(grid, w, h, masks.protect);
    return grid;
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
    const grid = runPipeline(src, w, h, prepared, o);
    return gridToImageData(grid, w, h, prepared);
  }

  function imageToGrid(imageData, paletteColors, opts) {
    const o = optsWith(opts);
    const w = imageData.width | 0;
    const h = imageData.height | 0;
    const src = imageData.data;
    const prepared = preparePalette(paletteColors);
    if (!prepared.length) {
      return { cols: w, rows: h, grid: [] };
    }
    const grid = runPipeline(src, w, h, prepared, o);
    return {
      cols: w,
      rows: h,
      grid: gridToIdCells(grid, w, h, prepared),
    };
  }

  function version() {
    return "0.4.0-handlike";
  }

  return {
    DEFAULTS,
    version,
    quantizeImageData,
    imageToGrid,
    rgbToLab,
    preparePalette,
  };
});
