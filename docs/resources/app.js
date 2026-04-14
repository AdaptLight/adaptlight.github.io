(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  // ── Theme management ──

  function getEffectiveTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit) return explicit;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function applyThemeIcons() {
    const theme = getEffectiveTheme();
    $("themeIconSun").style.display = theme === "dark" ? "block" : "none";
    $("themeIconMoon").style.display = theme === "light" ? "block" : "none";
  }

  function getThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      tick: s.getPropertyValue("--chart-tick").trim(),
      grid: s.getPropertyValue("--chart-grid").trim(),
      line: s.getPropertyValue("--chart-line").trim(),
      fill: s.getPropertyValue("--chart-fill").trim(),
      tooltipBg: s.getPropertyValue("--tooltip-bg").trim(),
      text: s.getPropertyValue("--text").trim(),
      nowLine: s.getPropertyValue("--now-line").trim(),
      nowText: s.getPropertyValue("--now-text").trim(),
      bg: s.getPropertyValue("--bg").trim(),
    };
  }

  $("themeToggle").addEventListener("click", () => {
    const current = getEffectiveTheme();
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    applyThemeIcons();
    updateChartTheme();
  });

  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!localStorage.getItem("theme")) {
      applyThemeIcons();
      updateChartTheme();
    }
  });

  applyThemeIcons();

  // ── Sidebar hide/show ──

  $("sidebarHide").addEventListener("click", () => {
    document.body.classList.add("sidebar-hidden");
    setTimeout(() => chart.resize(), 0);
  });

  $("sidebarShow").addEventListener("click", () => {
    document.body.classList.remove("sidebar-hidden");
    setTimeout(() => chart.resize(), 0);
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
    if (fmt) {
      n.value = fmt.toDisplay(+s.value);
      n.step = "any";
      s.addEventListener("input", () => { n.value = fmt.toDisplay(+s.value); });
      n.addEventListener("change", () => {
        s.value = fmt.toSlider(+n.value);
        n.value = fmt.toDisplay(+s.value);
      });
    } else {
      s.addEventListener("input", () => { n.value = s.value; });
      n.addEventListener("input", () => {
        const v = clamp(+n.value, +s.min, +s.max);
        s.value = v;
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
  };

  function readParams() {
    return {
      curveType: els.curveType.value,
      minBrightness: +els.minBrightness.value,
      maxBrightness: +els.maxBrightness.value,
      wakeStart: els.wakeStart.value,
      wakeEnd: els.wakeEnd.value,
      dozeStart: els.dozeStart.value,
      dozeEnd: els.dozeEnd.value,
      minColorTemp: +els.minColorTemp.value,
      maxColorTemp: +els.maxColorTemp.value,
      syncCurves: els.syncCurves.checked,
      colorWakeStart: els.colorWakeStart.value,
      colorWakeEnd: els.colorWakeEnd.value,
      colorDozeStart: els.colorDozeStart.value,
      colorDozeEnd: els.colorDozeEnd.value,
      sunShiftEnabled: els.sunShiftEnabled.checked,
      sunShiftStrength: +els.sunShiftStrength.value / 10,
      sunrise: els.sunrise.value,
      sunset: els.sunset.value,
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
    return window.innerWidth <= 768;
  }

  function startResize(e) {
    e.preventDefault();
    resizing = true;
    handle.classList.add("active");
    document.body.style.cursor = isMobile() ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  }

  function doResize(clientX, clientY) {
    if (!resizing) return;
    if (isMobile()) {
      const h = Math.max(100, Math.min(window.innerHeight * 0.7, clientY));
      sidebar.style.height = h + "px";
      sidebar.style.maxHeight = h + "px";
    } else {
      const w = Math.max(200, Math.min(500, clientX));
      sidebar.style.width = w + "px";
    }
  }

  function endResize() {
    if (!resizing) return;
    resizing = false;
    handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    chart.resize();
  }

  handle.addEventListener("mousedown", startResize);
  window.addEventListener("mousemove", (e) => doResize(e.clientX, e.clientY));
  window.addEventListener("mouseup", endResize);

  handle.addEventListener("touchstart", (e) => {
    startResize(e);
  }, { passive: false });
  window.addEventListener("touchmove", (e) => {
    if (!resizing) return;
    const t = e.touches[0];
    doResize(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener("touchend", endResize);

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
        ctx.fillRect(startX + px, top, 2, areaH);
      }
      ctx.restore();
    },
  };

  // ── Now-line plugin ──

  const nowLinePlugin = {
    id: "nowLine",
    afterDraw(ch) {
      const now = new Date();
      const minuteOfDay = now.getHours() * 60 + now.getMinutes();
      const xScale = ch.scales.x;
      const x = xScale.getPixelForValue(minuteOfDay);
      if (x < xScale.left || x > xScale.right) return;

      const colors = getThemeColors();
      const c = ch.ctx;
      c.save();
      c.beginPath();
      c.moveTo(x, ch.scales.yBrightness.top);
      c.lineTo(x, ch.scales.yBrightness.bottom);
      c.strokeStyle = colors.nowLine;
      c.lineWidth = 1.5;
      c.setLineDash([6, 4]);
      c.stroke();

      c.fillStyle = colors.nowText;
      c.font = "10px sans-serif";
      c.textAlign = "center";
      const lbl = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      c.fillText("Now " + lbl, x, ch.scales.yBrightness.top - 5);
      c.restore();
    },
  };

  Chart.register(colorBgPlugin, nowLinePlugin);

  // ── Chart ──

  const IDEAL_ASPECT = 2.4;
  const MIN_ASPECT = 1.5;
  const MAX_ASPECT = 3.5;

  const initColors = getThemeColors();
  const ctx = $("curveChart").getContext("2d");

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Brightness (%)",
          data: [],
          borderColor: initColors.line,
          backgroundColor: initColors.fill,
          fill: true,
          tension: 0.1,
          pointRadius: 0,
          borderWidth: 2,
          yAxisID: "yBrightness",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: IDEAL_ASPECT,
      animation: { duration: 0 },
      interaction: { mode: "index", intersect: false },
      layout: {
        padding: { left: 1, right: 16, top: 32, bottom: 12 },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: initColors.tooltipBg,
          titleColor: initColors.text,
          bodyColor: initColors.text,
          borderColor: "transparent",
          borderWidth: 0,
          padding: 8,
          displayColors: false,
          callbacks: {
            label: function (c) {
              return "Brightness: " + c.parsed.y.toFixed(1) + "%";
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: initColors.tick,
            autoSkip: false,
            font: { size: 10 },
            padding: 4,
            maxRotation: 45,
            minRotation: 45,
            callback: function (val, index) {
              if (index % 60 !== 0) return null;
              const hour = index / 60;
              const step = this.chart.width < 500 ? 2 : 1;
              if (hour % step !== 0) return null;
              return this.getLabelForValue(val);
            },
          },
          grid: { color: initColors.grid },
          border: { display: false },
        },
        yBrightness: {
          type: "linear",
          position: "left",
          min: 0,
          max: 100,
          title: {
            display: true,
            text: "Brightness %",
            color: initColors.tick,
            font: { size: 11 },
            padding: 4,
          },
          ticks: {
            color: initColors.tick,
            font: { size: 10 },
            padding: 4,
            stepSize: 10,
            autoSkip: false,
          },
          grid: {
            color: initColors.grid,
          },
          border: { display: false },
        },
      },
    },
  });

  // ── Dynamic aspect ratio: clamp between MIN and MAX to balance squareness with fill ──

  const chartArea = $("chart-area");
  let roTimer = null;
  const ro = new ResizeObserver(() => {
    if (resizing) return;
    if (roTimer) return;
    roTimer = requestAnimationFrame(() => {
      roTimer = null;
      const w = chartArea.clientWidth;
      const h = chartArea.clientHeight;
      if (w <= 0 || h <= 0) return;
      const containerRatio = w / h;
      const target = Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, containerRatio));
      chart.options.aspectRatio = target;
      chart.resize();
    });
  });
  ro.observe(chartArea);

  function updateChartTheme() {
    const c = getThemeColors();
    chart.data.datasets[0].borderColor = c.line;
    chart.data.datasets[0].backgroundColor = c.fill;
    chart.options.plugins.tooltip.backgroundColor = c.tooltipBg;
    chart.options.plugins.tooltip.titleColor = c.text;
    chart.options.plugins.tooltip.bodyColor = c.text;
    chart.options.scales.x.ticks.color = c.tick;
    chart.options.scales.x.grid.color = c.grid;
    chart.options.scales.yBrightness.title.color = c.tick;
    chart.options.scales.yBrightness.ticks.color = c.tick;
    chart.options.scales.yBrightness.grid.color = c.grid;
    chart.update();
  }

  // ── Render ──

  function render() {
    updateVisibility();

    const params = readParams();
    const data = generateCurveData(params);

    colorHexCache = data.colorHex;

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
  sidebarEl.addEventListener("change", render);

  render();
})();
