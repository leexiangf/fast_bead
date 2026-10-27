/**
 * Sync hub perler sources → standalone Fast Bead, then patch for OSS.
 * Run from fast_bead/: node sync-from-hub.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const HUB = path.join(ROOT, "..", "index");

const JS_COPY = [
  "i18n.js",
  "candy-select.js",
  "palette-mard-185.js",
  "palette-mard-221.js",
  "palette-mard-291.js",
  "palette-coco-291.js",
  "palette-manman-278.js",
  "palette-panpan-289.js",
  "palette-mixiaowo-290.js",
  "palette-artkal-s.js",
  "palette-artkal-a.js",
  "palette-artkal-c197.js",
  "palette-artkal-m221.js",
  "palette-artkal-418.js",
  "palette-artkal-r.js",
  "palette-perler-midi.js",
  "palette-perler-mini.js",
  "palette-hama-midi.js",
  "palette-hama-mini.js",
  "palette-hama-maxi.js",
  "palette-nabbi.js",
  "palette-yant.js",
  "palettes.js",
  "bead-stock.js",
  "bead-craft-progress.js",
  "bead-place-zones.js",
  "bead-craft-drafts.js",
  "bead-structure.js",
  "image-utils.js",
  "bead-handlike.js",
  "bead-fs-v2.js",
  "perler-templates.js",
];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log("copy", path.relative(ROOT, to));
}

for (const f of JS_COPY) {
  copyFile(path.join(HUB, "js", f), path.join(ROOT, "js", f));
}
copyFile(path.join(HUB, "css", "site.css"), path.join(ROOT, "css", "site.css"));
copyFile(
  path.join(HUB, "css", "arcade-tokens.css"),
  path.join(ROOT, "css", "arcade-tokens.css")
);
copyFile(
  path.join(HUB, "tools", "perler", "index.html"),
  path.join(ROOT, "index.html")
);
const portrait = path.join(HUB, "tools", "perler", "templates", "portrait.jpg");
if (fs.existsSync(portrait)) {
  copyFile(portrait, path.join(ROOT, "templates", "portrait.jpg"));
}

let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function replaceOnce(from, to, label) {
  if (!html.includes(from)) {
    console.warn("WARN missing:", label || String(from).slice(0, 80));
    return false;
  }
  html = html.replace(from, to);
  return true;
}

html = html.replace(
  /<title>[\s\S]*?<\/title>/,
  "<title>Fast Bead – Photo to Perler Pattern (open source)</title>"
);
html = html.replace(
  /<meta name="description" content="[^"]*" \/>/,
  '<meta name="description" content="Open-source photo → perler / fuse-bead pattern generator. Color mapping, craft mode, print export. Runs fully in the browser." />'
);
html = html.replace(/<link rel="canonical" href="[^"]*" \/>\s*/g, "");
html = html.replace(/<link rel="alternate" hreflang="zh-CN"[^>]*>\s*/g, "");
html = html.replace(/<link rel="alternate" hreflang="en"[^>]*>\s*/g, "");
html = html.replace(/href="\/css\//g, 'href="./css/');
html = html.replace(/src="\/js\//g, 'src="./js/');
html = html.replace(
  '<script src="./js/chrome.js"></script>',
  '<script src="./js/chrome-oss.js"></script>'
);
html = html.replace(
  '<script src="./js/bead-level.js"></script>',
  '<script src="./js/bead-level-stub.js"></script>'
);
html = html.replace(
  '<script src="./js/tool-bridge.js"></script>',
  '<script src="./js/tool-stub.js"></script>'
);
html = html.replace(
  /<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g,
  ""
);
html = html.replace(
  /<script type="application\/ld\+json" id="faq-ld">[\s\S]*?<\/script>\s*/g,
  ""
);

replaceOnce(
  `            <div class="handoff" id="handoff-paint" hidden>
              <p class="handoff__hint" data-i18n="handoff.hint"></p>
              <div class="actions__row">
                <button type="button" class="btn btn--teal" id="btn-to-paint" disabled data-i18n="handoff.toPaint"></button>
              </div>
            </div>`,
  `            <!-- paint handoff removed in OSS build -->
            <div class="handoff" id="handoff-paint" hidden></div>`,
  "handoff-paint"
);

replaceOnce(
  `        <div class="tool-below__side">
          <div class="cta-play" id="cta-play" hidden>
            <div class="panel__title" data-i18n="perler.cta.title"></div>
            <p class="notice" id="cta-hint" data-i18n="perler.cta.hintNeed"></p>
            <div class="field" id="field-lname">
              <label for="lname" data-i18n="perler.levelName"></label>
              <input id="lname" type="text" value="Custom" maxlength="40" />
            </div>
            <p class="notice" id="level-hint" data-i18n="perler.levelHint"></p>
            <div class="actions actions--stack">
              <div class="actions__row actions__row--single" id="cta-switch-row">
                <button type="button" class="btn btn--primary" id="btn-cta-9" data-i18n="perler.cta.switch9"></button>
              </div>
              <div class="actions__row">
                <a class="btn btn--teal" id="btn-play" href="https://beadants.fastgames.cn/" rel="noopener" data-i18n="perler.cta.play"></a>
                <button type="button" class="btn btn--ghost" id="btn-level" disabled data-i18n="perler.exportLevel"></button>
              </div>
            </div>
            <p class="notice" id="level-cards" hidden></p>
            <p class="notice">
              <a href="/tools/bead-chart/?palette=beadants9" id="link-chart" data-i18n="perler.cta.chart"></a>
            </p>
          </div>
        </div>`,
  `        <div class="tool-below__side">
          <!-- Beadants game CTA removed in OSS build; keep hidden shells so JS ids resolve -->
          <div class="cta-play" id="cta-play" hidden>
            <p class="notice" id="cta-hint" hidden></p>
            <div class="field" id="field-lname" hidden>
              <label for="lname"></label>
              <input id="lname" type="text" value="Custom" maxlength="40" />
            </div>
            <p class="notice" id="level-hint" hidden></p>
            <div class="actions actions--stack" hidden>
              <div class="actions__row actions__row--single" id="cta-switch-row" hidden>
                <button type="button" id="btn-cta-9" hidden></button>
              </div>
              <div class="actions__row" hidden>
                <a id="btn-play" href="#" hidden></a>
                <button type="button" id="btn-level" hidden></button>
              </div>
            </div>
            <p class="notice" id="level-cards" hidden></p>
            <a id="link-chart" href="https://fastgames.cn/tools/bead-chart/" hidden></a>
          </div>
        </div>`,
  "cta-play"
);

replaceOnce(
  `    <p class="related">
      <span data-i18n="common.related"></span>
      <a href="/patterns/" data-i18n="patterns.browse"></a>
      <a href="/tools/perler-paint/" data-i18n="home.card.paint.title"></a>
      <a href="/tools/bead-scan/" data-i18n="home.card.scan.title"></a>
      <a href="/tools/bead-chart/" id="rel-chart" data-i18n="home.card.chart.title"></a>
      <a href="/tools/palette/" data-i18n="perler.rel.palette"></a>
      <a href="/guides/perler-basics.html" data-i18n="perler.rel.guide"></a>
      <a href="https://beadants.fastgames.cn/" data-i18n="perler.rel.play"></a>
    </p>
    <footer class="footer"><p data-i18n="common.footerShort"></p></footer>`,
  `    <p class="related">
      <span data-i18n="common.related"></span>
      <a href="https://fastgames.cn/tools/perler/" rel="noopener">Live site</a>
      <a href="https://github.com/leexiangf/fast_bead" rel="noopener">GitHub</a>
      <a href="./docs/bead-fs-v2-algorithm.md" rel="noopener">FS v2 notes</a>
    </p>
    <footer class="footer"><p>Fast Bead · MIT · Runs locally in your browser</p></footer>`,
  "related+footer"
);

replaceOnce(
  `  <noscript>
    <section class="seo-crawl">
      <h2>照片转拼豆图纸</h2>
      <p>上传照片就能出拼豆图纸，自动标色号、算要买多少颗，下载就能打印。免费，不用上传。<a href="https://fastgames.cn/">返回 Bead &amp; Pixel 首页</a> · <a href="https://fastgames.cn/guides/perler-basics.html">怎么用</a></p>
      <h3>常见问题</h3>
      <p><strong>怎么把照片转成拼豆图纸？</strong> 上传照片，选网格与色板，下载打印页或 PNG；自动色号与珠数。</p>
      <p><strong>免费吗？要登录吗？</strong> 完全免费，无需注册。</p>
      <p><strong>图片会上传吗？</strong> 不会，全部在浏览器本地处理。</p>
      <p><strong>手头颜色不够怎么办？</strong> 勾选「我的库存色」，可仅用库存色重新匹配。</p>
      <p><strong>怎么按底板打印？</strong> 可选 29×29 / 58×58 分板，建议实际大小打印。</p>
    </section>
  </noscript>`,
  `  <noscript>
    <section class="seo-crawl">
      <h2>Fast Bead</h2>
      <p>Enable JavaScript to convert photos into perler bead patterns in your browser.</p>
    </section>
  </noscript>`,
  "noscript"
);

/* Template paths: hub uses /tools/perler/templates — keep relative if present */
html = html.replace(
  /\/tools\/perler\/templates\//g,
  "./templates/"
);

fs.writeFileSync(path.join(ROOT, "index.html"), html);
console.log("patched index.html bytes", html.length);

const must = [
  "btn-crop",
  "btn-cutout",
  "edit-clean",
  "crop-modal",
  "fitImageToGrid",
  "bead-place-zones.js",
  "chrome-oss.js",
  "tool-stub.js",
];
for (const m of must) {
  if (!html.includes(m) && m.endsWith(".js")) {
    /* script presence checked via html */
  }
  if (!html.includes(m.replace(".js", "")) && m.includes("btn")) {
    console.warn("WARN feature marker missing in html:", m);
  }
}
["btn-crop", "btn-cutout", "crop-modal", "edit-clean", "bead-place-zones", "chrome-oss"].forEach(
  (m) => {
    if (!html.includes(m)) console.warn("WARN missing in html:", m);
    else console.log("ok", m);
  }
);
