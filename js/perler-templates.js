/**
 * A3 lite — starter photo template(s) for the perler maker.
 * Real image assets under ./templates/
 */
(function (global) {
  const TEMPLATES = [
    {
      id: "portrait",
      cat: "people",
      nameKey: "perler.tpl.portrait",
      src: "./templates/portrait.jpg",
      /** Photo fidelity defaults when loading this template */
      mode: "photo",
    },
  ];

  const CATEGORIES = [{ id: "people", nameKey: "perler.tpl.cat.people" }];

  const byId = Object.create(null);
  TEMPLATES.forEach((t) => {
    byId[t.id] = t;
  });

  function list(cat) {
    if (!cat || cat === "all") return TEMPLATES.slice();
    return TEMPLATES.filter((t) => t.cat === cat);
  }

  function get(id) {
    return byId[id] || null;
  }

  function toImage(tpl) {
    return new Promise((resolve, reject) => {
      if (!tpl || !tpl.src) {
        reject(new Error("template missing"));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("template load failed"));
      img.src = tpl.src + (tpl.src.indexOf("?") >= 0 ? "&" : "?") + "v=1";
    });
  }

  /** Thumbnail: use the image itself (caller may await). */
  function thumbSrc(tpl) {
    return tpl && tpl.src ? tpl.src : "";
  }

  global.FGPerlerTemplates = {
    CATEGORIES,
    TEMPLATES,
    list,
    get,
    toImage,
    thumbSrc,
  };
})(typeof window !== "undefined" ? window : globalThis);
