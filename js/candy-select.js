/**
 * Mobile-only styled select (≤720px): trigger + bottom sheet.
 * Desktop keeps native <select> — this file must not alter wide layouts.
 */
(function (global) {
  const MQ = "(max-width: 720px)";
  const OPEN = "is-open";

  function t(key, fallback) {
    try {
      if (global.FGi18n && typeof global.FGi18n.t === "function") {
        const v = global.FGi18n.t(key);
        if (v && v !== key) return v;
      }
    } catch (_) { /* ignore */ }
    return fallback;
  }

  function optionLabel(opt) {
    return ((opt && (opt.label || opt.textContent)) || "").trim();
  }

  function escAttr(s) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(s);
    }
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function selectedLabel(select) {
    const opt = select.selectedOptions && select.selectedOptions[0];
    if (opt) return optionLabel(opt);
    const fallback = select.querySelector('option[value="' + escAttr(select.value) + '"]');
    return optionLabel(fallback) || select.value || "—";
  }

  function isMobile() {
    return !!(global.matchMedia && global.matchMedia(MQ).matches);
  }

  function closeAll(except) {
    document.querySelectorAll(".candy-select." + OPEN).forEach((el) => {
      if (el !== except) setOpen(el, false);
    });
  }

  function parkPanel(root) {
    const panel = root._candyPanel;
    const backdrop = root._candyBackdrop;
    if (panel && panel.parentNode !== root) root.appendChild(panel);
    if (backdrop && backdrop.parentNode !== root) root.appendChild(backdrop);
  }

  function setOpen(root, open) {
    const btn = root.querySelector(".candy-select__btn");
    const panel = root._candyPanel;
    const backdrop = root._candyBackdrop;
    if (!panel || !backdrop) return;

    root.classList.toggle(OPEN, open);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      closeAll(root);
      // Escape sticky/overflow parents so only one sheet is on screen
      document.body.appendChild(backdrop);
      document.body.appendChild(panel);
      backdrop.hidden = false;
      panel.hidden = false;
      document.documentElement.classList.add("candy-select-lock");
      const active = panel.querySelector(".candy-select__opt.is-active");
      if (active && typeof active.scrollIntoView === "function") {
        try {
          active.scrollIntoView({ block: "nearest" });
        } catch (_) { /* ignore */ }
      }
    } else {
      panel.hidden = true;
      backdrop.hidden = true;
      parkPanel(root);
      if (!document.querySelector(".candy-select." + OPEN)) {
        document.documentElement.classList.remove("candy-select-lock");
      }
    }
  }

  function rebuildList(root) {
    const select = root._candySelect;
    const list = root._candyPanel && root._candyPanel.querySelector(".candy-select__list");
    if (!select || !list) return;

    list.innerHTML = "";
    const frag = document.createDocumentFragment();

    Array.from(select.children).forEach((node) => {
      if (node.tagName === "OPTGROUP") {
        const head = document.createElement("div");
        head.className = "candy-select__group";
        head.textContent = node.label || "";
        frag.appendChild(head);
        Array.from(node.children).forEach((opt) => {
          if (opt.tagName === "OPTION") frag.appendChild(makeOpt(opt, select));
        });
      } else if (node.tagName === "OPTION") {
        frag.appendChild(makeOpt(node, select));
      }
    });

    list.appendChild(frag);
    syncTrigger(root);
  }

  function makeOpt(opt, select) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "candy-select__opt";
    btn.dataset.value = opt.value;
    btn.textContent = optionLabel(opt);
    btn.disabled = opt.disabled;
    if (opt.value === select.value) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      if (opt.disabled) return;
      const prev = select.value;
      select.value = opt.value;
      if (select.value !== prev) {
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const root = select.closest(".candy-select");
      if (root) {
        syncTrigger(root);
        setOpen(root, false);
      }
    });
    return btn;
  }

  function syncTrigger(root) {
    const select = root._candySelect;
    const label = root.querySelector(".candy-select__label");
    if (!select || !label) return;
    label.textContent = selectedLabel(select);
    const panel = root._candyPanel;
    if (!panel) return;
    panel.querySelectorAll(".candy-select__opt").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.value === select.value);
    });
  }

  function degrade(select) {
    if (!select) return;
    const root = select.closest(".candy-select");
    if (!root) return;
    setOpen(root, false);
    if (root._candyMo) {
      try {
        root._candyMo.disconnect();
      } catch (_) { /* ignore */ }
    }
    parkPanel(root);
    root.parentNode.insertBefore(select, root);
    select.classList.remove("candy-select__native");
    select.removeAttribute("tabindex");
    select.removeAttribute("aria-hidden");
    delete select.dataset.candySelect;
    try {
      delete select.value;
    } catch (_) { /* ignore */ }
    delete select._candyValuePatched;
    root.remove();
  }

  function enhance(select) {
    if (!select || select.dataset.candySelect === "1") return;
    if (select.closest(".candy-select")) return;
    if (!isMobile()) return;

    select.dataset.candySelect = "1";
    const root = document.createElement("div");
    root.className = "candy-select";
    select.parentNode.insertBefore(root, select);
    root.appendChild(select);
    root._candySelect = select;
    select.classList.add("candy-select__native");
    select.setAttribute("tabindex", "-1");
    select.setAttribute("aria-hidden", "true");

    const backdrop = document.createElement("div");
    backdrop.className = "candy-select__backdrop";
    backdrop.hidden = true;
    backdrop.addEventListener("click", () => setOpen(root, false));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "candy-select__btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    if (select.id) btn.setAttribute("aria-controls", select.id + "-candy-list");
    btn.innerHTML =
      '<span class="candy-select__label"></span><span class="candy-select__chev" aria-hidden="true"></span>';

    const panel = document.createElement("div");
    panel.className = "candy-select__panel";
    panel.hidden = true;
    panel.setAttribute("role", "listbox");

    const sheetHead = document.createElement("div");
    sheetHead.className = "candy-select__sheet-head";
    const sheetTitle = document.createElement("span");
    sheetTitle.className = "candy-select__sheet-title";
    const lab = select.id && document.querySelector('label[for="' + select.id + '"]');
    sheetTitle.textContent = lab
      ? lab.textContent.replace(/\s+/g, " ").trim()
      : t("common.params", "Options");
    const sheetClose = document.createElement("button");
    sheetClose.type = "button";
    sheetClose.className = "candy-select__sheet-close";
    sheetClose.textContent = t("perler.selectClose", "Done");
    sheetClose.addEventListener("click", () => setOpen(root, false));
    sheetHead.appendChild(sheetTitle);
    sheetHead.appendChild(sheetClose);

    const list = document.createElement("div");
    list.className = "candy-select__list";
    if (select.id) list.id = select.id + "-candy-list";

    panel.appendChild(sheetHead);
    panel.appendChild(list);
    root.appendChild(btn);
    root.appendChild(backdrop);
    root.appendChild(panel);
    root._candyPanel = panel;
    root._candyBackdrop = backdrop;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = !root.classList.contains(OPEN);
      if (willOpen) rebuildList(root);
      setOpen(root, willOpen);
    });

    if (select.id) {
      const labEl = document.querySelector('label[for="' + escAttr(select.id) + '"]');
      if (labEl && !labEl.dataset.candyBound) {
        labEl.dataset.candyBound = "1";
        labEl.addEventListener("click", (e) => {
          if (!isMobile()) return;
          e.preventDefault();
          btn.click();
        });
      }
    }

    select.addEventListener("change", () => syncTrigger(root));

    const mo = new MutationObserver(() => {
      if (root.classList.contains(OPEN)) rebuildList(root);
      else syncTrigger(root);
    });
    mo.observe(select, { childList: true, subtree: true, characterData: true });
    root._candyMo = mo;

    try {
      const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      if (desc && desc.set && desc.get && !select._candyValuePatched) {
        select._candyValuePatched = true;
        Object.defineProperty(select, "value", {
          configurable: true,
          enumerable: true,
          get() {
            return desc.get.call(this);
          },
          set(v) {
            desc.set.call(this, v);
            syncTrigger(root);
          },
        });
      }
    } catch (_) { /* ignore */ }

    syncTrigger(root);
  }

  function enhanceAll(scope) {
    (scope || document).querySelectorAll("select").forEach(enhance);
  }

  function refresh(select) {
    if (!select) return;
    if (!isMobile()) {
      degrade(select);
      return;
    }
    const root = select.closest(".candy-select");
    if (root) {
      syncTrigger(root);
      if (root.classList.contains(OPEN)) rebuildList(root);
    } else enhance(select);
  }

  function syncViewport() {
    const narrow = isMobile();
    document.documentElement.classList.toggle("candy-select-sheet", narrow);
    if (narrow) enhanceAll(document);
    else {
      closeAll(null);
      document.querySelectorAll("select[data-candy-select='1']").forEach(degrade);
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll(null);
  });

  document.addEventListener("click", (e) => {
    if (
      e.target.closest(".candy-select") ||
      e.target.closest(".candy-select__panel") ||
      e.target.closest(".candy-select__backdrop")
    ) {
      return;
    }
    closeAll(null);
  });

  if (global.matchMedia) {
    const mql = global.matchMedia(MQ);
    if (mql.addEventListener) mql.addEventListener("change", syncViewport);
    else if (mql.addListener) mql.addListener(syncViewport);
  }

  global.FGCandySelect = {
    enhance,
    enhanceAll,
    refresh,
    degrade,
    syncViewport,
    closeAll: () => closeAll(null),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncViewport);
  } else {
    syncViewport();
  }
})(typeof window !== "undefined" ? window : globalThis);
