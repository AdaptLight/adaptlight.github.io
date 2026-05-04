(() => {

  const $ = id => document.getElementById(id);

  // Intentional copy of getUiScale — each module reads the CSS var independently so they stay self-contained.
  function getUiScale() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  const scale = (value) => value * getUiScale();

  // ── Theme management ──

  function getEffectiveTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit) return explicit;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const scheme = theme === "light" ? "only light" : "dark light";
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = scheme;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.style.backgroundColor = theme === "light" ? "#f5f5f5" : "#0c0c0e";
  }

  function applyThemeIcons() {
    const theme = getEffectiveTheme();
    const themeIconSun = $("themeIconSun");
    const themeIconMoon = $("themeIconMoon");
    themeIconSun.style.display = theme === "light" ? "block" : "none";
    themeIconMoon.style.display = theme === "dark" ? "block" : "none";
  }

  function getThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      tick: s.getPropertyValue("--chart-tick").trim(),
      line: s.getPropertyValue("--chart-line").trim(),
      fill: s.getPropertyValue("--chart-fill").trim(),
      text: s.getPropertyValue("--text").trim(),
      nowLine: s.getPropertyValue("--now-line").trim(),
      nowText: s.getPropertyValue("--now-text").trim(),
      bg: s.getPropertyValue("--bg").trim(),
    };
  }

  function getUiFontFamily() {
    return getComputedStyle(document.body).fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  }

  applyThemeIcons();

  // ── Sidebar hide/show ──

  function recalculateChartSize() {
    const w = chartArea.clientWidth;
    const h = chartArea.clientHeight;
    if (w <= 0 || h <= 0) return;
    const containerRatio = w / h;
    const clampedRatio = Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, containerRatio));
    const target = clampedRatio + (IDEAL_ASPECT - clampedRatio) * 0.28;
    chart.options.aspectRatio = target;
    chart.options.scales.x.ticks.font.size = scale(12);
    chart.options.scales.yBrightness.ticks.font.size = scale(12);
    chart.options.scales.yBrightness.title.font.size = scale(13);
    chart.resize();
  }

  let chartResizeTimer = null;

  function scheduleChartResize() {
    if (chartResizeTimer) return;
    chartResizeTimer = requestAnimationFrame(() => {
      chartResizeTimer = null;
      recalculateChartSize();
    });
  }

  $("sidebarHide").addEventListener("click", () => {
    document.body.classList.add("sidebar-hidden");
    scheduleChartResize();
  });

  $("sidebarShow").addEventListener("click", () => {
    document.body.classList.remove("sidebar-hidden");
    scheduleChartResize();
  });

  // ── Slider <-> Number input pairing ──

  // Integer slider ranges displayed as floats
  const sunShiftDisplay = { toDisplay: v => (v / 20).toFixed(2), toSlider: v => Math.round(v * 20) };
  const luxStrDisplay   = { toDisplay: v => (v / 20).toFixed(2), toSlider: v => Math.round(v * 20) };

  function updateSliderProgress(slider) {
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.backgroundSize = pct + "% 100%";
  }

  const sliderPairs = [
    { slider: "minBrightness", num: "minBrightnessNum" },
    { slider: "maxBrightness", num: "maxBrightnessNum" },
    { slider: "minColorTemp",  num: "minColorTempNum" },
    { slider: "maxColorTemp",  num: "maxColorTempNum" },
    { slider: "sunShiftStrength", num: "sunShiftStrengthNum", fmt: sunShiftDisplay },
    { slider: "luxStrength",   num: "luxStrengthNum", fmt: luxStrDisplay },
    { slider: "currentLux",    num: "currentLuxNum" },
    { slider: "effectiveMax",  num: "effectiveMaxNum" },
  ];

  sliderPairs.forEach(({ slider, num, fmt }) => {
    const s = $(slider), n = $(num);
    const syncNumberFromSlider = () => {
      n.value = fmt ? fmt.toDisplay(+s.value) : s.value;
      updateSliderProgress(s);
    };

    syncNumberFromSlider();

    if (fmt) n.step = "any";
    s.addEventListener("input", syncNumberFromSlider);
    n.addEventListener("input", () => {
      if (n.value === "") return;
      const raw = +n.value;
      if (!Number.isFinite(raw)) return;
      s.value = clamp(fmt ? fmt.toSlider(raw) : raw, +s.min, +s.max);
      updateSliderProgress(s);
    });
    n.addEventListener("blur", () => {
      if (n.value === "") {
        s.value = +s.defaultValue;
      } else {
        const raw = +n.value;
        if (Number.isFinite(raw)) {
          s.value = clamp(fmt ? fmt.toSlider(raw) : raw, +s.min, +s.max);
        } else {
          s.value = +s.defaultValue;
        }
      }
      n.value = fmt ? fmt.toDisplay(+s.value) : String(s.value);
      updateSliderProgress(s);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  // ── DOM refs ──

  const els = {
    curveType: $("curveType"),
    minBrightness: $("minBrightness"),
    maxBrightness: $("maxBrightness"),
    wakeStart: $("wakeStart"),
    wakeEnd: $("wakeEnd"),
    dozeStart: $("dozeStart"),
    dozeEnd: $("dozeEnd"),
    minColorTemp: $("minColorTemp"),
    maxColorTemp: $("maxColorTemp"),
    syncCurves: $("syncCurves"),
    colorTimingSection: $("colorTimingSection"),
    colorWakeStart: $("colorWakeStart"),
    colorWakeEnd: $("colorWakeEnd"),
    colorDozeStart: $("colorDozeStart"),
    colorDozeEnd: $("colorDozeEnd"),
    sunShiftEnabled: $("sunShiftEnabled"),
    sunShiftControls: $("sunShiftControls"),
    sunShiftStrength: $("sunShiftStrength"),
    useLocation: $("useLocation"),
    locationStatus: $("locationStatus"),
    sunrise: $("sunrise"),
    sunset: $("sunset"),
    luxEnabled: $("luxEnabled"),
    luxControls: $("luxControls"),
    luxStrength: $("luxStrength"),
    currentLux: $("currentLux"),
    effectiveMax: $("effectiveMax"),
    useRgbColor: $("useRgbColor"),
    rgbControls: $("rgbControls"),
    rgbStartColor: $("rgbStartColor"),
    rgbEndColor: $("rgbEndColor"),
    rgbStartColorReset: $("rgbStartColorReset"),
    rgbEndColorReset: $("rgbEndColorReset"),
    exportImportEnabled: $("exportImportEnabled"),
    exportImportControls: $("exportImportControls"),
    exportImportBox: $("exportImportBox"),
    importBtn: $("importBtn"),
  };

  const timeInputs = [
    els.wakeStart,
    els.wakeEnd,
    els.dozeStart,
    els.dozeEnd,
    els.colorWakeStart,
    els.colorWakeEnd,
    els.colorDozeStart,
    els.colorDozeEnd,
    els.sunrise,
    els.sunset,
  ];

  // Track last valid value so we can restore on blur
  for (const input of timeInputs) {
    input.dataset.lastValidValue = input.value || input.defaultValue;
  }

  function isValidTimeValue(value) {
    return /^\d{2}:\d{2}$/.test(value);
  }

  function safeTime(el) {
    if (isValidTimeValue(el.value)) return el.value;
    return el.dataset.lastValidValue || el.defaultValue;
  }

  for (const input of timeInputs) {
    input.addEventListener("input", () => {
      if (isValidTimeValue(input.value)) {
        input.dataset.lastValidValue = input.value;
      }
    });
    input.addEventListener("blur", () => {
      if (!isValidTimeValue(input.value)) {
        input.value = input.defaultValue;
        input.dataset.lastValidValue = input.defaultValue;
      } else {
        input.dataset.lastValidValue = input.value;
      }
      render();
    });
  }

  // ── Custom time pickers ──

  const timePickers = [];
  let sunriseTp = null;
  let sunsetTp = null;
  if (typeof TimePicker !== "undefined") {
    for (const input of timeInputs) {
      const tp = new TimePicker(input);
      timePickers.push(tp);
      if (input === els.sunrise) sunriseTp = tp;
      if (input === els.sunset) sunsetTp = tp;
    }
  }

  function refreshTimePickers() {
    for (const tp of timePickers) tp.syncFromInput();
  }

  // ── Time reset buttons ──

  for (const btn of document.querySelectorAll(".time-reset-btn")) {
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.for);
      if (!input) return;
      input.value = input.defaultValue;
      input.dataset.lastValidValue = input.defaultValue;
      refreshTimePickers();
      render();
    });
  }

  function readParams() {
    return {
      curveType: els.curveType.value,
      minBrightness: +els.minBrightness.value,
      maxBrightness: +els.maxBrightness.value,
      wakeStart: safeTime(els.wakeStart),
      wakeEnd: safeTime(els.wakeEnd),
      dozeStart: safeTime(els.dozeStart),
      dozeEnd: safeTime(els.dozeEnd),
      minColorTemp: +els.minColorTemp.value,
      maxColorTemp: +els.maxColorTemp.value,
      syncCurves: els.syncCurves.checked,
      colorWakeStart: safeTime(els.colorWakeStart),
      colorWakeEnd: safeTime(els.colorWakeEnd),
      colorDozeStart: safeTime(els.colorDozeStart),
      colorDozeEnd: safeTime(els.colorDozeEnd),
      sunShiftEnabled: els.sunShiftEnabled.checked,
      sunShiftStrength: +els.sunShiftStrength.value / 20,
      sunrise: safeTime(els.sunrise),
      sunset: safeTime(els.sunset),
      luxEnabled: els.luxEnabled.checked,
      luxStrength: +els.luxStrength.value / 20,
      currentLux: +els.currentLux.value,
      effectiveMax: +els.effectiveMax.value,
      useRgbColor: els.useRgbColor.checked,
      rgbStartColor: els.rgbStartColor.value,
      rgbEndColor: els.rgbEndColor.value,
    };
  }

  // ── Location-based sun times ──

  let geoLocation = null;
  let geoLabel = "";

  function saveLocation() {
    if (geoLocation && geoLabel) {
      localStorage.setItem("geoLocation", JSON.stringify({ lat: geoLocation.lat, lon: geoLocation.lon, label: geoLabel }));
    }
    localStorage.setItem("useLocation", els.useLocation.checked ? "1" : "");
  }

  function setLocationStatus(text) {
    els.locationStatus.textContent = text;
  }

  function applySunTimes() {
    if (!geoLocation) return;
    const times = SunCalc.calculate(geoLocation.lat, geoLocation.lon, new Date());
    if (!times) { setLocationStatus("Sun times unavailable for this latitude"); return; }
    els.sunrise.value = times.sunrise;
    els.sunrise.dataset.lastValidValue = times.sunrise;
    els.sunset.value = times.sunset;
    els.sunset.dataset.lastValidValue = times.sunset;
    refreshTimePickers();
    render();
  }

  function fetchLocation() {
    setLocationStatus("Locating...");
    fetch("https://ipinfo.io/json")
      .then(r => r.json())
      .then(data => {
        const loc = data.loc ? data.loc.split(",") : null;
        if (loc && loc.length === 2) {
          geoLocation = { lat: +loc[0], lon: +loc[1] };
          geoLabel = data.city ? data.city + ", " + (data.country || data.region) : "Location found";
          setLocationStatus(geoLabel);
          saveLocation();
          applySunTimes();
        } else {
          setLocationStatus("Could not determine location");
        }
      })
      .catch(() => { setLocationStatus("Location lookup failed"); });
  }

  (function restoreLocation() {
    const saved = localStorage.getItem("geoLocation");
    const wasOn = localStorage.getItem("useLocation") === "1";
    if (saved && wasOn) {
      try {
        const d = JSON.parse(saved);
        geoLocation = { lat: d.lat, lon: d.lon };
        geoLabel = d.label || "Location found";
        els.useLocation.checked = true;
        setLocationStatus(geoLabel);
        applySunTimes();
      } catch (_) { /* corrupt data, ignore */ }
    }
  })();

  els.useLocation.addEventListener("change", () => {
    if (els.useLocation.checked) {
      if (geoLocation) {
        setLocationStatus(geoLabel);
        applySunTimes();
      } else {
        fetchLocation();
      }
    } else {
      setLocationStatus("");
    }
    saveLocation();
    updateSunInputState();
    render();
  });

  function updateSunInputState() {
    const locked = els.useLocation.checked;
    els.sunrise.readOnly = locked;
    els.sunset.readOnly = locked;
    if (sunriseTp) sunriseTp.setEnabled(!locked);
    if (sunsetTp) sunsetTp.setEnabled(!locked);
    for (const btn of document.querySelectorAll(".time-reset-btn[data-for='sunrise'], .time-reset-btn[data-for='sunset']")) {
      btn.disabled = locked;
      btn.style.opacity = locked ? "0.5" : "";
    }
  }

  const sidebar = $("sidebar");

  function updateVisibility(params) {
    els.colorTimingSection.style.display = els.syncCurves.checked ? "none" : "";
    els.sunShiftControls.style.display = els.sunShiftEnabled.checked ? "" : "none";
    els.luxControls.style.display = els.luxEnabled.checked ? "" : "none";
    els.rgbControls.style.display = els.useRgbColor.checked ? "" : "none";
    els.exportImportControls.style.display = els.exportImportEnabled.checked ? "" : "none";
    sidebar.classList.toggle("show-time-resets", els.exportImportEnabled.checked);
    updateExportBox(params);
    updateSunInputState();
  }

  // ── Resizable sidebar ──
  const handle = $("resize-handle");
  let resizing = false;
  let _resizeRafId = null;
  let _resizePendingX = 0;
  let _resizePendingY = 0;
  let _resizeBaseMinW = 0;

  const mobileBp = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--mobile-bp"), 10) || 600;

  function isMobile() {
    return window.innerWidth <= mobileBp;
  }

  function showMobileUI() {
    const isTouchOnly = !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    document.documentElement.dataset.mobileUi = (isTouchOnly || isMobile()) ? "1" : "0";
  }

  function startResize(e) {
    if (resizing) return;
    if (e.cancelable) e.preventDefault();
    resizing = true;
    _resizeBaseMinW = parseInt(getComputedStyle(sidebar).minWidth, 10) || scale(250);
    handle.classList.add("active");
    document.body.style.cursor = isMobile() ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleResizeMouseMove);
    window.addEventListener("mouseup", handleResizeMouseUp);
    window.addEventListener("touchmove", handleResizeTouchMove, { passive: true });
    window.addEventListener("touchend", handleResizeTouchEnd);
    window.addEventListener("touchcancel", handleResizeTouchEnd);
  }

  function handleResizeMouseMove(e) {
    _resizePendingX = e.clientX;
    _resizePendingY = e.clientY;
    if (!_resizeRafId) {
      _resizeRafId = requestAnimationFrame(() => {
        _resizeRafId = null;
        doResize(_resizePendingX, _resizePendingY);
      });
    }
  }

  function handleResizeMouseUp() {
    endResize();
  }

  function handleResizeTouchMove(e) {
    if (!resizing) return;
    const t = e.touches[0];
    if (!t) return;
    _resizePendingX = t.clientX;
    _resizePendingY = t.clientY;
    if (!_resizeRafId) {
      _resizeRafId = requestAnimationFrame(() => {
        _resizeRafId = null;
        doResize(_resizePendingX, _resizePendingY);
      });
    }
  }

  function handleResizeTouchEnd() {
    endResize();
  }

  function doResize(clientX, clientY) {
    if (!resizing) return;
    if (isMobile()) {
      const h = Math.max(scale(100), Math.min(window.innerHeight * 0.7, clientY));
      sidebar.style.height = `${h}px`;
      sidebar.style.maxHeight = `${h}px`;
    } else {
      const cssMinW = _resizeBaseMinW;
      const padFull = scale(12);
      const DEAD = Math.round(scale(100));
      const SHRINK = Math.round(scale(40));
      const w = Math.min(scale(500), clientX);

      if (w >= cssMinW) {
        // Normal zone: sidebar follows cursor, full padding, CSS min-width restored.
        sidebar.style.width = `${w}px`;
        sidebar.style.paddingLeft = sidebar.style.paddingRight = `${padFull}px`;
        sidebar.style.minWidth = "";
      } else if (w >= cssMinW - DEAD) {
        // Dead zone: absorb drag without visual change.
        sidebar.style.width = `${cssMinW}px`;
        sidebar.style.paddingLeft = sidebar.style.paddingRight = `${padFull}px`;
        sidebar.style.minWidth = "";
      } else {
        // Shrink zone (and hard stop beyond it).
        const shrinkW = w + DEAD;
        const activationW = cssMinW;
        const t = Math.min(1, Math.max(0, (activationW - shrinkW) / SHRINK));
        const actualW = Math.max(activationW - SHRINK, shrinkW);
        sidebar.style.width = `${actualW}px`;
        sidebar.style.paddingLeft = sidebar.style.paddingRight = `${Math.round(padFull * (1 - t))}px`;
        sidebar.style.minWidth = "0";
      }
    }
    scheduleChartResize();
  }

  function endResize() {
    if (!resizing) return;
    resizing = false;
    if (_resizeRafId) { cancelAnimationFrame(_resizeRafId); _resizeRafId = null; }
    handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleResizeMouseMove);
    window.removeEventListener("mouseup", handleResizeMouseUp);
    window.removeEventListener("touchmove", handleResizeTouchMove);
    window.removeEventListener("touchend", handleResizeTouchEnd);
    window.removeEventListener("touchcancel", handleResizeTouchEnd);
    scheduleChartResize();
  }

  handle.addEventListener("mousedown", startResize);

  // passive:false required for preventDefault() in startResize
  handle.addEventListener("touchstart", (e) => {
    startResize(e);
  }, { passive: false });

  const tabletBp = 800;
  function isTablet() { return !isMobile() && window.innerWidth <= tabletBp; }

  let wasMobile = isMobile();
  let wasTablet = isTablet();
  let wasPortrait = window.innerHeight > window.innerWidth;
  window.addEventListener("resize", () => {
    const mobile = isMobile();
    const tablet = isTablet();
    const portrait = window.innerHeight > window.innerWidth;
    if (mobile !== wasMobile || tablet !== wasTablet) {
      sidebar.style.height = "";
      sidebar.style.maxHeight = "";
      sidebar.style.width = "";
      sidebar.style.paddingLeft = "";
      sidebar.style.paddingRight = "";
      sidebar.style.minWidth = "";
      wasMobile = mobile;
      wasTablet = tablet;
    } else if (mobile && portrait !== wasPortrait && !portrait) {
      sidebar.style.height = "";
      sidebar.style.maxHeight = "";
    }
    wasPortrait = portrait;
    showMobileUI();
    scheduleChartResize();
  });

  // ── Throttling / debounced render ──

  let renderRafId = null;

  function renderDebounced() {
    if (renderRafId) return;
    renderRafId = requestAnimationFrame(() => {
      renderRafId = null;
      render();
    });
  }

  // ── Color background plugin ──

  let brightnessAlphaEnabled = false;

  const colorBgPlugin = {
    id: "colorBackground",
    beforeDraw(ch) {
      const colorHexCache = ch.colorHexCache;
      if (!colorHexCache || !colorHexCache.length) return;
      const { ctx, chartArea } = ch;
      if (!chartArea) return;

      const { left, right, top, bottom } = chartArea;
      const areaW = Math.round(right - left);
      const areaH = bottom - top;
      const count = colorHexCache.length;
      const startX = Math.round(left);
      const brightnessData = brightnessAlphaEnabled
        ? (ch.data.datasets[0]?.data) || []
        : [];
      const bLen = brightnessData.length;

      // When brightness-alpha is on, adjacent stripes have different alpha so the 1px overlap creates visible vertical lines. Use 1px stripes instead.
      // When alpha is uniform (off), 2px with 1px overlap hides HiDPI sub-pixel seams.
      const stripeW = bLen ? 5 : 2;

      ctx.save();
      for (let px = 0; px < areaW; px++) {
        const idx = Math.floor((px / areaW) * count);
        if (bLen) {
          const bIdx = Math.floor((px / areaW) * bLen);
          ctx.globalAlpha = (brightnessData[Math.min(bIdx, bLen - 1)] || 0) / 100;
        }
        ctx.fillStyle = colorHexCache[Math.min(idx, count - 1)];
        ctx.fillRect(startX + px, top, stripeW, areaH);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
  };

  // ── Overlay toggle (grid + now line) ──

  let overlayVisible = true;
  const overlayToggle = $("overlayToggle");
  const overlayIconShow = $("overlayIconShow");
  const overlayIconHide = $("overlayIconHide");
  overlayIconHide.style.display = "none";

  overlayToggle.addEventListener("click", () => {
    overlayVisible = !overlayVisible;
    overlayIconShow.style.display = overlayVisible ? "block" : "none";
    overlayIconHide.style.display = overlayVisible ? "none" : "block";
    if (typeof chart !== "undefined") {
      chart.overlayVisible = overlayVisible;
      chart.update();
    }
  });

  // ── Brightness-alpha gradient toggle ──

  const brightnessAlphaToggle = $("brightnessAlphaToggle");
  const brightnessAlphaIconOn = $("brightnessAlphaIconOn");
  const brightnessAlphaIconOff = $("brightnessAlphaIconOff");
  brightnessAlphaIconOn.style.display = "none";
  brightnessAlphaIconOff.style.display = "block";

  brightnessAlphaToggle.addEventListener("click", () => {
    brightnessAlphaEnabled = !brightnessAlphaEnabled;
    brightnessAlphaIconOn.style.display = brightnessAlphaEnabled ? "block" : "none";
    brightnessAlphaIconOff.style.display = brightnessAlphaEnabled ? "none" : "block";
    if (typeof chart !== "undefined") chart.update();
  });

  // ── Now-line plugin ──

  let nowLineColors = null;
  let sunLineData = null;

  const nowLinePlugin = {
    id: "nowLine",
    afterDraw(ch) {
      if (!overlayVisible) return;
      const xScale = ch.scales.x;
      const colors = nowLineColors || getThemeColors();
      const c = ch.ctx;
      const family = getUiFontFamily();
      const fontSize = Math.round(scale(12));
      const baseY = ch.scales.yBrightness.top - scale(7);

      if (sunLineData && sunLineData.enabled) {
        const rootStyle = getComputedStyle(document.documentElement);
        const sunTimes = [
          { timeStr: sunLineData.sunrise, color: rootStyle.getPropertyValue("--sun-rise-color").trim() || "#6aabf5", label: "Sunrise" },
          { timeStr: sunLineData.sunset,  color: rootStyle.getPropertyValue("--sun-set-color").trim()  || "#e8920a", label: "Sunset"  },
        ];
        for (const { timeStr, color, label } of sunTimes) {
          if (!timeStr || timeStr === "None") continue;
          const [h, m] = timeStr.split(":").map(Number);
          const sx = xScale.getPixelForValue(h * 60 + m);
          if (sx < xScale.left || sx > xScale.right) continue;
          c.save();
          const lw = scale(1.5);
          c.setLineDash([scale(6), scale(4)]);
          c.beginPath();
          c.moveTo(sx, ch.scales.yBrightness.top);
          c.lineTo(sx, ch.scales.yBrightness.bottom);
          c.strokeStyle = color;
          c.lineWidth = lw;
          c.stroke();
          c.font = `${fontSize}px ${family}`;
          c.textAlign = "center";
          const halfW = c.measureText(label).width / 2;
          const textX = Math.max(xScale.left + halfW, Math.min(xScale.right - halfW, sx));
          c.setLineDash([]);
          c.fillStyle = color;
          c.fillText(label, textX, baseY);
          c.restore();
        }
        return;
      }

      const now = new Date();
      const minuteOfDay = now.getHours() * 60 + now.getMinutes();
      const x = xScale.getPixelForValue(minuteOfDay);
      if (x < xScale.left || x > xScale.right) return;

      c.save();
      c.beginPath();
      c.moveTo(x, ch.scales.yBrightness.top);
      c.lineTo(x, ch.scales.yBrightness.bottom);
      c.strokeStyle = colors.nowLine;
      c.lineWidth = scale(1.5);
      c.setLineDash([scale(6), scale(4)]);
      c.stroke();

      c.fillStyle = colors.nowText;
      c.textAlign = "center";

      // Format time label for 12h/24h
      const hh = now.getHours();
      const mm = now.getMinutes();
      let timeLbl;
      if (localStorage.getItem("clockFormat") === "12") {
        const suffix = hh >= 12 ? " PM" : " AM";
        timeLbl = `${hh % 12 || 12}:${String(mm).padStart(2, "0")}${suffix}`;
      } else {
        timeLbl = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      }

      // Single-line label, clamped horizontally to stay within chart bounds
      if (localStorage.getItem("clockFormat") === "12") {
        const spaceIdx = timeLbl.lastIndexOf(" ");
        const timePart = spaceIdx > 0 ? timeLbl.slice(0, spaceIdx) : timeLbl;
        const ampmPart = spaceIdx > 0 ? timeLbl.slice(spaceIdx) : "";
        const baseText = `Now ${timePart}`;
        const ampmFontSize = Math.round(fontSize * 0.75);
        c.font = `${fontSize}px ${family}`;
        const baseW = c.measureText(baseText).width;
        c.font = `${ampmFontSize}px ${family}`;
        const ampmW = c.measureText(ampmPart).width;
        const totalW = baseW + ampmW;
        const halfW = totalW / 2;
        const textX = Math.max(xScale.left + halfW, Math.min(xScale.right - halfW, x));
        c.textAlign = "left";
        c.font = `${fontSize}px ${family}`;
        c.fillText(baseText, textX - halfW, baseY);
        c.font = `${ampmFontSize}px ${family}`;
        c.fillText(ampmPart, textX - halfW + baseW, baseY);
      } else {
        const text = `Now ${timeLbl}`;
        c.font = `${fontSize}px ${family}`;
        const halfW = c.measureText(text).width / 2;
        const textX = Math.max(xScale.left + halfW, Math.min(xScale.right - halfW, x));
        c.fillText(text, textX, baseY);
      }
      c.restore();
    },
  };

  Chart.register(colorBgPlugin, nowLinePlugin);

  // ── Chart ──

  const IDEAL_ASPECT = 2.5;
  const MIN_ASPECT = 1.0;
  const MAX_ASPECT = 3.0;

  const initColors = getThemeColors();
  const ctx = $("curveChart").getContext("2d");

  const chart = new Chart(ctx, {
    data: {
      labels: [],
      datasets: [
        {
          label: "Brightness (%)",
          data: [],
          borderColor: initColors.line,
          backgroundColor: initColors.fill,
          borderWidth: scale(2),
        },
      ],
    },
    options: {
      maintainAspectRatio: true,
      aspectRatio: IDEAL_ASPECT,
      scales: {
        x: {
          ticks: {
            color: initColors.tick,
            font: { size: scale(12), family: getUiFontFamily() },
          },
          grid: {},
        },
        yBrightness: {
          title: {
            text: "Brightness %",
            color: initColors.tick,
            font: { size: scale(13), family: getUiFontFamily(), weight: "400" },
            padding: 0,
          },
          ticks: {
            color: initColors.tick,
            font: { size: scale(12), family: getUiFontFamily() },
          },
          grid: {},
        },
      },
    },
  });

  chart.overlayVisible = overlayVisible;

  $("themeToggle").addEventListener("click", () => {
    const current = getEffectiveTheme();
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    applyThemeIcons();
    updateChartTheme();
  });

  // ── 12h/24h clock toggle ──

  const clockToggle = $("clockToggle");
  const clockLabel = $("clockLabel");

  function updateClockLabel() {
    clockLabel.textContent = localStorage.getItem("clockFormat") === "12" ? "12-hour clock" : "24-hour clock";
  }
  if (localStorage.getItem("clockFormat") === null) {
    const use12h = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
    localStorage.setItem("clockFormat", use12h ? "12" : "24");
    for (const tp of timePickers) tp.refresh();
  }
  updateClockLabel();

  clockToggle.addEventListener("click", () => {
    const current = localStorage.getItem("clockFormat");
    localStorage.setItem("clockFormat", current === "12" ? "24" : "12");
    updateClockLabel();
    for (const tp of timePickers) tp.refresh();
    if (chart._hoverTooltipEl && chart._hoverTooltipEl.parentNode) {
      chart._hoverTooltipEl.parentNode.removeChild(chart._hoverTooltipEl);
    }
    chart._hoverTooltipEl = null;
    chart.draw();
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!localStorage.getItem("theme")) {
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      applyThemeIcons();
      updateChartTheme();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chart._markerLocked) {
      chart._markerLocked = false;
      if (chart._hoverTooltipEl) chart._hoverTooltipEl.style.pointerEvents = "";
      chart._hideTooltip();
    }
  });

  // ── Dynamic aspect ratio ──

  const chartArea = $("chart-area");
  const ro = new ResizeObserver(() => {
    scheduleChartResize();
  });
  ro.observe(chartArea);

  const nowRefreshTimer = window.setInterval(() => {
    chart.update();
  }, 60000);
  window.addEventListener("beforeunload", () => window.clearInterval(nowRefreshTimer));

  function updateChartTheme() {
    const c = getThemeColors();
    nowLineColors = c;
    chart.data.datasets[0].borderColor = c.line;
    chart.data.datasets[0].backgroundColor = c.fill;
    chart.options.scales.x.ticks.color = c.tick;
    chart.options.scales.yBrightness.title.color = c.tick;
    chart.options.scales.yBrightness.ticks.color = c.tick;
    chart.update();
  }

  // ── Enforce full-brightness on color pickers ──

  function enforceColorPickers() {
    els.rgbStartColor.value = enforceFullBrightness(els.rgbStartColor.value);
    els.rgbEndColor.value = enforceFullBrightness(els.rgbEndColor.value);
  }

  function resetRgbColor(input, fallback) {
    input.value = enforceFullBrightness(fallback);
    render();
  }

  els.rgbStartColorReset.addEventListener("click", () => {
    resetRgbColor(els.rgbStartColor, els.rgbStartColor.defaultValue);
  });

  els.rgbEndColorReset.addEventListener("click", () => {
    resetRgbColor(els.rgbEndColor, els.rgbEndColor.defaultValue);
  });

  // ── Export / Import ──

  function hexToRgbArray(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function rgbArrayToHex(arr) {
    return "#" + arr.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }

  function timeToHA(hhmm) { return hhmm + ":00"; }
  function timeFromHA(val) { return String(val).slice(0, 5); }

  function arraysEqual(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  // [HA key, JS element id, type, default (omitted from export if unchanged)]
  const FIELD_MAP = [
    ["curve_type",            "curveType",       "str",    "linear"],
    ["min_brightness",        "minBrightness",   "int",    10],
    ["max_brightness",        "maxBrightness",   "int",    100],
    ["wake_start_time",       "wakeStart",       "time",   "07:00:00"],
    ["wake_end_time",         "wakeEnd",         "time",   "09:00:00"],
    ["doze_start_time",       "dozeStart",       "time",   "20:00:00"],
    ["doze_end_time",         "dozeEnd",         "time",   "22:00:00"],
    ["min_color_temp",        "minColorTemp",    "int",    2700],
    ["max_color_temp",        "maxColorTemp",    "int",    5500],
    ["sync_curves",           "syncCurves",      "bool",   true],
    ["color_wake_start_time", "colorWakeStart",  "time",   "None"],
    ["color_wake_end_time",   "colorWakeEnd",    "time",   "None"],
    ["color_doze_start_time", "colorDozeStart",  "time",   "None"],
    ["color_doze_end_time",   "colorDozeEnd",    "time",   "None"],
    ["sun_shift",             "sunShiftEnabled",  "bool",  false],
    ["sun_shift_strength",    "sunShiftStrength","sunFloat", 0.5],
    ["lux_strength",          "luxStrength",     "luxFloat", 0.5],
    ["use_rgb_color",         "useRgbColor",     "bool",   false],
    ["rgb_start_color",       "rgbStartColor",   "rgb",    [255, 128, 0]],
    ["rgb_end_color",         "rgbEndColor",     "rgb",    [189, 223, 255]],
  ];

  function readHAValue(jsKey, kind, params) {
    const v = params[jsKey];
    if (kind === "time") return timeToHA(v);
    if (kind === "int") return Math.round(v);
    if (kind === "sunFloat" || kind === "luxFloat") return v;
    if (kind === "bool") return v;
    if (kind === "rgb") return hexToRgbArray(v);
    return v;
  }

  function valuesEqual(a, b, kind) {
    if (kind === "rgb") return arraysEqual(a, b);
    return a === b;
  }

  const COLOR_TIME_KEYS = new Set([
    "color_wake_start_time", "color_wake_end_time",
    "color_doze_start_time", "color_doze_end_time",
  ]);

  function buildExportJson(params) {
    const p = params || readParams();
    const obj = {};
    for (const [haKey, jsKey, kind, def] of FIELD_MAP) {
      if (p.syncCurves && COLOR_TIME_KEYS.has(haKey)) continue;
      const val = readHAValue(jsKey, kind, p);
      if (!valuesEqual(val, def, kind)) obj[haKey] = val;
    }
    const raw = JSON.stringify(obj, null, 2);
    return raw.replace(/\[\s+([\d,\s]+?)\s+\]/g, (_, inner) => {
      return "[" + inner.replace(/\s+/g, " ") + "]";
    });
  }

  function updateExportBox(params) {
    if (!els.exportImportEnabled.checked) return;
    if (document.activeElement === els.exportImportBox) return;
    els.exportImportBox.value = buildExportJson(params);
  }

  function applyImport(text) {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    let obj;
    try { obj = JSON.parse(trimmed); } catch (_) { return -1; }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return -1;
    const lookup = new Map(FIELD_MAP.map(([ha, js, kind]) => [ha, { js, kind }]));
    let applied = 0;
    for (const [key, val] of Object.entries(obj)) {
      const entry = lookup.get(key);
      if (!entry) continue;
      const el = els[entry.js];
      if (!el) continue;
      if (entry.kind === "time") {
        if (typeof val !== "string" || val === "None") continue;
        el.value = timeFromHA(val);
        el.dataset.lastValidValue = el.value;
      } else if (val === null) {
        if (entry.kind === "bool") el.checked = el.defaultChecked;
        else el.value = el.defaultValue;
      } else if (entry.kind === "bool") {
        el.checked = !!val;
      } else if (entry.kind === "rgb") {
        if (Array.isArray(val) && val.length >= 3) el.value = enforceFullBrightness(rgbArrayToHex(val));
        else continue;
      } else if (entry.kind === "sunFloat") {
        const n = Number(val);
        if (Number.isFinite(n)) el.value = Math.round(n * 20);
        else continue;
      } else if (entry.kind === "luxFloat") {
        const n = Number(val);
        if (Number.isFinite(n)) el.value = Math.round(n * 20);
        else continue;
      } else if (entry.kind === "int") {
        const n = Number(val);
        if (Number.isFinite(n)) el.value = n;
        else continue;
      } else if (entry.kind === "str") {
        el.value = String(val);
      }
      applied++;
    }
    if (applied > 0) {
      sliderPairs.forEach(({ slider, num, fmt }) => {
        const s = $(slider), n = $(num);
        n.value = fmt ? fmt.toDisplay(+s.value) : s.value;
        updateSliderProgress(s);
      });
      refreshTimePickers();
      render();
    }
    return applied;
  }

  els.exportImportEnabled.addEventListener("change", () => {
    if (els.exportImportEnabled.checked) updateExportBox();
  });

  function flashImportBtn(text) {
    els.importBtn.disabled = true;
    els.importBtn.textContent = text;
    setTimeout(() => {
      els.importBtn.textContent = "Import";
      els.importBtn.disabled = false;
    }, 3000);
  }

  els.importBtn.addEventListener("click", () => {
    if (els.importBtn.disabled) return;
    const count = applyImport(els.exportImportBox.value);
    if (count > 0) {
      flashImportBtn(`Imported ${count} setting${count > 1 ? "s" : ""}`);
      updateExportBox();
    } else if (count === -1) {
      flashImportBtn("Invalid JSON");
    } else {
      flashImportBtn("Nothing to import");
    }
  });

  // ── Render ──

  function render() {
    const params = readParams();
    updateVisibility(params);
    sunLineData = { enabled: params.sunShiftEnabled, sunrise: params.sunrise, sunset: params.sunset };

    const data = generateCurveData(params);

    chart.colorHexCache = data.colorHex;

    chart.data.labels = data.labels;
    chart.data.datasets[0].data = data.brightness;
    chart.update();
  }

  const sidebarEl = $("sidebar");
  sidebarEl.addEventListener("input", (e) => {
    if (e.target === els.exportImportBox) return;
    if (e.target.type === "range") {
      updateSliderProgress(e.target);
      renderDebounced();
    } else if (e.target.type === "color") {
      renderDebounced();
    } else {
      render();
    }
  });
  sidebarEl.addEventListener("change", (e) => {
    if (e.target === els.exportImportBox) return;
    if (e.target.type === "color") enforceColorPickers();
    render();
  });

  showMobileUI();
  render();
  requestAnimationFrame(() => {
    $("chartCanvasShell").classList.add("chart-ready");
  });
})();
