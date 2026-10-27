/**
 * Perler craft drafts (quantized pattern snapshots) in IndexedDB.
 * Progress stays in FGBeadCraftProgress, linked by fingerprint.
 */
(function (global) {
  const DB_NAME = "fg.beadCraftDrafts";
  const DB_VER = 1;
  const STORE = "drafts";
  const MAX_DRAFTS = 20;

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("no_idb"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("updatedAt", "updatedAt", { unique: false });
          os.createIndex("fingerprint", "fingerprint", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb_open"));
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("idb_tx"));
      tx.onabort = () => reject(tx.error || new Error("idb_abort"));
    });
  }

  function uid() {
    return (
      "d_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function imageDataToBuffer(imageData) {
    const src = imageData.data;
    const copy = new Uint8ClampedArray(src.length);
    copy.set(src);
    return {
      w: imageData.width | 0,
      h: imageData.height | 0,
      buf: copy.buffer,
    };
  }

  function bufferToImageData(rec) {
    if (!rec || !rec.buf) return null;
    const w = rec.w | 0;
    const h = rec.h | 0;
    if (!w || !h) return null;
    const data = new Uint8ClampedArray(rec.buf);
    if (data.length < w * h * 4) return null;
    return new ImageData(data, w, h);
  }

  /** Small JPEG/PNG dataURL for list thumbs. */
  function makeThumbDataURL(imageData, maxEdge) {
    try {
      const edge = Math.max(32, Math.min(96, maxEdge || 72));
      const w = imageData.width;
      const h = imageData.height;
      const scale = Math.min(edge / w, edge / h, 1);
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      const src = document.createElement("canvas");
      src.width = w;
      src.height = h;
      src.getContext("2d").putImageData(imageData, 0, 0);
      const out = document.createElement("canvas");
      out.width = tw;
      out.height = th;
      const ctx = out.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, tw, th);
      return out.toDataURL("image/png");
    } catch (_) {
      return "";
    }
  }

  async function list() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result || []).slice();
        rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(
          rows.map((r) => ({
            id: r.id,
            title: r.title || "",
            updatedAt: r.updatedAt || 0,
            fingerprint: r.fingerprint || "",
            paletteId: r.paletteId || "",
            w: r.w | 0,
            h: r.h | 0,
            thumb: r.thumb || "",
            placedCount: r.placedCount | 0,
            beadTotal: r.beadTotal | 0,
          }))
        );
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function get(id) {
    if (!id) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(draft) {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    os.put(draft);
    await txDone(tx);
    /* Trim oldest beyond MAX */
    const all = await list();
    if (all.length <= MAX_DRAFTS) return draft.id;
    const drop = all.slice(MAX_DRAFTS);
    const tx2 = db.transaction(STORE, "readwrite");
    const os2 = tx2.objectStore(STORE);
    drop.forEach((d) => os2.delete(d.id));
    await txDone(tx2);
    return draft.id;
  }

  async function remove(id) {
    if (!id) return;
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  }

  /**
   * Build a draft record from the current quantized pattern.
   * opts: { id?, title, fingerprint, paletteId, placedCount, beadTotal }
   */
  function buildDraft(imageData, opts) {
    const o = opts || {};
    const pix = imageDataToBuffer(imageData);
    return {
      id: o.id || uid(),
      title: String(o.title || "").trim() || "Draft",
      updatedAt: Date.now(),
      fingerprint: o.fingerprint || "",
      paletteId: o.paletteId || "",
      w: pix.w,
      h: pix.h,
      pixels: pix,
      thumb: makeThumbDataURL(imageData, 72),
      placedCount: o.placedCount | 0,
      beadTotal: o.beadTotal | 0,
    };
  }

  async function saveFromImageData(imageData, opts) {
    const draft = buildDraft(imageData, opts);
    await put(draft);
    return draft;
  }

  async function loadImageData(id) {
    const row = await get(id);
    if (!row || !row.pixels) return null;
    const imageData = bufferToImageData(row.pixels);
    if (!imageData) return null;
    return { draft: row, imageData };
  }

  global.FGBeadCraftDrafts = {
    DB_NAME,
    MAX_DRAFTS,
    list,
    get,
    put,
    remove,
    buildDraft,
    saveFromImageData,
    loadImageData,
    imageDataToBuffer,
    bufferToImageData,
    makeThumbDataURL,
  };
})(typeof window !== "undefined" ? window : globalThis);
