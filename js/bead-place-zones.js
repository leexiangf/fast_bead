/**
 * Craft zone layout: split board into zoneSize tiles; remainder strips are their own zones.
 * Port of bead-weapp place-zones (browser IIFE).
 */
(function (global) {
  function zoneKey(zr, zc) {
    return (zr | 0) + ":" + (zc | 0);
  }

  function parseZoneKey(key) {
    if (!key || typeof key !== "string") return null;
    const parts = key.split(":");
    if (parts.length !== 2) return null;
    const zr = Number(parts[0]);
    const zc = Number(parts[1]);
    if (!isFinite(zr) || !isFinite(zc) || zr < 0 || zc < 0) return null;
    return { zr: zr | 0, zc: zc | 0 };
  }

  function buildZoneLayout(cols, rows, zoneSize) {
    const size = Math.max(1, (zoneSize | 0) || 5);
    const xCuts = [];
    let x = 0;
    while (x < cols) {
      const w = Math.min(size, cols - x);
      xCuts.push({ x0: x, x1: x + w - 1 });
      x += w;
    }
    const yCuts = [];
    let y = 0;
    while (y < rows) {
      const h = Math.min(size, rows - y);
      yCuts.push({ y0: y, y1: y + h - 1 });
      y += h;
    }
    const zones = [];
    const byKey = {};
    for (let zr = 0; zr < yCuts.length; zr++) {
      for (let zc = 0; zc < xCuts.length; zc++) {
        const z = {
          zr: zr,
          zc: zc,
          x0: xCuts[zc].x0,
          x1: xCuts[zc].x1,
          y0: yCuts[zr].y0,
          y1: yCuts[zr].y1,
          key: zoneKey(zr, zc),
        };
        zones.push(z);
        byKey[z.key] = z;
      }
    }
    return {
      zoneSize: size,
      zoneCols: xCuts.length,
      zoneRows: yCuts.length,
      zones: zones,
      byKey: byKey,
    };
  }

  function getZone(layout, zr, zc) {
    if (!layout) return null;
    return layout.byKey[zoneKey(zr, zc)] || null;
  }

  function normalizeFocusZone(raw) {
    if (!raw || typeof raw !== "object") return { zr: 0, zc: 0 };
    const zr =
      typeof raw.zr === "number" && isFinite(raw.zr) && raw.zr >= 0
        ? raw.zr | 0
        : 0;
    const zc =
      typeof raw.zc === "number" && isFinite(raw.zc) && raw.zc >= 0
        ? raw.zc | 0
        : 0;
    return { zr: zr, zc: zc };
  }

  global.FGBeadPlaceZones = {
    zoneKey: zoneKey,
    parseZoneKey: parseZoneKey,
    buildZoneLayout: buildZoneLayout,
    getZone: getZone,
    normalizeFocusZone: normalizeFocusZone,
  };
})(typeof window !== "undefined" ? window : globalThis);
