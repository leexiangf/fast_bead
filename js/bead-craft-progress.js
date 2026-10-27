/**
 * Perler craft progress (cell-level placed beads). Local only, keyed by pattern fingerprint.
 */
(function (global) {
  const KEY = "fg.beadCraftProgress.v1";
  const MAX_ENTRIES = 12;

  function loadAll() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch (_) {
      return {};
    }
  }

  function saveAll(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data || {}));
    } catch (_) {
      /* quota / private mode */
    }
  }

  /** Short fingerprint of quantized grid + palette (enough to detect redraw/recolor). */
  function fingerprint(imageData, paletteId) {
    if (!imageData || !imageData.data) return "";
    const w = imageData.width | 0;
    const h = imageData.height | 0;
    const d = imageData.data;
    let hash = 2166136261;
    const mix = (n) => {
      hash ^= n >>> 0;
      hash = Math.imul(hash, 16777619);
    };
    mix(w);
    mix(h);
    const pid = String(paletteId || "");
    for (let i = 0; i < pid.length; i++) mix(pid.charCodeAt(i));
    const step = Math.max(1, Math.floor((w * h) / 512));
    for (let p = 0; p < w * h; p += step) {
      const i = p * 4;
      mix(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24));
    }
    /* Include corners + center for small patterns */
    const samples = [
      0,
      w - 1,
      (h - 1) * w,
      h * w - 1,
      (Math.floor(h / 2) * w + Math.floor(w / 2)) | 0,
    ];
    samples.forEach((p) => {
      if (p < 0 || p >= w * h) return;
      const i = p * 4;
      mix(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24));
    });
    return (hash >>> 0).toString(36) + "_" + w + "x" + h;
  }

  function cellKey(x, y) {
    return String(x | 0) + "," + String(y | 0);
  }

  function load(fp) {
    if (!fp) return null;
    const all = loadAll();
    const entry = all[fp];
    if (!entry || typeof entry !== "object") return null;
    return entry;
  }

  function save(fp, payload) {
    if (!fp || !payload) return;
    const all = loadAll();
    all[fp] = {
      fingerprint: fp,
      w: payload.w | 0,
      h: payload.h | 0,
      placed: Array.isArray(payload.placed) ? payload.placed : [],
      guide: payload.guide === "row" ? "row" : "color",
      focusId: payload.focusId == null ? null : payload.focusId,
      row: payload.row | 0,
      updatedAt: Date.now(),
    };
    const keys = Object.keys(all).sort(
      (a, b) => (all[b].updatedAt || 0) - (all[a].updatedAt || 0)
    );
    while (keys.length > MAX_ENTRIES) {
      const drop = keys.pop();
      delete all[drop];
    }
    saveAll(all);
  }

  function remove(fp) {
    if (!fp) return;
    const all = loadAll();
    if (all[fp]) {
      delete all[fp];
      saveAll(all);
    }
  }

  global.FGBeadCraftProgress = {
    KEY,
    fingerprint,
    cellKey,
    load,
    save,
    remove,
  };
})(typeof window !== "undefined" ? window : globalThis);
