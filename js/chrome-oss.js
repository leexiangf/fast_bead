/** Minimal top bar for the open-source standalone app (brand + language). */
(function () {
  const SITE_SOCIAL = {
    github: "https://github.com/leexiangf/fast_bead",
    live: "https://fastgames.cn/tools/perler/",
    xhs: "https://www.xiaohongshu.com/user/profile/65f3a4b9000000000d02770b",
    weappName: "李随便拼豆",
  };

  function renderNav() {
    const { t } = window.FGi18n;
    const weapp =
      FGi18n.lang === "zh"
        ? "小程序：" + SITE_SOCIAL.weappName
        : "WeChat: " + SITE_SOCIAL.weappName;
    return (
      `<a class="brand" href="./">Fast <span>Bead</span></a>` +
      `<div class="topnav__links">` +
      `<a href="${SITE_SOCIAL.live}" rel="noopener">${
        FGi18n.lang === "zh" ? "在线演示" : "Live demo"
      }</a>` +
      `<a href="${SITE_SOCIAL.github}" target="_blank" rel="noopener noreferrer">GitHub</a>` +
      `<a href="${SITE_SOCIAL.xhs}" target="_blank" rel="noopener noreferrer">${
        FGi18n.lang === "zh" ? "小红书" : "Xiaohongshu"
      }</a>` +
      `<span class="topnav__meta" title="${
        FGi18n.lang === "zh" ? "微信搜索小程序名称" : "Search in WeChat mini programs"
      }">${weapp}</span>` +
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
