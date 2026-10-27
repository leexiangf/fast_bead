/**
 * Stub: Beadants level export is not part of this open-source package.
 * Keeps page JS from throwing if FGBeadLevel is referenced.
 */
(function (global) {
  global.FGBeadLevel = {
    imageToLevel() {
      return null;
    },
    encodeLevelHash() {
      return "";
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
