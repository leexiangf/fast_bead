/** Minimal top bar for the open-source standalone app (brand + language). */
(function () {
  function renderNav() {
    const { t } = window.FGi18n;
    return (
      `<a class="brand" href="./">Fast <span>Bead</span></a>` +
      `<div class="topnav__links">` +
      `<a href="https://fastgames.cn/tools/perler/" rel="noopener">${
        FGi18n.lang === "zh" ? "在线演示" : "Live demo"
      }</a>` +
      `<button type="button" class="lang-toggle" id="lang-toggle" data-i18n="nav.lang" aria-label="Language">${t("nav.lang")}</button>` +
      `</div>`
    );
  }

  function remount() {
    const nav = document.querySelector("[data-chrome-nav]");
    if (!nav || !window.FGi18n) return;
    nav.className = "topnav";
    nav.setAttribute("aria-label", "Main");
    nav.innerHTML = renderNav();
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest("#lang-toggle")) return;
    e.preventDefault();
    window.FGi18n.toggle();
  });

  document.addEventListener("DOMContentLoaded", () => {
    remount();
    window.FGi18n.apply(document);
  });

  document.addEventListener("fg:lang", () => {
    remount();
    window.FGi18n.apply(document);
  });
})();
