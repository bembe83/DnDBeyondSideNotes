(() => {
  const EXT_ROOT_ID = "ddb-notes-sidebar-root";
  const TEXTAREA_ID = "ddb-notes-sidebar-textarea";
  const SAVE_STATUS_ID = "ddb-notes-sidebar-status";
  const FRAME_GRADIENT_ID = "ddb-notes-fill-gradient";
  const FRAME_STOP_TOP_ID = "ddb-notes-fill-stop-top";
  const FRAME_STOP_MID_ID = "ddb-notes-fill-stop-mid";
  const FRAME_STOP_BOTTOM_ID = "ddb-notes-fill-stop-bottom";
  const FRAME_STROKE_SHADE_ID = "ddb-notes-stroke-shade";
  const FRAME_STROKE_MAIN_ID = "ddb-notes-stroke-main";
  const FRAME_STROKE_HIGHLIGHT_ID = "ddb-notes-stroke-highlight";
  const FRAME_SHADOW_ID = "ddb-notes-shadow";
  const SHAPE_PATH = "M14 1H132L143 9H177L188 1H306L319 14V506L306 519H14L1 506V14Z";
  const MAX_THEME_RETRIES = 20;

  let observerStarted = false;
  let saveTimer = null;
  let lastThemeKey = "";
  let themeRetryCount = 0;
  let themeRetryTimer = null;
  let lastCharacterThemeId = "";
  let templateHtmlCache = "";
  let sidebarCreatePromise = null;
  let isSyncingNativeNotes = false;

  function getViewportIntersectionArea(rect) {
    const vx1 = 0;
    const vy1 = 0;
    const vx2 = window.innerWidth;
    const vy2 = window.innerHeight;

    const ix = Math.max(0, Math.min(rect.right, vx2) - Math.max(rect.left, vx1));
    const iy = Math.max(0, Math.min(rect.bottom, vy2) - Math.max(rect.top, vy1));
    return ix * iy;
  }

  function pickBestVisibleElement(candidates) {
    if (!candidates.length) return null;

    const ranked = candidates
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        const inViewportArea = getViewportIntersectionArea(rect);
        return { el, area, inViewportArea };
      })
      .sort((a, b) => {
        if (b.inViewportArea !== a.inViewportArea) {
          return b.inViewportArea - a.inViewportArea;
        }
        return b.area - a.area;
      });

    return ranked[0]?.el || null;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
  }

  function getCharacterId() {
    const match = window.location.pathname.match(/\/characters\/(\d+)/);
    return match ? match[1] : "unknown";
  }

  function getStorageKey() {
    return `ddb_notes_${getCharacterId()}`;
  }

  function debounce(fn, delay) {
    return (...args) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => fn(...args), delay);
    };
  }

  function setStatus(text) {
    const statusEl = document.getElementById(SAVE_STATUS_ID);
    if (statusEl) statusEl.textContent = text;
  }

  function saveNotes(value) {
    const key = getStorageKey();
    chrome.storage.local.set({ [key]: value }, () => {
      setStatus("Saved");
      setTimeout(() => setStatus(""), 1200);
    });
  }

  const debouncedSave = debounce(saveNotes, 400);

  function loadNotes(callback) {
    const key = getStorageKey();
    chrome.storage.local.get([key], (result) => {
      callback(result[key] || "");
    });
  }

  function findNativeNotesSection(root) {
    if (!root) return null;
    const notesSections = [...root.querySelectorAll(".ct-notes")];
    if (!notesSections.length) return null;

    // Prefer the section that actually contains note entries; visibility is optional
    // because D&D Beyond can keep notes collapsed in the DOM at initial load.
    const ranked = notesSections
      .map((section) => ({
        section,
        noteCount: section.querySelectorAll(".ct-notes__note").length,
        visible: isElementVisible(section) ? 1 : 0
      }))
      .sort((a, b) => {
        if (b.noteCount !== a.noteCount) return b.noteCount - a.noteCount;
        return b.visible - a.visible;
      });

    return ranked[0]?.section || null;
  }

  function findLastNativeNote(root) {
    const notesSection = findNativeNotesSection(root);
    if (!notesSection) return null;

    const noteItems = [...notesSection.querySelectorAll(".ct-notes__note")];
    if (!noteItems.length) return null;

    return noteItems[noteItems.length - 1] || null;
  }

  function findNativeNotesInput(root) {
    const lastNote = findLastNativeNote(root);
    if (!lastNote) return null;

    // Prefer real editable controls inside the last note block.
    const editableChild =
      lastNote.querySelector("textarea") ||
      lastNote.querySelector("[contenteditable='true']") ||
      lastNote.querySelector("[role='textbox']") ||
      lastNote.querySelector("input[type='text']");

    if (editableChild && !editableChild.closest(`#${EXT_ROOT_ID}`)) {
      return editableChild;
    }

    // Some builds put the editor role/contenteditable on the note element itself.
    const isEditableSelf =
      lastNote.tagName === "TEXTAREA" ||
      lastNote.getAttribute("contenteditable") === "true" ||
      lastNote.getAttribute("role") === "textbox";

    if (isEditableSelf && !lastNote.closest(`#${EXT_ROOT_ID}`)) {
      return lastNote;
    }

    return null;
  }

  function normalizeNotesText(text) {
    return (text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  function getLastNoteDisplayText(root) {
    const lastNote = findLastNativeNote(root);
    if (!lastNote) return "";

    const preferredTextNode =
      lastNote.querySelector(".ct-notes__note-content") ||
      lastNote.querySelector(".ct-notes__text") ||
      lastNote.querySelector(".ddbc-markdown") ||
      lastNote.querySelector(".ddbc-html-content") ||
      lastNote;

    return normalizeNotesText(preferredTextNode.innerText || preferredTextNode.textContent || "");
  }

  function getEditableValue(el) {
    if (!el) return "";
    if ("value" in el) return el.value || "";
    return el.textContent || "";
  }

  function setTextareaLikeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function setEditableValue(el, value) {
    if (!el) return;
    if ("value" in el) {
      setTextareaLikeValue(el, value);
    } else {
      el.textContent = value;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getNativeNotesValue(root, nativeInput = null) {
    if (nativeInput) {
      const editableValue = normalizeNotesText(getEditableValue(nativeInput));
      if (editableValue) return editableValue;
    }

    return getLastNoteDisplayText(root);
  }

  function syncSidebarFromNative(root, nativeInput = null) {
    const sidebarTextarea = document.getElementById(TEXTAREA_ID);
    if (!sidebarTextarea) return;

    const nativeValue = getNativeNotesValue(root, nativeInput);
    if (sidebarTextarea.value === nativeValue) return;

    isSyncingNativeNotes = true;
    sidebarTextarea.value = nativeValue;
    saveNotes(nativeValue);
    setStatus("Synced");
    setTimeout(() => setStatus(""), 1200);
    isSyncingNativeNotes = false;
  }

  function syncSidebarToNative(value, root = findCharacterRoot()) {
    if (isSyncingNativeNotes) return;

    const nativeInput = findNativeNotesInput(root);
    if (!nativeInput) return;
    if (getEditableValue(nativeInput) === value) return;

    isSyncingNativeNotes = true;
    setEditableValue(nativeInput, value);
    isSyncingNativeNotes = false;
  }

  function ensureNativeNotesSync(root) {
    const nativeInput = findNativeNotesInput(root);

    if (nativeInput && !nativeInput.dataset.ddbNotesSidebarBound) {
      nativeInput.dataset.ddbNotesSidebarBound = "true";
      nativeInput.addEventListener("input", () => {
        if (isSyncingNativeNotes) return;
        syncSidebarFromNative(root, nativeInput);
      });
      nativeInput.addEventListener("change", () => {
        if (isSyncingNativeNotes) return;
        syncSidebarFromNative(root, nativeInput);
      });
    }

    const sidebarTextarea = document.getElementById(TEXTAREA_ID);
    if (!sidebarTextarea) return;

    const nativeValue = getNativeNotesValue(root, nativeInput);
    if (nativeValue.trim()) {
      syncSidebarFromNative(root, nativeInput);
    } else if (sidebarTextarea.value.trim()) {
      syncSidebarToNative(sidebarTextarea.value, root);
    }
  }

  function findCharacterRoot() {
    const selectors = [
      ".ct-character-sheet-desktop",
      ".ddbc-character-page",
      ".ct-character-sheet",
      ".page-content",
      "main"
    ];

    for (const selector of selectors) {
      const candidates = [...document.querySelectorAll(selector)].filter(isElementVisible);
      if (!candidates.length) continue;

      return pickBestVisibleElement(candidates);
    }

    return null;
  }

  function parseColor(input) {
    if (!input) return null;

    const normalized = input.trim();
    if (!normalized || normalized === "transparent") return null;

    const rgbMatch = normalized.match(/rgba?\(([^)]+)\)/i);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(",").map((part) => Number(part.trim()));
      if (parts.length >= 3) {
        return {
          r: Math.max(0, Math.min(255, Math.round(parts[0]))),
          g: Math.max(0, Math.min(255, Math.round(parts[1]))),
          b: Math.max(0, Math.min(255, Math.round(parts[2]))),
          a: Number.isFinite(parts[3]) ? Math.max(0, Math.min(1, parts[3])) : 1
        };
      }
    }

    const hex = normalized.replace("#", "");
    if (/^[0-9a-f]{8}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255
      };
    }

    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1
      };
    }

    if (/^[0-9a-f]{4}$/i.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: parseInt(hex[3] + hex[3], 16) / 255
      };
    }

    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1
      };
    }

    return null;
  }

  function toRgba(color, alpha = color.a ?? 1) {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  function mix(colorA, colorB, ratio) {
    const t = Math.max(0, Math.min(1, ratio));
    return {
      r: Math.round(colorA.r + (colorB.r - colorA.r) * t),
      g: Math.round(colorA.g + (colorB.g - colorA.g) * t),
      b: Math.round(colorA.b + (colorB.b - colorA.b) * t),
      a: (colorA.a ?? 1) + ((colorB.a ?? 1) - (colorA.a ?? 1)) * t
    };
  }

  function darken(color, ratio) {
    return mix(color, { r: 0, g: 0, b: 0, a: color.a ?? 1 }, ratio);
  }

  function toSvgDataUri(svg) {
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  function getTemplateFallbackHtml(characterId) {
    return `
      <svg class="ddb-notes-frame-svg" viewBox="0 0 320 520" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="${FRAME_GRADIENT_ID}" x1="0" y1="0" x2="0" y2="1">
            <stop id="${FRAME_STOP_TOP_ID}" offset="0%" stop-color="rgb(16, 22, 26)"></stop>
            <stop id="${FRAME_STOP_MID_ID}" offset="52%" stop-color="rgb(14, 20, 24)"></stop>
            <stop id="${FRAME_STOP_BOTTOM_ID}" offset="100%" stop-color="rgb(10, 16, 20)"></stop>
          </linearGradient>
          <filter id="${FRAME_SHADOW_ID}" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="rgba(181, 158, 84, 0.5)"></feDropShadow>
          </filter>
        </defs>
        <path d="${SHAPE_PATH}" fill="url(#${FRAME_GRADIENT_ID})"></path>
        <path id="${FRAME_STROKE_SHADE_ID}" d="${SHAPE_PATH}" fill="none" stroke="rgba(64, 52, 22, 0.55)" stroke-width="7"></path>
        <path id="${FRAME_STROKE_MAIN_ID}" d="${SHAPE_PATH}" fill="none" stroke="rgba(181, 158, 84, 0.98)" stroke-width="4.5" filter="url(#${FRAME_SHADOW_ID})"></path>
        <path id="${FRAME_STROKE_HIGHLIGHT_ID}" d="${SHAPE_PATH}" fill="none" stroke="rgba(225, 213, 170, 0.72)" stroke-width="1.8"></path>
      </svg>

      <div class="ddb-notes-header">
        <div class="ddb-notes-title-wrap">
          <div class="ddb-notes-title">Notes</div>
        </div>
      </div>

      <div class="ddb-notes-body">
        <textarea id="${TEXTAREA_ID}" placeholder="Write your notes here..."></textarea>
        <div class="ddb-notes-footer">
          <span id="${SAVE_STATUS_ID}"></span>
        </div>
      </div>
    `;
  }

  async function loadTemplateHtml() {
    if (templateHtmlCache) return templateHtmlCache;

    try {
      const url = chrome.runtime.getURL("notes-template.html");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Template load failed with status ${response.status}`);
      templateHtmlCache = await response.text();
      return templateHtmlCache;
    } catch {
      return "";
    }
  }

  function renderTemplate(template, values) {
    return template.replace(/__([A-Z0-9_]+)__/g, (full, key) => {
      if (Object.prototype.hasOwnProperty.call(values, key)) return String(values[key]);
      return full;
    });
  }

  function applyFrameTheme(border, bg, text) {
    const fillTop = bg;
    const fillMid = darken(bg, 0.06);
    const fillBottom = darken(bg, 0.14);
    const borderStrong = toRgba(border, 1);
    const borderShade = toRgba(darken(border, 0.38), 0.9);
    const borderHighlight = toRgba(mix(border, { r: 255, g: 255, b: 255, a: 1 }, 0.28), 1);
    const borderSoft = toRgba(border, 0.55);
    const mutedText = toRgba(mix(text, bg, 0.45), 1);

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--ddb-notes-border", toRgba(border, 1));
    rootStyle.setProperty("--ddb-notes-border-soft", borderSoft);
    rootStyle.setProperty("--ddb-notes-panel", toRgba(bg, 1));
    rootStyle.setProperty("--ddb-notes-bg", toRgba(darken(bg, 0.18), 1));
    rootStyle.setProperty("--ddb-notes-text", toRgba(text, 1));
    rootStyle.setProperty("--ddb-notes-muted", mutedText);
    rootStyle.setProperty("--ddb-notes-accent", toRgba(border, 1));

    const stopTop = document.getElementById(FRAME_STOP_TOP_ID);
    const stopMid = document.getElementById(FRAME_STOP_MID_ID);
    const stopBottom = document.getElementById(FRAME_STOP_BOTTOM_ID);
    const strokeShade = document.getElementById(FRAME_STROKE_SHADE_ID);
    const strokeMain = document.getElementById(FRAME_STROKE_MAIN_ID);
    const strokeHighlight = document.getElementById(FRAME_STROKE_HIGHLIGHT_ID);
    const shadowFilter = document.getElementById(FRAME_SHADOW_ID);
    const shadow = shadowFilter ? shadowFilter.querySelector("feDropShadow") : null;

    if (stopTop) stopTop.setAttribute("stop-color", toRgba(fillTop, 1));
    if (stopMid) stopMid.setAttribute("stop-color", toRgba(fillMid, 1));
    if (stopBottom) stopBottom.setAttribute("stop-color", toRgba(fillBottom, 1));
    if (strokeShade) strokeShade.setAttribute("stroke", borderShade);
    if (strokeMain) strokeMain.setAttribute("stroke", borderStrong);
    if (strokeHighlight) strokeHighlight.setAttribute("stroke", borderHighlight);
    if (shadow) {
      shadow.setAttribute("flood-color", toRgba(border, 0.7));
      shadow.setAttribute("stdDeviation", "4");
    }
  }

  function findSavingThrowsBox(root) {
    if (!root) return null;

    const selectors = [
      ".ct-saving-throws-box",
      ".ddbc-saving-throws-box",
      "[class*='saving-throws-box']",
      "[class*='saving-throws']"
    ];

    for (const selector of selectors) {
      const candidates = [...root.querySelectorAll(selector)].filter(isElementVisible);
      if (!candidates.length) continue;

      return pickBestVisibleElement(candidates);
    }

    return null;
  }

  function resolvePaintValue(rawValue, fallbackColor, svgRoot) {
    if (!rawValue || rawValue === "none" || rawValue === "transparent") {
      return fallbackColor;
    }

    const normalized = rawValue.trim();
    if (!normalized) return fallbackColor;

    const directColor = parseColor(normalized);
    if (directColor) return directColor;

    const gradientMatch = normalized.match(/^url\(#([^\)]+)\)$/i);
    if (gradientMatch && svgRoot) {
      const gradientId = gradientMatch[1];
      const stop = svgRoot.querySelector(`#${CSS.escape(gradientId)} stop[stop-color]`);
      if (stop) {
        const stopColor = parseColor(stop.getAttribute("stop-color"));
        if (stopColor) return stopColor;
      }
    }

    return fallbackColor;
  }

  // Returns the first value that is actually a paint value (skips "none", "transparent", empty)
  function pickPaint(...candidates) {
    for (const v of candidates) {
      if (!v) continue;
      const t = String(v).trim();
      if (!t || t === "none" || t === "transparent") continue;
      return t;
    }
    return "";
  }

  function extractThemeFromSavingThrowsSvg(source) {
    if (!source) return null;

    const svg =
      source.querySelector(":scope > .ddbc-box-background > svg") ||
      source.querySelector(":scope > .ddbc-box-background svg") ||
      source.querySelector("svg");
    if (!svg) return null;

    const paths = svg.querySelectorAll("path");
    if (paths.length < 2) return null;

    const firstPath = paths[0];
    const secondPath = paths[1];

    const firstStyle = window.getComputedStyle(firstPath);
    const secondStyle = window.getComputedStyle(secondPath);

    // getComputedStyle().stroke returns "none" (truthy!) when no stroke is set, so we must
    // use pickPaint() which explicitly skips "none" before falling through to fill.
    const fillRaw = pickPaint(firstStyle.fill, firstPath.getAttribute("fill"));
    const borderRaw = pickPaint(
      secondStyle.stroke, secondPath.getAttribute("stroke"),
      secondStyle.fill,   secondPath.getAttribute("fill")
    );

    const defaultBg     = parseColor("rgb(18, 25, 35)");
    const defaultBorder = parseColor("rgb(181, 158, 84)");

    const background = resolvePaintValue(fillRaw,   defaultBg,     svg);
    const border     = resolvePaintValue(borderRaw, defaultBorder, svg);

    if (!background || !border) return null;

    const sourceText =
      parseColor(window.getComputedStyle(source).color) || parseColor("rgb(233, 237, 243)");

    return { background, border, text: sourceText };
  }

  function clearThemeRetry() {
    if (themeRetryTimer) {
      clearTimeout(themeRetryTimer);
      themeRetryTimer = null;
    }
  }

  function scheduleThemeRetry() {
    if (themeRetryTimer || themeRetryCount >= MAX_THEME_RETRIES) return;

    const delay = Math.min(2000, 120 + themeRetryCount * 120);
    themeRetryCount += 1;
    themeRetryTimer = setTimeout(() => {
      themeRetryTimer = null;
      void tryInject();
    }, delay);
  }

  function isThemeSourceReady(source) {
    if (!source || !source.isConnected) return false;

    const rect = source.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80) return false;

    const svg =
      source.querySelector(":scope > .ddbc-box-background > svg") ||
      source.querySelector(":scope > .ddbc-box-background svg") ||
      source.querySelector("svg");
    if (!svg) return false;

    const paths = svg.querySelectorAll("path");
    return paths.length >= 2;
  }

  function applySheetTheme(root) {
    const source = findSavingThrowsBox(root);
    if (!isThemeSourceReady(source)) return false;

    const svgTheme = extractThemeFromSavingThrowsSvg(source);
    if (!svgTheme) return false;

    const border = svgTheme.border;
    const bg = svgTheme.background;
    const text = svgTheme.text;

    const themeKey = [
      toRgba(border, 1),
      toRgba(bg, 1),
      toRgba(text, 1)
    ].join("|");

    if (themeKey === lastThemeKey) return true;
    lastThemeKey = themeKey;

    applyFrameTheme(border, bg, text);

    return true;
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim().toUpperCase();
  }

  function findHealthQuickInfo(root) {
    if (!root) return null;

    const selectors = [
      ".ct-quick-info__health",
      ".ct-quick-info_health",
      "[class*='quick-info'][class*='health']",
      "[data-testid*='health']"
    ];

    for (const selector of selectors) {
      const match = root.querySelector(selector);
      if (match) return match;
    }

    return null;
  }

  function findCombatStatuses(root) {
    if (!root) return null;

    const selectors = [
      ".ct-combat__statuses",
      ".ddbc-combat__statuses",
      "[class*='combat__statuses']",
      "[class*='combat'][class*='statuses']",
      "[data-testid*='statuses']"
    ];

    for (const selector of selectors) {
      const candidates = [...root.querySelectorAll(selector)].filter(isElementVisible);
      if (!candidates.length) continue;

      return pickBestVisibleElement(candidates);
    }

    return null;
  }

  function elementLooksLikeSensesCard(el) {
    if (!el) return false;

    if (el.id === EXT_ROOT_ID) return false;
    if (el.closest(`#${EXT_ROOT_ID}`)) return false;

    const text = normalizeText(el.textContent);
    if (!text) return false;

    const hasSensesTitle = text.includes("SENSES");
    const hasPassiveSense =
      text.includes("PASSIVE PERCEPTION") ||
      text.includes("PASSIVE INVESTIGATION") ||
      text.includes("PASSIVE INSIGHT");

    const includesSavingThrows =
      text.includes("SAVING THROW MODIFIERS") || text.includes("SAVING THROWS");

    if (includesSavingThrows) return false;

    return hasSensesTitle && hasPassiveSense;
  }

  function pickMostSpecificSensesCard(candidates) {
    if (!candidates.length) return null;

    const leafCandidates = candidates.filter((candidate) => {
      return !candidates.some((other) => other !== candidate && candidate.contains(other));
    });

    const targetPool = leafCandidates.length ? leafCandidates : candidates;
    targetPool.sort((a, b) => {
      const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
      const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
      return areaA - areaB;
    });

    return targetPool[0];
  }

  function findSensesCard(root) {
    if (!root) return null;

    const matched = [];
    const seen = new Set();

    const selectors = [
      ".ct-senses",
      ".ddbc-senses",
      "[class*='senses']",
      "[data-testid*='senses']"
    ];

    for (const selector of selectors) {
      const candidates = root.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (!seen.has(candidate) && elementLooksLikeSensesCard(candidate)) {
          seen.add(candidate);
          matched.push(candidate);
        }
      }
    }

    if (matched.length) {
      return pickMostSpecificSensesCard(matched);
    }

    const fallbackCandidates = root.querySelectorAll("section, article, div");
    for (const candidate of fallbackCandidates) {
      if (!seen.has(candidate) && elementLooksLikeSensesCard(candidate)) {
        seen.add(candidate);
        matched.push(candidate);
      }
    }

    return pickMostSpecificSensesCard(matched);
  }

  async function createSidebar() {
    const existing = document.getElementById(EXT_ROOT_ID);
    if (existing) return existing;
    if (sidebarCreatePromise) return sidebarCreatePromise;

    sidebarCreatePromise = (async () => {
      const characterId = getCharacterId();
      const template = await loadTemplateHtml();

      const root = document.createElement("section");
      root.id = EXT_ROOT_ID;

      const html = template
        ? renderTemplate(template, {
            FRAME_GRADIENT_ID,
            FRAME_STOP_TOP_ID,
            FRAME_STOP_MID_ID,
            FRAME_STOP_BOTTOM_ID,
            FRAME_STROKE_SHADE_ID,
            FRAME_STROKE_MAIN_ID,
            FRAME_STROKE_HIGHLIGHT_ID,
            FRAME_SHADOW_ID,
            SHAPE_PATH,
            CHARACTER_ID: characterId,
            TEXTAREA_ID,
            SAVE_STATUS_ID
          })
        : getTemplateFallbackHtml(characterId);

      root.innerHTML = html;

      const textarea = root.querySelector(`#${TEXTAREA_ID}`);
      if (!textarea) return null;

      loadNotes((storedValue) => {
        textarea.value = storedValue;
      });

      textarea.addEventListener("input", (e) => {
        if (!isSyncingNativeNotes) {
          syncSidebarToNative(e.target.value);
        }
        setStatus("Saving...");
        debouncedSave(e.target.value);
      });

      return root;
    })().finally(() => {
      sidebarCreatePromise = null;
    });

    return sidebarCreatePromise;
  }

  function schedulePlacementRetries() {
    const delays = [100, 300, 700, 1200, 2000];
    for (const delay of delays) {
      setTimeout(() => {
        void tryInject();
      }, delay);
    }
  }

  async function placeSidebar() {
    const currentCharacterId = getCharacterId();
    if (currentCharacterId !== lastCharacterThemeId) {
      lastCharacterThemeId = currentCharacterId;
      lastThemeKey = "";
      clearThemeRetry();
      themeRetryCount = 0;
    }

    const root = findCharacterRoot();
    const combatStatuses = findCombatStatuses(root);
    const healthCard = findHealthQuickInfo(root);
    const sensesCard = findSensesCard(root);
    let sidebar = document.getElementById(EXT_ROOT_ID);

    if (!root) return;

    if (!sidebar) {
      sidebar = await createSidebar();
      if (!sidebar) return;
    }

    // Must be in the DOM before applySheetTheme so getElementById can find SVG elements
    if (sidebar.parentElement !== document.body) {
      sidebar.style.visibility = "hidden";
      document.body.appendChild(sidebar);
    }

    const themeReady = applySheetTheme(root);

    if (!themeReady) {
      sidebar.style.visibility = "hidden";
      scheduleThemeRetry();
      return;
    }

    clearThemeRetry();
    sidebar.style.visibility = "visible";
    themeRetryCount = 0;

    ensureNativeNotesSync(root);

    const anchor = combatStatuses || healthCard || sensesCard;
    const sidebarWidth = 320;
    const gap = 12;

    // Prefer the combat statuses card for vertical alignment so the notes panel starts
    // at the same height as the right-side combat/status stack.
    const sheetRect = root.getBoundingClientRect();
    const anchorTopSource = combatStatuses || healthCard || sensesCard;
    const preferredTop = anchorTopSource ? anchorTopSource.getBoundingClientRect().top : sheetRect.top;
    const sheetTop = Math.round(Math.max(8, preferredTop));

    // Shrink the sidebar to fit the visible area — catches devtools opening on the side
    // (which narrows/shortens the viewport) without overflowing.
    const availableHeight = window.innerHeight - sheetTop - 8;
    sidebar.style.top = `${sheetTop}px`;
    sidebar.style.maxHeight = `${Math.max(180, availableHeight)}px`;

    if (anchor) {
      const anchorRect = anchor.getBoundingClientRect();
      const desiredLeft = Math.round(anchorRect.right + gap);
      const maxLeft = Math.max(8, window.innerWidth - sidebarWidth - 8);
      sidebar.style.left = `${Math.max(8, Math.min(desiredLeft, maxLeft))}px`;
    } else {
      sidebar.style.left = "12px";
    }
  }

  async function tryInject() {
    if (!window.location.pathname.includes("/characters/")) return;

    await placeSidebar();
  }

  function observePageChanges() {
    if (observerStarted) return;
    observerStarted = true;

    const observer = new MutationObserver(() => {
      void tryInject();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("resize", () => {
      void tryInject();
    });
    window.addEventListener("scroll", () => {
      void tryInject();
    }, true);
  }

  function initRouteWatcher() {
    let lastPath = location.pathname;

    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        const existing = document.getElementById(EXT_ROOT_ID);
        if (existing) existing.remove();
        templateHtmlCache = "";
        clearThemeRetry();
        themeRetryCount = 0;
        lastThemeKey = "";
        setTimeout(() => {
          void tryInject();
        }, 400);
        schedulePlacementRetries();
      }
    }, 500);
  }

  function init() {
    void tryInject();
    schedulePlacementRetries();
    observePageChanges();
    initRouteWatcher();
  }

  init();
})();