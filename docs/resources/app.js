(() => {

  const $ = id => document.getElementById(id);

  function getUiScale() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  const UI_SCALE = getUiScale();
  const scale = (value) => value * UI_SCALE;
  document.documentElement.style.setProperty("--ui-scale", String(UI_SCALE));

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
    themeIconSun.style.display = theme === "dark" ? "block" : "none";
    themeIconMoon.style.display = theme === "light" ? "block" : "none";
  }

  function getThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      tick: s.getPropertyValue("--chart-tick").trim(),
      grid: s.getPropertyValue("--chart-grid").trim(),
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

  const sunShiftDisplay = { toDisplay: v => (v / 10).toFixed(1), toSlider: v => Math.round(v * 10) };
  const luxStrDisplay   = { toDisplay: v => (v / 20).toFixed(2), toSlider: v => Math.round(v * 20) };

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
    };

    syncNumberFromSlider();

    if (fmt) {
      n.step = "any";
      s.addEventListener("input", syncNumberFromSlider);
      n.addEventListener("input", () => {
        if (n.value === "") return;
        const raw = +n.value;
        if (!Number.isFinite(raw)) return;
        s.value = clamp(fmt.toSlider(raw), +s.min, +s.max);
        n.value = fmt.toDisplay(+s.value);
      });
      n.addEventListener("blur", () => {
        if (n.value === "") {
          s.value = +s.defaultValue;
        } else {
          const raw = +n.value;
          if (Number.isFinite(raw)) {
            s.value = clamp(fmt.toSlider(raw), +s.min, +s.max);
          } else {
            s.value = +s.defaultValue;
          }
        }
        n.value = fmt.toDisplay(+s.value);
      });
    } else {
      s.addEventListener("input", syncNumberFromSlider);
      n.addEventListener("input", () => {
        if (n.value === "") return;
        const raw = +n.value;
        if (!Number.isFinite(raw)) return;
        const v = clamp(raw, +s.min, +s.max);
        s.value = v;
        n.value = String(v);
      });
      n.addEventListener("blur", () => {
        if (n.value === "") {
          s.value = +s.defaultValue;
        } else {
          const raw = +n.value;
          if (Number.isFinite(raw)) {
            s.value = clamp(raw, +s.min, +s.max);
          } else {
            s.value = +s.defaultValue;
          }
        }
        n.value = String(s.value);
      });
    }
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
      sunShiftStrength: +els.sunShiftStrength.value / 10,
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

  function updateVisibility() {
    els.colorTimingSection.style.display = els.syncCurves.checked ? "none" : "";
    els.sunShiftControls.style.display = els.sunShiftEnabled.checked ? "" : "none";
    els.luxControls.style.display = els.luxEnabled.checked ? "" : "none";
    els.rgbControls.style.display = els.useRgbColor.checked ? "" : "none";
  }

  // ── Resizable sidebar ──

  const sidebar = $("sidebar");
  const handle = $("resize-handle");
  let resizing = false;

  function isMobile() {
    return window.innerWidth < 768;
  }

  function startResize(e) {
    if (resizing) return;
    e.preventDefault();
    resizing = true;
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
    doResize(e.clientX, e.clientY);
  }

  function handleResizeMouseUp() {
    endResize();
  }

  function handleResizeTouchMove(e) {
    if (!resizing) return;
    const t = e.touches[0];
    if (!t) return;
    doResize(t.clientX, t.clientY);
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
      const w = Math.max(scale(200), Math.min(scale(500), clientX));
      sidebar.style.width = `${w}px`;
    }
    scheduleChartResize();
  }

  function endResize() {
    if (!resizing) return;
    resizing = false;
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

  handle.addEventListener("touchstart", (e) => {
    startResize(e);
  }, { passive: false });

  // Clear stale inline styles when crossing the mobile/desktop breakpoint
  let wasMobile = isMobile();
  window.addEventListener("resize", () => {
    const mobile = isMobile();
    if (mobile !== wasMobile) {
      sidebar.style.height = "";
      sidebar.style.maxHeight = "";
      sidebar.style.width = "";
      wasMobile = mobile;
    }
    scheduleChartResize();
  });

  // ── Debounced render for color inputs ──

  let colorDebounceTimer = null;

  function renderDebounced() {
    if (colorDebounceTimer) clearTimeout(colorDebounceTimer);
    colorDebounceTimer = setTimeout(render, 150);
  }

  // ── Color background plugin ──
  // Fully opaque gradient behind chart content. Identical in both themes.

  let colorHexCache = [];

  const colorBgPlugin = {
    id: "colorBackground",
    beforeDraw(ch) {
      if (!colorHexCache.length) return;
      const { ctx, chartArea } = ch;
      if (!chartArea) return;

      const { left, right, top, bottom } = chartArea;
      const areaW = Math.round(right - left);
      const areaH = bottom - top;
      const count = colorHexCache.length;
      const startX = Math.round(left);

      ctx.save();
      for (let px = 0; px < areaW; px++) {
        const idx = Math.floor((px / areaW) * count);
        ctx.fillStyle = colorHexCache[Math.min(idx, count - 1)];
        // DO NOT CHANGE: stripe width MUST stay at 2, not 1.
        // The 1px overlap hides sub-pixel seams between adjacent colors on
        // HiDPI/fractional-scale displays. Using width=1 looks mathematically
        // cleaner but produces visible vertical artifact lines across the
        // gradient. This has been "fixed" and reverted multiple times.
        ctx.fillRect(startX + px, top, 2, areaH);
      }
      ctx.restore();
    },
  };

  // ── Now-line plugin ──

  let nowLineColors = null;

  const nowLinePlugin = {
    id: "nowLine",
    afterDraw(ch) {
      const now = new Date();
      const minuteOfDay = now.getHours() * 60 + now.getMinutes();
      const xScale = ch.scales.x;
      const x = xScale.getPixelForValue(minuteOfDay);
      if (x < xScale.left || x > xScale.right) return;

      const colors = nowLineColors || getThemeColors();
      const c = ch.ctx;
      c.save();
      c.beginPath();
      c.moveTo(x, ch.scales.yBrightness.top);
      c.lineTo(x, ch.scales.yBrightness.bottom);
      c.strokeStyle = colors.nowLine;
      c.lineWidth = scale(1.5);
      c.setLineDash([scale(6), scale(4)]);
      c.stroke();

      c.fillStyle = colors.nowText;
      c.font = `${scale(12)}px ${getUiFontFamily()}`;
      c.textAlign = "center";
      const lbl = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const fullLabel = `Now ${lbl}`;
      const shortLabel = "Now";
      const labelPad = scale(8);
      const fullWidth = c.measureText(fullLabel).width;
      const fitsFullLabel =
        x - fullWidth / 2 >= xScale.left + labelPad &&
        x + fullWidth / 2 <= xScale.right - labelPad;
      c.fillText(fitsFullLabel ? fullLabel : shortLabel, x, ch.scales.yBrightness.top - scale(5));
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
          grid: { color: initColors.grid },
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
          grid: {
            color: initColors.grid,
          },
        },
      },
    },
  });

  $("themeToggle").addEventListener("click", () => {
    const current = getEffectiveTheme();
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    applyThemeIcons();
    updateChartTheme();
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!localStorage.getItem("theme")) {
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      applyThemeIcons();
      updateChartTheme();
    }
  });

  // ── Dynamic aspect ratio: clamp between MIN and MAX to balance squareness with fill ──

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
    chart.options.scales.x.grid.color = c.grid;
    chart.options.scales.yBrightness.title.color = c.tick;
    chart.options.scales.yBrightness.ticks.color = c.tick;
    chart.options.scales.yBrightness.grid.color = c.grid;
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

  // ── Render ──

  function render() {
    updateVisibility();

    const params = readParams();
    const data = generateCurveData(params);

    colorHexCache = data.colorHex;
    chart.colorHexCache = data.colorHex;

    chart.data.labels = data.labels;
    chart.data.datasets[0].data = data.brightness;
    chart.update();
  }

  const sidebarEl = $("sidebar");
  sidebarEl.addEventListener("input", (e) => {
    if (e.target.type === "color") {
      renderDebounced();
    } else {
      render();
    }
  });
  sidebarEl.addEventListener("change", (e) => {
    if (e.target.type === "color") enforceColorPickers();
    render();
  });

  render();
})();
