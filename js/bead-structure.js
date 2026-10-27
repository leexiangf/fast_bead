/**
 * Bead pattern structure check + pegboard size advice (browser).
 * Used by perler maker / paint for thin tips, islands, board suggestions.
 */
(function (global) {
  const BOARD_SIDES = [14, 16, 24, 29, 32, 40, 48, 52, 58, 64, 87];

  function colorKey(r, g, b, a) {
    if (a < 16) return 0;
    return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  }

  /** Build occupancy + optional id map from quantized ImageData. */
  function maskFromImageData(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const d = imageData.data;
    const occ = new Uint8Array(w * h);
    let beads = 0;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      if (d[p + 3] < 16) continue;
      occ[i] = 1;
      beads++;
    }
    return { w, h, occ, beads };
  }

  /** Occupancy from paint-style id grid (0 = empty). */
  function maskFromGrid(grid, cols, rows) {
    const occ = new Uint8Array(cols * rows);
    let beads = 0;
    for (let i = 0; i < occ.length; i++) {
      if (grid[i]) {
        occ[i] = 1;
        beads++;
      }
    }
    return { w: cols, h: rows, occ, beads };
  }

  function neighbors4(i, w, h) {
    const x = i % w;
    const y = (i / w) | 0;
    const out = [];
    if (x > 0) out.push(i - 1);
    if (x + 1 < w) out.push(i + 1);
    if (y > 0) out.push(i - w);
    if (y + 1 < h) out.push(i + w);
    return out;
  }

  function analyzeMask(mask, opts) {
    const w = mask.w;
    const h = mask.h;
    const occ = mask.occ;
    const islandMax = (opts && opts.islandMax) || 3;
    const seen = new Int32Array(w * h);
    const components = [];
    let compId = 0;

    for (let i = 0; i < occ.length; i++) {
      if (!occ[i] || seen[i]) continue;
      compId++;
      const stack = [i];
      seen[i] = compId;
      let size = 0;
      while (stack.length) {
        const cur = stack.pop();
        size++;
        const nbs = neighbors4(cur, w, h);
        for (let k = 0; k < nbs.length; k++) {
          const j = nbs[k];
          if (!occ[j] || seen[j]) continue;
          seen[j] = compId;
          stack.push(j);
        }
      }
      components.push({ id: compId, size });
    }

    let thinTips = 0;
    let thinBridges = 0;
    for (let i = 0; i < occ.length; i++) {
      if (!occ[i]) continue;
      const nbs = neighbors4(i, w, h);
      let deg = 0;
      for (let k = 0; k < nbs.length; k++) if (occ[nbs[k]]) deg++;
      if (deg === 1) thinTips++;
      else if (deg === 2) {
        // Axis-aligned 2-neighbor beads often form 1-cell-wide corridors
        const a = nbs.filter((j) => occ[j]);
        if (a.length === 2) {
          const ax = a[0] % w;
          const ay = (a[0] / w) | 0;
          const bx = a[1] % w;
          const by = (a[1] / w) | 0;
          const ix = i % w;
          const iy = (i / w) | 0;
          const colinear =
            (ax === ix && bx === ix) || (ay === iy && by === iy);
          if (colinear) thinBridges++;
        }
      }
    }

    const islands = components.filter((c) => c.size > 0 && c.size <= islandMax);
    const islandBeads = islands.reduce((s, c) => s + c.size, 0);

    // Edge fill: beads on border (suggest margin)
    let edgeBeads = 0;
    for (let x = 0; x < w; x++) {
      if (occ[x]) edgeBeads++;
      if (h > 1 && occ[(h - 1) * w + x]) edgeBeads++;
    }
    for (let y = 1; y < h - 1; y++) {
      if (occ[y * w]) edgeBeads++;
      if (occ[y * w + w - 1]) edgeBeads++;
    }

    let severity = "ok";
    if (thinTips >= 8 || islands.length >= 4 || thinBridges >= 12) severity = "warn";
    if (thinTips >= 20 || islands.length >= 10 || thinBridges >= 30) severity = "bad";

    return {
      beads: mask.beads,
      components: components.length,
      islands: islands.length,
      islandBeads,
      thinTips,
      thinBridges,
      edgeBeads,
      severity,
      islandMax,
    };
  }

  function analyzeImageData(imageData, opts) {
    if (!imageData || !imageData.width) {
      return { beads: 0, components: 0, islands: 0, islandBeads: 0, thinTips: 0, thinBridges: 0, edgeBeads: 0, severity: "ok" };
    }
    return analyzeMask(maskFromImageData(imageData), opts);
  }

  function analyzeGrid(grid, cols, rows, opts) {
    if (!grid || !cols || !rows) {
      return { beads: 0, components: 0, islands: 0, islandBeads: 0, thinTips: 0, thinBridges: 0, edgeBeads: 0, severity: "ok" };
    }
    return analyzeMask(maskFromGrid(grid, cols, rows), opts);
  }

  /**
   * Pegboard advice for a W×H pattern (beads).
   * Returns nearest boards, tile count for 29, margin tip flag.
   */
  function boardAdvice(cols, rows, report) {
    const w = Math.max(1, cols | 0);
    const h = Math.max(1, rows | 0);
    const long = Math.max(w, h);
    let nearest = BOARD_SIDES[0];
    let nearestDist = Math.abs(long - nearest);
    for (let i = 1; i < BOARD_SIDES.length; i++) {
      const d = Math.abs(long - BOARD_SIDES[i]);
      if (d < nearestDist) {
        nearest = BOARD_SIDES[i];
        nearestDist = d;
      }
    }
    const tilesX = Math.ceil(w / 29);
    const tilesY = Math.ceil(h / 29);
    const tiles29 = tilesX * tilesY;
    const fitsOne29 = w <= 29 && h <= 29;
    const fitsOne52 = w <= 52 && h <= 52;
    const edgeRisk = report && report.edgeBeads > 0;
    const marginSuggest = edgeRisk || w >= nearest - 1 || h >= nearest - 1;

    return {
      w,
      h,
      nearest,
      nearestDist,
      tilesX,
      tilesY,
      tiles29,
      fitsOne29,
      fitsOne52,
      marginSuggest,
      boardSides: BOARD_SIDES,
    };
  }

  /** Map quantized ImageData → color ids via exact RGB match to palette. */
  function gridFromImageData(imageData, colors) {
    const w = imageData.width;
    const h = imageData.height;
    const d = imageData.data;
    const byRgb = Object.create(null);
    (colors || []).forEach((c) => {
      const rgb = c.rgb || [
        parseInt(c.hex.slice(1, 3), 16),
        parseInt(c.hex.slice(3, 5), 16),
        parseInt(c.hex.slice(5, 7), 16),
      ];
      const key = colorKey(rgb[0], rgb[1], rgb[2], 255);
      byRgb[key] = c.id;
    });
    const cells = new Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      if (d[p + 3] < 16) {
        cells[i] = 0;
        continue;
      }
      const key = colorKey(d[p], d[p + 1], d[p + 2], 255);
      let id = byRgb[key];
      if (id == null) {
        // nearest fallback
        let best = 0;
        let bestD = 1e12;
        for (let ci = 0; ci < colors.length; ci++) {
          const c = colors[ci];
          const rgb = c.rgb || [
            parseInt(c.hex.slice(1, 3), 16),
            parseInt(c.hex.slice(3, 5), 16),
            parseInt(c.hex.slice(5, 7), 16),
          ];
          const dr = d[p] - rgb[0];
          const dg = d[p + 1] - rgb[1];
          const db = d[p + 2] - rgb[2];
          const dd = dr * dr + dg * dg + db * db;
          if (dd < bestD) {
            bestD = dd;
            best = c.id;
          }
        }
        id = best;
      }
      cells[i] = id || 0;
    }
    return { cols: w, rows: h, cells };
  }

  /** Build ImageData (possibly padded to square) from id grid + palette. */
  function imageDataFromGrid(cells, cols, rows, colors, padSquare) {
    const side = padSquare ? Math.max(cols, rows) : 0;
    const w = padSquare ? side : cols;
    const h = padSquare ? side : rows;
    const byId = Object.create(null);
    (colors || []).forEach((c) => {
      const rgb = c.rgb || [
        parseInt(c.hex.slice(1, 3), 16),
        parseInt(c.hex.slice(3, 5), 16),
        parseInt(c.hex.slice(5, 7), 16),
      ];
      byId[c.id] = rgb;
    });
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const id = cells[y * cols + x] || 0;
        const ox = padSquare ? x + ((w - cols) / 2) | 0 : x;
        const oy = padSquare ? y + ((h - rows) / 2) | 0 : y;
        const p = (oy * w + ox) * 4;
        if (!id || !byId[id]) {
          data[p + 3] = 0;
          continue;
        }
        const rgb = byId[id];
        data[p] = rgb[0];
        data[p + 1] = rgb[1];
        data[p + 2] = rgb[2];
        data[p + 3] = 255;
      }
    }
    return new ImageData(data, w, h);
  }

  /**
   * Clear small islands (and optional thin tips) to transparent on quantized ImageData.
   * Uses the same component scan as analyzeMask; islandMax defaults to 3.
   */
  function clearIslandsOnImageData(imageData, opts) {
    const o = opts || {};
    const islandMax = o.islandMax != null ? o.islandMax | 0 : 3;
    const includeTips = !!o.includeTips;
    const mask = maskFromImageData(imageData);
    const w = imageData.width;
    const h = imageData.height;
    const report = analyzeMask(mask, { islandMax: islandMax });
    const out = new ImageData(
      new Uint8ClampedArray(imageData.data),
      w,
      h
    );
    const d = out.data;
    let cleared = 0;
    /* Rebuild island cells from mask components ≤ islandMax */
    const seen = new Uint8Array(w * h);
    const q = new Int32Array(w * h);
    function flood(sx, sy) {
      const cells = [];
      let head = 0;
      let tail = 0;
      const start = sy * w + sx;
      if (seen[start] || !mask[start]) return cells;
      seen[start] = 1;
      q[tail++] = start;
      while (head < tail) {
        const idx = q[head++];
        cells.push(idx);
        const x = idx % w;
        const y = (idx / w) | 0;
        const nbs = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (let i = 0; i < 4; i++) {
          const nx = nbs[i][0];
          const ny = nbs[i][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nidx = ny * w + nx;
          if (seen[nidx] || !mask[nidx]) continue;
          seen[nidx] = 1;
          q[tail++] = nidx;
        }
      }
      return cells;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!mask[idx] || seen[idx]) continue;
        const cells = flood(x, y);
        if (cells.length > 0 && cells.length <= islandMax) {
          cells.forEach((ci) => {
            d[ci * 4 + 3] = 0;
            cleared += 1;
          });
        }
      }
    }
    if (includeTips && report.thinTips > 0) {
      /* Tip clear: opaque with ≤1 orthogonal opaque neighbor */
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (d[i + 3] < 16) continue;
          let n = 0;
          if (x > 0 && d[(y * w + x - 1) * 4 + 3] >= 16) n++;
          if (x + 1 < w && d[(y * w + x + 1) * 4 + 3] >= 16) n++;
          if (y > 0 && d[((y - 1) * w + x) * 4 + 3] >= 16) n++;
          if (y + 1 < h && d[((y + 1) * w + x) * 4 + 3] >= 16) n++;
          if (n <= 1) {
            d[i + 3] = 0;
            cleared += 1;
          }
        }
      }
    }
    return { data: out, cleared: cleared, islands: report.islands };
  }

  global.FGBeadStructure = {
    BOARD_SIDES,
    analyzeImageData,
    analyzeGrid,
    boardAdvice,
    maskFromImageData,
    maskFromGrid,
    gridFromImageData,
    imageDataFromGrid,
    clearIslandsOnImageData,
  };
})(typeof window !== "undefined" ? window : globalThis);
