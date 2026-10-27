/** Shared palettes for Bead & Pixel tools (browser). */
(function (global) {
  const BEADANTS9 = {
    id: "beadants9",
    family: "game",
    brand: "",
    sizeFamily: "midi",
    disclaimerKey: "chart.disclaimer.beadants",
    name: { zh: "游戏 9 色（关卡用）", en: "Game 9 colors (levels)" },
    colors: [
      { id: 1, hex: "#d2a06a", name: { zh: "沙色/肤色", en: "Sand / skin" } },
      { id: 2, hex: "#5a4638", name: { zh: "深棕", en: "Dark brown" } },
      { id: 3, hex: "#e85d4c", name: { zh: "珊瑚红", en: "Coral red" } },
      { id: 4, hex: "#f0b429", name: { zh: "黄", en: "Yellow" } },
      { id: 5, hex: "#6eb6f0", name: { zh: "天蓝", en: "Sky blue" } },
      { id: 6, hex: "#7bc67e", name: { zh: "叶绿", en: "Leaf green" } },
      { id: 7, hex: "#e878b0", name: { zh: "粉", en: "Pink" } },
      { id: 8, hex: "#8b6bb5", name: { zh: "紫", en: "Purple" } },
      { id: 9, hex: "#2c2824", name: { zh: "勾线深色", en: "Outline dark" } },
    ],
  };

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const n = h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h;
    return [
      parseInt(n.slice(0, 2), 16),
      parseInt(n.slice(2, 4), 16),
      parseInt(n.slice(4, 6), 16),
    ];
  }

  function dist2(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  function displayName(name) {
    const lang = (global.FGi18n && global.FGi18n.lang) || "zh";
    if (name && typeof name === "object") return name[lang] || name.zh || name.en || "";
    return name || "";
  }

  /** Localized bead / swatch label (includes brand code when present). */
  function colorName(c) {
    if (!c) return "";
    const n = displayName(c.name) || "";
    if (c.code) {
      if (!n || n === String(c.code)) return String(c.code);
      return c.code + " · " + n;
    }
    return n || c.hex || "";
  }

  /** Short id for UI: bottle code (A1) or numeric #id. */
  function colorCode(c) {
    if (!c) return "";
    if (c.code) return String(c.code);
    return c.id != null ? "#" + c.id : "";
  }

  /**
   * Craft-facing legend / print label (UI + print sheet must match).
   * Prefer bottle code / localized name — never "internalId. code" (reads as a decimal).
   */
  function legendLabel(c) {
    if (!c) return "";
    return colorName(c) || colorCode(c) || (c.id != null ? "#" + c.id : "") || c.hex || "";
  }

  function normalizePalette(p) {
    return p.colors.map((c) => {
      const row = {
        id: c.id,
        code: c.code || "",
        hex: c.hex,
        name: c.name || c.hex,
        rgb: hexToRgb(c.hex),
      };
      if (c.sku) row.sku = c.sku;
      return row;
    });
  }

  function brandStub(globalKey, fallback) {
    return global[globalKey] || fallback;
  }

  function wrapPreset(p) {
    return {
      ...p,
      family: p.family || "approx",
      brand: p.brand || "",
      sizeFamily: p.sizeFamily || "midi",
      disclaimerKey: p.disclaimerKey || "chart.disclaimer.approx",
      colors: normalizePalette(p),
    };
  }

  const MARD_185 = brandStub("FG_PALETTE_MARD_185", {
    id: "mard-185",
    family: "brand",
    brand: "MARD",
    sizeFamily: "mini",
    disclaimerKey: "chart.disclaimer.mard",
    name: { zh: "MARD 185 色 · 2.6mm", en: "MARD 185 · 2.6mm" },
    colors: [],
  });

  const MARD_221 = brandStub("FG_PALETTE_MARD_221", {
    id: "mard-221",
    family: "brand",
    brand: "MARD",
    sizeFamily: "mini",
    disclaimerKey: "chart.disclaimer.mard",
    name: { zh: "MARD 221 色 · 2.6mm", en: "MARD 221 · 2.6mm" },
    colors: [],
  });

  const MARD_291 = brandStub("FG_PALETTE_MARD_291", {
    id: "mard-291",
    family: "brand",
    brand: "MARD",
    sizeFamily: "mini",
    disclaimerKey: "chart.disclaimer.mard",
    name: { zh: "MARD 291 色 · 2.6mm", en: "MARD 291 · 2.6mm" },
    colors: [],
  });

  const PERLER_MIDI = brandStub("FG_PALETTE_PERLER_MIDI", {
    id: "perler-midi",
    family: "brand",
    brand: "Perler",
    sizeFamily: "midi",
    disclaimerKey: "chart.disclaimer.perler",
    name: { zh: "Perler 5mm · 103 色", en: "Perler 5mm · 103 colors" },
    colors: [],
  });

  const HAMA_MIDI = brandStub("FG_PALETTE_HAMA_MIDI", {
    id: "hama-midi",
    family: "brand",
    brand: "Hama",
    sizeFamily: "midi",
    disclaimerKey: "chart.disclaimer.hama",
    name: { zh: "Hama Midi 5mm · 92 色", en: "Hama Midi 5mm · 92 colors" },
    colors: [],
  });

  const ARTKAL_S = brandStub("FG_PALETTE_ARTKAL_S", {
    id: "artkal-s",
    family: "brand",
    brand: "Artkal",
    sizeFamily: "midi",
    disclaimerKey: "chart.disclaimer.artkal",
    name: { zh: "Artkal S 5mm · 199 色", en: "Artkal S 5mm · 199 colors" },
    colors: [],
  });

  function brandBoard(globalKey, id, brand, sizeFamily, disclaimerKey, name) {
    return brandStub(globalKey, {
      id,
      family: "brand",
      brand,
      sizeFamily,
      disclaimerKey,
      name,
      colors: [],
    });
  }

  const ARTKAL_A = brandBoard("FG_PALETTE_ARTKAL_A", "artkal-a", "Artkal", "mini", "chart.disclaimer.artkal", { zh: "Artkal A 2.6mm · 145 色", en: "Artkal A 2.6mm · 145 colors" });
  const ARTKAL_C197 = brandBoard("FG_PALETTE_ARTKAL_C197", "artkal-c197", "Artkal", "mini", "chart.disclaimer.artkal", { zh: "Artkal C 2.6mm · 197 色", en: "Artkal C 2.6mm · 197 colors" });
  const ARTKAL_M221 = brandBoard("FG_PALETTE_ARTKAL_M221", "artkal-m221", "Artkal", "mini", "chart.disclaimer.artkal", { zh: "Artkal M 2.6mm · 221 色", en: "Artkal M 2.6mm · 221 colors" });
  const ARTKAL_418 = brandBoard("FG_PALETTE_ARTKAL_418", "artkal-418", "Artkal", "mini", "chart.disclaimer.artkal", { zh: "Artkal C+M · 418 色", en: "Artkal C+M · 418 colors" });
  const ARTKAL_R = brandBoard("FG_PALETTE_ARTKAL_R", "artkal-r", "Artkal", "midi", "chart.disclaimer.artkal", { zh: "Artkal R · 89 色", en: "Artkal R · 89 colors" });
  const PERLER_MINI = brandBoard("FG_PALETTE_PERLER_MINI", "perler-mini", "Perler", "mini", "chart.disclaimer.perler", { zh: "Perler Mini 2.5mm · 41 色", en: "Perler Mini 2.5mm · 41 colors" });
  const HAMA_MINI = brandBoard("FG_PALETTE_HAMA_MINI", "hama-mini", "Hama", "mini", "chart.disclaimer.hama", { zh: "Hama Mini 2.5mm · 78 色", en: "Hama Mini 2.5mm · 78 colors" });
  const HAMA_MAXI = brandBoard("FG_PALETTE_HAMA_MAXI", "hama-maxi", "Hama", "maxi", "chart.disclaimer.hama", { zh: "Hama Maxi 10mm · 25 色", en: "Hama Maxi 10mm · 25 colors" });
  const NABBI = brandBoard("FG_PALETTE_NABBI", "nabbi", "Nabbi", "midi", "chart.disclaimer.nabbi", { zh: "Nabbi 5mm · 30 色", en: "Nabbi 5mm · 30 colors" });
  const YANT = brandBoard("FG_PALETTE_YANT", "yant", "Yant", "midi", "chart.disclaimer.nabbi", { zh: "Yant 5mm · 119 色", en: "Yant 5mm · 119 colors" });

  const COCO_291 = brandStub("FG_PALETTE_COCO_291", {
    id: "coco-291",
    family: "brand",
    brand: "COCO",
    sizeFamily: "mini",
    disclaimerKey: "chart.disclaimer.cnBrand",
    name: { zh: "COCO 291 色 · 2.6mm", en: "COCO 291 · 2.6mm" },
    colors: [],
  });

  const MANMAN_278 = brandStub("FG_PALETTE_MANMAN_278", {
    id: "manman-278",
    family: "brand",
    brand: "漫漫",
    sizeFamily: "mini",
    disclaimerKey: "chart.disclaimer.cnBrand",
    name: { zh: "漫漫 278 色 · 2.6mm", en: "Manman 278 · 2.6mm" },
    colors: [],
  });

  const PANPAN_289 = brandStub("FG_PALETTE_PANPAN_289", {
    id: "panpan-289",
    family: "brand",
    brand: "盼盼",
    sizeFamily: "mini",
    disclaimerKey: "chart.disclaimer.cnBrand",
    name: { zh: "盼盼 285 色 · 2.6mm", en: "Panpan 285 · 2.6mm" },
    colors: [],
  });

  const MIXIAOWO_290 = brandStub("FG_PALETTE_MIXIAOWO_290", {
    id: "mixiaowo-290",
    family: "brand",
    brand: "咪小窝",
    sizeFamily: "mini",
    disclaimerKey: "chart.disclaimer.cnBrand",
    name: { zh: "咪小窝 286 色 · 2.6mm", en: "Mixiaowo 286 · 2.6mm" },
    colors: [],
  });

  const PRESETS = [
    MARD_185,
    MARD_221,
    MARD_291,
    COCO_291,
    MANMAN_278,
    PANPAN_289,
    MIXIAOWO_290,
    ARTKAL_S,
    ARTKAL_A,
    ARTKAL_C197,
    ARTKAL_M221,
    ARTKAL_418,
    ARTKAL_R,
    PERLER_MIDI,
    PERLER_MINI,
    HAMA_MIDI,
    HAMA_MINI,
    HAMA_MAXI,
    NABBI,
    YANT,
    BEADANTS9,
  ].map(wrapPreset);

  /** Craft / chart-facing ids (exclude retro game packs by default on bead-chart). */
  const CHART_IDS = [
    "mard-185",
    "mard-221",
    "mard-291",
    "coco-291",
    "manman-278",
    "panpan-289",
    "mixiaowo-290",
    "artkal-s",
    "artkal-a",
    "artkal-c197",
    "artkal-m221",
    "artkal-418",
    "artkal-r",
    "perler-midi",
    "perler-mini",
    "hama-midi",
    "hama-mini",
    "hama-maxi",
    "nabbi",
    "yant",
    "beadants9",
  ];

  const GROUP_ORDER = ["brand", "game"];

  function groupKey(p) {
    if (p.family === "brand" || p.brand) return "brand";
    if (p.family === "game") return "game";
    if (p.family === "retro") return "retro";
    return "approx";
  }

  function groupLabel(key) {
    const map = {
      brand: { zh: "品牌色系", en: "Brand palettes" },
      game: { zh: "游戏互通", en: "Game palettes" },
    };
    return displayName(map[key] || { zh: key, en: key });
  }

  function chartPalettes() {
    return CHART_IDS.map((id) => PRESETS.find((p) => p.id === id)).filter(Boolean);
  }

  /**
   * Fill a <select> with optgroups. opts: { includeAuto, chartOnly, selected }
   */
  function fillSelect(selectEl, opts) {
    if (!selectEl) return;
    const o = opts || {};
    const cur = o.selected != null ? o.selected : selectEl.value;
    const list = o.chartOnly ? chartPalettes() : PRESETS.slice();
    selectEl.innerHTML = "";
    if (o.includeAuto) {
      const autoOpt = document.createElement("option");
      autoOpt.value = "auto";
      autoOpt.textContent =
        (global.FGi18n && global.FGi18n.t("perler.pal.auto")) || "Auto";
      selectEl.appendChild(autoOpt);
    }
    const buckets = Object.create(null);
    list.forEach((p) => {
      const g = groupKey(p);
      if (!buckets[g]) buckets[g] = [];
      buckets[g].push(p);
    });
    GROUP_ORDER.forEach((g) => {
      const items = buckets[g];
      if (!items || !items.length) return;
      const og = document.createElement("optgroup");
      og.label = groupLabel(g);
      items.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = displayName(p.name);
        og.appendChild(opt);
      });
      selectEl.appendChild(og);
    });
    const ids = list.map((p) => p.id);
    if (o.includeAuto) ids.unshift("auto");
    if (ids.indexOf(cur) >= 0) selectEl.value = cur;
    else if (o.includeAuto) selectEl.value = "auto";
    else if (ids.length) selectEl.value = ids[0];
  }

  function nearestInPalette(rgb, colors, limit) {
    const n = Math.max(1, limit || 3);
    const scored = colors.map((c) => ({
      color: c,
      d: dist2(rgb, c.rgb || hexToRgb(c.hex)),
    }));
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, n);
  }

  global.FGPalettes = {
    PRESETS,
    CHART_IDS,
    GROUP_ORDER,
    displayName,
    colorName,
    colorCode,
    legendLabel,
    groupKey,
    groupLabel,
    chartPalettes,
    fillSelect,
    byId(id) {
      return PRESETS.find((p) => p.id === id) || PRESETS[0];
    },
    fromExtracted(colors) {
      return {
        id: "auto",
        family: "approx",
        brand: "",
        sizeFamily: "midi",
        disclaimerKey: "chart.disclaimer.approx",
        name: { zh: "从图片提取", en: "Extracted from image" },
        colors: colors.map((c, i) => ({
          id: c.id != null ? c.id : i + 1,
          code: c.code || "",
          hex: c.hex,
          name: c.name || c.hex,
          rgb: c.rgb || hexToRgb(c.hex),
        })),
      };
    },
    hexToRgb,
    dist2,
    nearestInPalette,
  };
})(typeof window !== "undefined" ? window : globalThis);
