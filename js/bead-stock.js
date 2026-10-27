/** Local bead inventory (no account). Persists owned color ids per paletteId. */
(function (global) {
  const KEY = "fg.beadStock.v2";
  const LEGACY_KEY = "fg.beadStock.v1";

  function loadAll() {
    try {
      let raw = localStorage.getItem(KEY);
      if (!raw) {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          localStorage.setItem(KEY, legacy);
          raw = legacy;
        }
      }
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

  function getOwnedIds(paletteId) {
    const all = loadAll();
    const list = all[paletteId];
    if (!Array.isArray(list)) return [];
    return list.map((n) => +n).filter((n) => Number.isFinite(n));
  }

  function setOwnedIds(paletteId, ids) {
    if (!paletteId || paletteId === "auto") return;
    const all = loadAll();
    const uniq = Array.from(
      new Set((ids || []).map((n) => +n).filter((n) => Number.isFinite(n)))
    ).sort((a, b) => a - b);
    if (!uniq.length) delete all[paletteId];
    else all[paletteId] = uniq;
    saveAll(all);
  }

  function ownedSet(paletteId) {
    return new Set(getOwnedIds(paletteId));
  }

  /** Colors used in pattern that are not in inventory. Empty stock ⇒ all used colors missing. */
  function missingColors(counts, palette, owned) {
    if (!counts || !palette || !palette.colors) return [];
    const have = owned instanceof Set ? owned : new Set(owned || []);
    return palette.colors.filter((c) => (counts[c.id] || 0) > 0 && !have.has(c.id));
  }

  function filterPaletteToStock(palette, owned) {
    if (!palette || !palette.colors) return palette;
    const have = owned instanceof Set ? owned : new Set(owned || []);
    if (!have.size) return null;
    const colors = palette.colors.filter((c) => have.has(c.id));
    if (colors.length < 2) return null;
    return {
      id: palette.id,
      name: palette.name,
      brand: palette.brand || "",
      family: palette.family,
      sizeFamily: palette.sizeFamily,
      colors: colors,
      stockFiltered: true,
    };
  }

  global.FGBeadStock = {
    KEY,
    LEGACY_KEY,
    loadAll,
    getOwnedIds,
    setOwnedIds,
    ownedSet,
    missingColors,
    filterPaletteToStock,
  };
})(typeof window !== "undefined" ? window : globalThis);
