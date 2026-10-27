/**
 * Standalone stub for FGTool (hub analytics / cross-tool handoff).
 * Open-source build has no Worker API and no paint/game handoff.
 */
(function (global) {
  function track() {
    /* no-op */
  }

  function trackExport() {
    /* no-op */
  }

  function dataURLToImage(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("dataURL image load failed"));
      img.src = dataURL;
    });
  }

  global.FGTool = {
    track,
    trackExport,
    consumeFor() {
      return null;
    },
    consumeBeadGrid() {
      return null;
    },
    goBeadGrid() {
      return false;
    },
    dataURLToImage,
  };
})(typeof window !== "undefined" ? window : globalThis);
