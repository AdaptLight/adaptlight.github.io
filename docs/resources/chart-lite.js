// Lightweight Chart.js-compatible canvas renderer. Exposed as window.Chart
(() => {

  const registeredPlugins = [];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function getAppFontFamily() {
    if (!document.body) return "sans-serif";
    return getComputedStyle(document.body).fontFamily || "sans-serif";
  }

  function minuteLabel(minute) {
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }

  function formatTimeLabel(hhmm) {
    if (_clockFormat !== "12") {
      const colon = hhmm.indexOf(":");
      if (colon > 0) return `${parseInt(hhmm.slice(0, colon), 10)}:${hhmm.slice(colon + 1)}`;
      return hhmm;
    }
    const parts = hhmm.split(":");
    if (parts.length < 2) return hhmm;
    let h = parseInt(parts[0], 10);
    const suffix = h >= 12 ? " PM" : " AM";
    h = h % 12 || 12;
    return { time: `${h}:${parts[1]}`, suffix };
  }

  function isCompoundLabel(v) { return v && typeof v === "object" && "time" in v; }

  function fontString(size, weight, family) {
    return `${weight ? `${weight} ` : ""}${size}px ${family || "sans-serif"}`;
  }

  function resolveFontSize(fontOption, fallback) {
    const size = Number(fontOption && fontOption.size);
    return Number.isFinite(size) && size > 0 ? size : fallback;
  }

  function measureTextWidth(ctx, text, font) {
    ctx.save();
    ctx.font = font;
    const width = ctx.measureText(text).width;
    ctx.restore();
    return width;
  }

  function ensurePathArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeHexColor(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return text;
    const match = text.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
    if (!match) return text.startsWith("#") ? text : null;
    const r = clamp(Math.round(Number(match[1])), 0, 255);
    const g = clamp(Math.round(Number(match[2])), 0, 255);
    const b = clamp(Math.round(Number(match[3])), 0, 255);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // Intentional copy of getUiScale — each module reads the CSS var independently so they stay self-contained
  function getUiScale() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function getXAxisTickStepMinutes(chartWidth, uiScale) {
    const w = chartWidth / (uiScale || 1);
    if (w >= 1000) return 30;
    if (w < 220) return 180;
    if (w < 500) return 120;
    return 60;
  }

  function getBrightnessTickStep(chartHeight, uiScale) {
    const h = chartHeight / (uiScale || 1);
    if (h < 180) return 20;
    if (h < 320) return 10;
    return 5;
  }

  let _clockFormat = localStorage.getItem("clockFormat");

  class LiteChart {
    constructor(ctx, config) {
      if (!ctx || !ctx.canvas) {
        throw new Error("LiteChart requires a 2D canvas context.");
      }
      this.ctx = ctx;
      this.canvas = ctx.canvas;
      this.canvas.style.display = "block";
      this.canvas.style.touchAction = "none";
      this._fontFamily = getAppFontFamily();

      this.config = config || {};
      this.data = this.config.data || { labels: [], datasets: [] };
      this.options = this.config.options || {};
      this.options.plugins = this.options.plugins || {};
      this.options.scales = this.options.scales || {};
      this.options.scales.x = this.options.scales.x || {};
      this.options.scales.x.ticks = this.options.scales.x.ticks || {};
      this.options.scales.x.grid = this.options.scales.x.grid || {};
      this.options.scales.yBrightness = this.options.scales.yBrightness || {};
      this.options.scales.yBrightness.title = this.options.scales.yBrightness.title || {};
      this.options.scales.yBrightness.ticks = this.options.scales.yBrightness.ticks || {};
      this.options.scales.yBrightness.grid = this.options.scales.yBrightness.grid || {};

      this.chartArea = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      this.scales = {
        x: this._createXScale(1, this.chartArea),
        yBrightness: this._createYScale(this.chartArea),
      };

      this._dpr = window.devicePixelRatio || 1;
      this._cssWidth = 0;
      this._cssHeight = 0;
      this._tooltipVisible = false;
      this.colorHexCache = [];
      this._uiScale = getUiScale();
      this._cachedCanvasRect = null;
      this._cachedParentRect = null;
      this._hoverBoundsCache = null;
      this._hoverPoint = null;
      this._markerLocked = false;
      this._lockedIndex = null;
      this._holdTimer = null;
      this._holdStartX = 0;
      this._holdStartY = 0;
      this._markerFadeTimer = null;
      this._tooltipFadeTimer = null;
      this._trailCanvas = this._createTrailCanvas();
      this._trailCtx = this._trailCanvas.getContext("2d");
      this._trailPoints = [];
      this._trailRafId = null;
      this._trailTailDist = 0;
      this._lastTrailFrame = 0;
      this._hoverMarkerEl = this._createHoverMarkerElement();
      this._hoverMarkerInner = this._hoverMarkerEl.firstChild || null;
      this._hoverTooltipEl = null;
      this._boundMove = this._handlePointerMove.bind(this);
      this._boundDown = this._handlePointerDown.bind(this);
      this._boundUp = this._handlePointerUp.bind(this);
      this._boundLeave = this._hideTooltip.bind(this);
      this._boundCancel = () => { this._markerLocked = false; clearTimeout(this._holdTimer); this._holdTimer = null; if (this._hoverTooltipEl) this._hoverTooltipEl.style.pointerEvents = ""; this._hideTooltip(); };

      this.canvas.addEventListener("pointermove", this._boundMove);
      this.canvas.addEventListener("pointerdown", this._boundDown);
      this.canvas.addEventListener("pointerup", this._boundUp);
      this.canvas.addEventListener("pointerleave", this._boundLeave);
      this.canvas.addEventListener("pointercancel", this._boundCancel);

      this.resize();
    }

    static register(...plugins) {
      for (const plugin of plugins) {
        if (!plugin || registeredPlugins.indexOf(plugin) !== -1) continue;
        registeredPlugins.push(plugin);
      }
    }

    static setClockFormat(fmt) {
      _clockFormat = fmt;
    }

    destroy() {
      this.canvas.removeEventListener("pointermove", this._boundMove);
      this.canvas.removeEventListener("pointerdown", this._boundDown);
      this.canvas.removeEventListener("pointerup", this._boundUp);
      this.canvas.removeEventListener("pointerleave", this._boundLeave);
      this.canvas.removeEventListener("pointercancel", this._boundCancel);
      clearTimeout(this._holdTimer);
      if (this._trailRafId) { cancelAnimationFrame(this._trailRafId); this._trailRafId = null; }
      if (this._trailCanvas && this._trailCanvas.parentNode) {
        this._trailCanvas.parentNode.removeChild(this._trailCanvas);
      }
      if (this._hoverMarkerEl && this._hoverMarkerEl.parentNode) {
        this._hoverMarkerEl.parentNode.removeChild(this._hoverMarkerEl);
      }
      if (this._hoverTooltipEl && this._hoverTooltipEl.parentNode) {
        this._hoverTooltipEl.parentNode.removeChild(this._hoverTooltipEl);
      }
    }

    resize() {
      this._uiScale = getUiScale();
      this._cachedCanvasRect = null;
      this._cachedParentRect = null;
      const parent = this.canvas.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      let cssWidth = Math.max(1, Math.floor(rect.width));
      let cssHeight = Math.max(1, Math.floor(rect.height));
      const maintainAspectRatio = this.options.maintainAspectRatio !== false;
      const ratioValue = Number(this.options.aspectRatio);
      const ratio = Number.isFinite(ratioValue) && ratioValue > 0 ? ratioValue : (cssWidth / cssHeight || 1);

      if (maintainAspectRatio && cssWidth > 0 && cssHeight > 0 && ratio > 0) {
        const currentRatio = cssWidth / cssHeight;
        if (currentRatio > ratio) {
          cssWidth = Math.max(1, Math.floor(cssHeight * ratio));
        } else {
          cssHeight = Math.max(1, Math.floor(cssWidth / ratio));
        }
      }

      this._cssWidth = cssWidth;
      this._cssHeight = cssHeight;
      this._dpr = window.devicePixelRatio || 1;

      const pixelWidth = Math.max(1, Math.round(cssWidth * this._dpr));
      const pixelHeight = Math.max(1, Math.round(cssHeight * this._dpr));

      if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
      if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
      this.canvas.style.width = `${cssWidth}px`;
      this.canvas.style.height = `${cssHeight}px`;

      this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

      this._clearTrail();
      this._hideTooltip(false);
      this.draw();
      if (this._markerLocked) this._updateLockedMarker();
    }

    update() {
      this._uiScale = getUiScale();
      this.draw();
    }

    draw() {
      if (!this._cssWidth || !this._cssHeight) return;

      const ctx = this.ctx;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      if ("fontKerning" in ctx) ctx.fontKerning = "normal";
      if ("textRendering" in ctx) ctx.textRendering = "geometricPrecision";
      ctx.clearRect(0, 0, this._cssWidth, this._cssHeight);

      const layout = this._layout();
      if (!layout) return;

      this.chartArea = layout.chartArea;
      this._updateHoverBoundsCache();
      this.scales.x = this._createXScale(this._dataCount(), this.chartArea);
      this.scales.yBrightness = this._createYScale(this.chartArea);

      this._callPlugins("beforeDraw");
      this._drawGrid(layout);
      this._drawDataset(layout);
      this._drawAxes(layout);
      this._drawHoverPoint();
      this._callPlugins("afterDraw");
      if (this._markerLocked) this._updateLockedMarker();
    }

    _callPlugins(hook) {
      for (const plugin of registeredPlugins) {
        if (plugin && typeof plugin[hook] === "function") {
          plugin[hook](this);
        }
      }
    }

    _dataCount() {
      const labels = ensurePathArray(this.data && this.data.labels);
      const dataset = this.data && this.data.datasets && this.data.datasets[0];
      const values = ensurePathArray(dataset && dataset.data);
      return Math.max(labels.length, values.length, 1);
    }

    _layout() {
      const uiScale = this._uiScale || getUiScale();
      const xTickFontSize = resolveFontSize(this.options.scales.x.ticks.font, 12);
      const yTickFontSize = resolveFontSize(this.options.scales.yBrightness.ticks.font, xTickFontSize);
      const titleFontSize = resolveFontSize(this.options.scales.yBrightness.title.font, Math.max(xTickFontSize, yTickFontSize));
      const xTickFont = fontString(xTickFontSize, "400", this._fontFamily);
      const yTickFont = fontString(yTickFontSize, "400", this._fontFamily);
      const titleFont = fontString(titleFontSize, "400", this._fontFamily);
      const labels = ensurePathArray(this.data && this.data.labels);
      const dataset = this.data && this.data.datasets && this.data.datasets[0];
      const values = ensurePathArray(dataset && dataset.data);
      const labelSampleRaw = formatTimeLabel(labels.length ? labels[0] : minuteLabel(0));
      const labelSampleText = isCompoundLabel(labelSampleRaw) ? labelSampleRaw.time : labelSampleRaw;
      const titlePadding = Number(this.options.scales.yBrightness.title && this.options.scales.yBrightness.title.padding) || 0;
      const yTickWidth = Math.max(
        measureTextWidth(this.ctx, "0", yTickFont),
        measureTextWidth(this.ctx, "100", yTickFont)
      );
      const left = Math.max(Math.round(47 * uiScale), Math.ceil(yTickWidth + Math.round(10 * uiScale) + titlePadding));
      const right = Math.round(16 * uiScale);
      const top = Math.round(20 * uiScale);
      const bottom = Math.max(Math.round(44 * uiScale), Math.ceil(measureTextWidth(this.ctx, labelSampleText, xTickFont) * 0.62 + Math.round(24 * uiScale)));
      const chartArea = {
        left,
        top,
        right: this._cssWidth - right,
        bottom: this._cssHeight - bottom,
      };
      chartArea.width = Math.max(0, chartArea.right - chartArea.left);
      chartArea.height = Math.max(0, chartArea.bottom - chartArea.top);

      if (chartArea.width <= 0 || chartArea.height <= 0) return null;

      return {
        chartArea,
        labels,
        values,
        xTickFont,
        xTickFontSize,
        yTickFont,
        titleFont,
      };
    }

    _createXScale(count, chartArea) {
      const safeCount = Math.max(1, count);
      const width = Math.max(1, chartArea.width);
      return {
        left: chartArea.left,
        right: chartArea.right,
        top: chartArea.top,
        bottom: chartArea.bottom,
        getPixelForValue: (value) => {
          if (safeCount <= 1) return chartArea.left;
          const ratio = clamp(value, 0, safeCount - 1) / (safeCount - 1);
          return chartArea.left + ratio * width;
        },
      };
    }

    _createYScale(chartArea) {
      return {
        left: chartArea.left,
        right: chartArea.right,
        top: chartArea.top,
        bottom: chartArea.bottom,
      };
    }

    _drawGrid(layout) {
      if (this.overlayVisible === false) return;
      const ctx = this.ctx;
      const chartArea = layout.chartArea;
      const labels = layout.labels;
      const uiScale = this._uiScale || getUiScale();
      const tickStepMinutes = getXAxisTickStepMinutes(chartArea.width, uiScale);
      const xGridBottomExtend = Math.round(13 * uiScale);
      const yGridLeftExtend = Math.round(7 * uiScale);
      const yStep = getBrightnessTickStep(chartArea.height, uiScale);
      const lw = Math.max(1, uiScale);

      const xPositions = [];
      for (let minute = 0; minute <= 24 * 60; minute += tickStepMinutes) {
        const index = Math.min(labels.length - 1, minute);
        xPositions.push(Math.round(this.scales.x.getPixelForValue(index)) + 0.5);
      }
      const yPositions = [];
      for (let value = 0; value <= 100; value += yStep) {
        yPositions.push(Math.round(chartArea.bottom - (value / 100) * chartArea.height) + 0.5);
      }

      // 1a. Gridlines inside chart area: 'difference' blend inverts against the gradient
      ctx.save();
      ctx.globalCompositeOperation = "difference";
      ctx.lineWidth = lw;
      ctx.strokeStyle = "rgba(255,255,255,0.30)";
      for (const crispX of xPositions) {
        ctx.beginPath();
        ctx.moveTo(crispX, chartArea.top);
        ctx.lineTo(crispX, chartArea.bottom);
        ctx.stroke();
      }
      for (const crispY of yPositions) {
        ctx.beginPath();
        ctx.moveTo(chartArea.left, crispY);
        ctx.lineTo(chartArea.right, crispY);
        ctx.stroke();
      }
      ctx.restore();

      // 1b. 'luminosity' pass: fixes saturated blue/purple where 'difference' alone fails
      ctx.save();
      ctx.globalCompositeOperation = "luminosity";
      ctx.lineWidth = lw;
      ctx.strokeStyle = "rgba(179,179,179,0.30)";
      for (const crispX of xPositions) {
        ctx.beginPath();
        ctx.moveTo(crispX, chartArea.top);
        ctx.lineTo(crispX, chartArea.bottom);
        ctx.stroke();
      }
      for (const crispY of yPositions) {
        ctx.beginPath();
        ctx.moveTo(chartArea.left, crispY);
        ctx.lineTo(chartArea.right, crispY);
        ctx.stroke();
      }
      ctx.restore();

      // 2. Tick extensions outside chart area: theme-aware tick color
      const tickColor = (this.options.scales.x.ticks && this.options.scales.x.ticks.color) || "#888";
      ctx.save();
      ctx.lineWidth = lw;
      ctx.strokeStyle = tickColor;
      ctx.globalAlpha = 0.40;
      for (const crispX of xPositions) {
        ctx.beginPath();
        ctx.moveTo(crispX, chartArea.bottom);
        ctx.lineTo(crispX, chartArea.bottom + xGridBottomExtend);
        ctx.stroke();
      }
      for (const crispY of yPositions) {
        ctx.beginPath();
        ctx.moveTo(chartArea.left - yGridLeftExtend, crispY);
        ctx.lineTo(chartArea.left, crispY);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawDataset(layout) {
      const ctx = this.ctx;
      const chartArea = layout.chartArea;
      const dataset = this.data && this.data.datasets && this.data.datasets[0] ? this.data.datasets[0] : null;
      const values = layout.values;
      if (!dataset || !values.length) return;

      const count = values.length;
      const width = Math.max(1, chartArea.width);
      const height = Math.max(1, chartArea.height);
      const points = [];

      for (let i = 0; i < count; i++) {
        const raw = Number(values[i]);
        if (!Number.isFinite(raw)) continue;
        const clamped = clamp(raw, 0, 100);
        const x = count <= 1 ? chartArea.left : chartArea.left + (i / (count - 1)) * width;
        const y = chartArea.bottom - (clamped / 100) * height;
        points.push({ x, y });
      }

      if (!points.length) return;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      const lineWidth = dataset.borderWidth || 2;
      const uiS = this._uiScale || getUiScale();
      // White outline for readability on any gradient color
      const outlineWidth = lineWidth + Math.max(0.5, Math.round(1.5 * uiS));
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = outlineWidth;
      ctx.stroke();
      ctx.strokeStyle = dataset.borderColor || "#000000";
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.restore();
    }

    _drawAxes(layout) {
      const ctx = this.ctx;
      const chartArea = layout.chartArea;
      const labels = layout.labels;
      const tickColor = (this.options.scales.x.ticks && this.options.scales.x.ticks.color) || "#000000";
      const yTickColor = (this.options.scales.yBrightness.ticks && this.options.scales.yBrightness.ticks.color) || "#000000";
      const yTitleColor = (this.options.scales.yBrightness.title && this.options.scales.yBrightness.title.color) || yTickColor;
      const xFont = layout.xTickFont;
      const yFont = layout.yTickFont;
      const yTitleFont = layout.titleFont;
      const uiScale = this._uiScale || getUiScale();
      const tickStepMinutes = getXAxisTickStepMinutes(chartArea.width, uiScale);
      const yStep = getBrightnessTickStep(chartArea.height, uiScale);

      ctx.save();
      ctx.fillStyle = yTickColor;
      ctx.strokeStyle = yTickColor;
      ctx.font = yFont;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      for (let value = 0; value <= 100; value += yStep) {
        const y = chartArea.bottom - (value / 100) * chartArea.height;
        ctx.fillText(String(value), chartArea.left - Math.round(8 * uiScale), Math.round(y));
      }

      ctx.save();
      ctx.translate(Math.round((chartArea.left - 8 * uiScale) / 2) - Math.round(6 * uiScale), Math.round(chartArea.top + chartArea.height / 2));
      ctx.rotate(-Math.PI / 2);
      ctx.font = yTitleFont;
      ctx.fillStyle = yTitleColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Brightness %", 0, 0);
      ctx.restore();

      ctx.fillStyle = tickColor;
      ctx.font = xFont;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const xTickFontSize = layout.xTickFontSize;
      for (let minute = 0; minute <= 24 * 60; minute += tickStepMinutes) {
        const index = Math.min(labels.length - 1, minute);
        const rawLabel = labels[index] || minuteLabel(index);
        const label = formatTimeLabel(rawLabel);
        const x = Math.round(this.scales.x.getPixelForValue(index));
        ctx.save();
        ctx.translate(x, Math.round(chartArea.bottom + 18 * uiScale));
        ctx.rotate(-Math.PI / 4);
        if (isCompoundLabel(label)) {
          ctx.fillText(label.time, 0, 0);
          ctx.textAlign = "left";
          ctx.font = fontString(Math.round(xTickFontSize * 0.7), "400", this._fontFamily);
          ctx.fillText(label.suffix, 0, 0);
          ctx.font = xFont;
          ctx.textAlign = "right";
        } else {
          ctx.fillText(label, 0, 0);
        }
        ctx.restore();
      }
      ctx.restore();
    }

    _getCanvasRect() {
      if (!this._cachedCanvasRect) this._cachedCanvasRect = this.canvas.getBoundingClientRect();
      return this._cachedCanvasRect;
    }

    _getParentRect() {
      if (!this._cachedParentRect) {
        const parent = this.canvas.parentElement;
        if (parent) this._cachedParentRect = parent.getBoundingClientRect();
      }
      return this._cachedParentRect;
    }

    _updateHoverBoundsCache() {
      if (!this.chartArea || !this.chartArea.width) { this._hoverBoundsCache = null; return; }
      const s = this._uiScale || getUiScale();
      this._hoverBoundsCache = {
        left: this.chartArea.left - Math.round(25 * s),
        right: this.chartArea.right + Math.round(14 * s),
        top: this.chartArea.top - Math.round(30 * s),
        bottom: this.chartArea.bottom + Math.round(25 * s),
      };
    }

    _drawHoverPoint() {
      if (!this._hoverMarkerEl) return;
      if (!this._hoverPoint) {
        if (!this._markerFadeTimer) this._hoverMarkerEl.style.display = "none";
        return;
      }

      const uiScale = this._uiScale || getUiScale();
      const { x, y, color } = this._hoverPoint;
      const canvasRect = this._getCanvasRect();
      const parentRect = this._getParentRect() || this._getCanvasRect();
      const canvasOffsetX = canvasRect.left - parentRect.left;
      const canvasOffsetY = canvasRect.top - parentRect.top;
      const px = Math.round(canvasOffsetX + x);
      const py = Math.round(canvasOffsetY + y);

      const moved = px !== this._lastMarkerX || py !== this._lastMarkerY;
      if (moved) {
        this._lastMarkerX = px;
        this._lastMarkerY = py;
        const size = Math.max(4, Math.round(10 * uiScale));
        this._markerHalf = size / 2;
        this._hoverMarkerEl.style.width = `${size}px`;
        this._hoverMarkerEl.style.height = `${size}px`;
        this._hoverMarkerEl.style.transform = `translate(${px - this._markerHalf}px,${py - this._markerHalf}px)`;
        if (this._hoverMarkerInner) {
          this._hoverMarkerInner.style.transform = "scale(1.18)";
          clearTimeout(this._markerScaleTimer);
          this._markerScaleTimer = setTimeout(() => {
            if (this._hoverMarkerInner) this._hoverMarkerInner.style.transform = "scale(1)";
          }, 80);
        }
      }
      clearTimeout(this._markerFadeTimer);
      this._markerFadeTimer = null;
      this._hoverMarkerEl.style.opacity = "1";
      if (this._hoverMarkerInner) {
        this._hoverMarkerInner.style.opacity = "1";
        if (!moved) this._hoverMarkerInner.style.transform = "scale(1)";
      }
      this._hoverMarkerEl.style.display = "block";
      const glowColor = color || "#ffffff";
      if (glowColor !== this._lastGlowColor) {
        this._lastGlowColor = glowColor;
        const ringW = Math.max(1, Math.round(2 * uiScale) - 1);
        const shadowVal = `0 0 0 ${ringW}px ${glowColor}, 0 0 ${Math.round(8 * uiScale)}px ${Math.round(3 * uiScale)}px ${glowColor}`;
        if (this._hoverMarkerInner) this._hoverMarkerInner.style.boxShadow = shadowVal;
        else this._hoverMarkerEl.style.boxShadow = shadowVal;
      }
      this._positionTooltip(px, py, parentRect.width, parentRect.height);
    }

    _createHoverTooltipElement() {
      const parent = this.canvas.parentElement || document.body;
      const el = document.createElement("div");
      el.className = "chart-tooltip";
      el.style.display = "none";
      el.style.opacity = "0";
      el.style.transform = "translate(-9999px,-9999px)";

      const row1 = document.createElement("div");
      row1.className = "chart-tooltip-row";
      const timeSpan = document.createElement("span");
      timeSpan.className = "chart-tooltip-time";
      const brightnessSpan = document.createElement("span");
      brightnessSpan.className = "chart-tooltip-brightness";
      row1.appendChild(timeSpan);
      row1.appendChild(brightnessSpan);

      const row2 = document.createElement("div");
      row2.className = "chart-tooltip-row";
      const swatch = document.createElement("span");
      swatch.className = "chart-tooltip-swatch";
      const hexSpan = document.createElement("span");
      hexSpan.className = "chart-tooltip-hex";
      row2.appendChild(swatch);
      row2.appendChild(hexSpan);

      el.appendChild(row1);
      el.appendChild(row2);
      parent.appendChild(el);

      this._ttTimeEl = timeSpan;
      this._ttBrightnessEl = brightnessSpan;
      this._ttSwatchEl = swatch;
      this._ttHexEl = hexSpan;
      const uiS = this._uiScale || getUiScale();
      if (typeof localStorage !== "undefined" && localStorage.getItem("clockFormat") === "12") {
        el.style.minWidth = `${Math.round(115 * uiS)}px`;
      }
      return el;
    }

    _updateTooltipContent(label, value, hex) {
      if (!this._hoverTooltipEl) this._hoverTooltipEl = this._createHoverTooltipElement();
      const valText = Number.isFinite(value) ? `${value.toFixed(1)}%` : "--%";
      const lbl = isCompoundLabel(label) ? label.time + label.suffix : (label || "--:--");
      const h = hex || "";
      if (lbl === this._ttLastLabel && valText === this._ttLastVal && h === this._ttLastHex) return;
      this._ttLastLabel = lbl;
      this._ttLastVal = valText;
      this._ttLastHex = h;
      this._ttContentChanged = true;
      if (this._ttTimeEl) this._ttTimeEl.textContent = lbl;
      if (this._ttBrightnessEl) this._ttBrightnessEl.textContent = valText;
      if (this._ttHexEl) this._ttHexEl.textContent = h;
      if (this._ttSwatchEl) {
        this._ttSwatchEl.style.background = hex || "transparent";
        this._ttSwatchEl.style.display = hex ? "" : "none";
      }
    }

    _positionTooltip(markerX, markerY, containerW, containerH) {
      const el = this._hoverTooltipEl;
      if (!el) return;
      const uiScale = this._uiScale || getUiScale();
      const offset = Math.round(14 * uiScale);
      let left = markerX + offset;
      let top = markerY - offset;

      clearTimeout(this._tooltipFadeTimer);
      this._tooltipFadeTimer = null;
      el.style.opacity = "1";
      el.style.display = "block";
      if (this._ttContentChanged || !this._ttCachedW) {
        const rect = el.getBoundingClientRect();
        this._ttCachedW = rect.width;
        this._ttCachedH = rect.height;
        this._ttContentChanged = false;
      }
      const tooltipW = this._ttCachedW;
      const tooltipH = this._ttCachedH;

      if (left + tooltipW > containerW - 4) {
        left = markerX - offset - tooltipW;
      }
      if (top < 4) {
        top = markerY + offset;
      }
      if (top + tooltipH > containerH - 4) {
        top = containerH - tooltipH - 4;
      }
      el.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
    }

    _createTrailCanvas() {
      const parent = this.canvas.parentElement || document.body;
      const c = document.createElement("canvas");
      c.style.position = "absolute";
      c.style.left = "0";
      c.style.top = "0";
      c.style.width = "100%";
      c.style.height = "100%";
      c.style.pointerEvents = "none";
      c.style.zIndex = "28";
      parent.appendChild(c);
      return c;
    }

    _resizeTrailCanvas() {
      const c = this._trailCanvas;
      if (!c || !c.parentElement) return;
      const r = this._getParentRect();
      if (!r) return;
      const dpr = this._dpr;
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
    }

    _pushTrailPoint(px, py) {
      const pts = this._trailPoints;
      const now = performance.now();
      if (pts.length > 0) {
        const last = pts[pts.length - 1];
        const gap = Math.hypot(px - last.x, py - last.y);
        if (gap < 0.5) return;
        const timeSince = now - (this._trailLastPushTime || 0);
        const speed = timeSince > 0 ? gap / (timeSince / 1000) : 0;
        this._trailSpeed = this._trailSpeed
          ? this._trailSpeed * 0.7 + speed * 0.3
          : speed;
        if (this._trailAbandoned) {
          this._snapshotTrailGhost();
          pts.length = 0;
          this._trailTailDist = 0;
        }
      }
      this._trailAbandoned = false;
      this._trailFadeAlpha = 1;
      this._trailLastPushTime = now;
      pts.push({ x: px, y: py });
      this._trailHasFresh = true;
      this._trailLastFreshTime = now;
      if (!this._trailRafId) {
        this._lastTrailFrame = performance.now();
        this._trailRafId = requestAnimationFrame(() => this._drawTrailFrame());
      }
    }

    _advanceTrailPhysics(dt, now, seg) {
      const pts = this._trailPoints;
      const dtSec = dt / 1000;
      const hovering = this._tooltipVisible;

      const chartW = Math.max(1, this.chartArea && this.chartArea.width || 200);
      const chartH = Math.max(1, this.chartArea && this.chartArea.height || 100);
      const gm = Math.sqrt(chartW * chartH);
      const speedRatio = Math.min(1, (this._trailSpeed || 0) / 400);
      const baseMaxLength = Math.max(50, Math.round(gm * (0.25 + speedRatio * 0.40)));

      let totalArc = 0;
      for (let i = pts.length - 1; i > 0; i--) {
        totalArc += seg(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      }

      let windiness = 0;
      if (pts.length >= 2 && totalArc > 10) {
        const chord = seg(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
        windiness = Math.max(0, 1 - chord / totalArc);
      }

      const turnBoost = windiness * 60 * dtSec;
      const maxLength = baseMaxLength * (1 - windiness * 0.6);
      if (!this._trailHasFresh) {
        this._trailSpeed = (this._trailSpeed || 0) * Math.max(0, 1 - dtSec * 3);
        if (hovering) {
          this._trailTailDist += (15 + totalArc * 2.0) * dtSec;
        } else {
          const sinceLeft = now - (this._trailLeftTime || now);
          const leftRamp = Math.min(1, Math.max(0, (sinceLeft - 100) / 200));
          this._trailTailDist += (20 + leftRamp * Math.max(120, totalArc * 3.0)) * dtSec;
        }
      } else {
        this._trailTailDist += totalArc * 1.0 * dtSec;
      }
      // Excess contraction applies in ALL states
      if (totalArc > maxLength) {
        const excess = totalArc - maxLength;
        const ratio = Math.min(excess / maxLength, 1);
        this._trailTailDist += excess * (2.5 + 22.0 * ratio) * dtSec;
      }
      this._trailTailDist += turnBoost;
      this._trailHasFresh = false;

      if (hovering) {
        this._trailFadeAlpha = Math.min(1, (this._trailFadeAlpha ?? 1) + dtSec * 8);
      } else {
        this._trailFadeAlpha = Math.max(0, (this._trailFadeAlpha ?? 1) - dtSec * 2.5);
      }

      let consumedArc = 0;
      let consumed = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const s = seg(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (consumedArc + s <= this._trailTailDist) {
          consumedArc += s;
          consumed++;
        } else {
          break;
        }
      }
      if (consumed > 0) {
        pts.splice(0, consumed);
        this._trailTailDist -= consumedArc;
      }

      return totalArc;
    }

    _renderTrail(ctx, pts, offX, offY, seg, thick, uiScale) {
      const firstSeg = seg(pts[0].x, pts[0].y, pts[1].x, pts[1].y);

      // Interpolate tail start within the first segment for smooth contraction
      let startX = pts[0].x;
      let startY = pts[0].y;
      if (firstSeg > 0 && this._trailTailDist > 0) {
        const t = Math.min(this._trailTailDist / firstSeg, 1);
        startX = pts[0].x + (pts[1].x - pts[0].x) * t;
        startY = pts[0].y + (pts[1].y - pts[0].y) * t;
      }

      const arcDist = new Array(pts.length);
      arcDist[0] = 0;
      arcDist[1] = firstSeg > 0 ? firstSeg - Math.min(this._trailTailDist, firstSeg) : 0;
      for (let i = 2; i < pts.length; i++) {
        arcDist[i] = arcDist[i - 1] + seg(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      }
      const trailLen = arcDist[pts.length - 1] || 1;

      if (trailLen < 1) {
        pts.length = 0;
        this._trailTailDist = 0;
        return false;
      }

      const fadeOutPx = 20;
      const shortAlpha = trailLen < fadeOutPx ? (trailLen / fadeOutPx) ** 2 : 1;
      ctx.globalAlpha = shortAlpha * (this._trailFadeAlpha ?? 1);

      const tailEnd = trailLen * 0.55;

      ctx.lineWidth = thick;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // 1. Draw entire trail as one continuous path at full opacity (round caps)
      ctx.beginPath();
      ctx.moveTo(offX + startX, offY + startY);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(offX + pts[i].x, offY + pts[i].y);
      }
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      // 2. Erase tail: per-segment fade along arc distance
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "butt";
      for (let i = 0; i < pts.length - 1; i++) {
        if (arcDist[i] >= tailEnd) break;
        const a0 = Math.max(0, 1 - arcDist[i] / tailEnd);
        const a1 = Math.max(0, 1 - arcDist[i + 1] / tailEnd);
        if (a0 < 0.001 && a1 < 0.001) continue;
        const fx = offX + (i === 0 ? startX : pts[i].x);
        const fy = offY + (i === 0 ? startY : pts[i].y);
        const ex = offX + pts[i + 1].x;
        const ey = offY + pts[i + 1].y;
        if (Math.hypot(ex - fx, ey - fy) < 0.5) continue;
        const g = ctx.createLinearGradient(fx, fy, ex, ey);
        g.addColorStop(0, `rgba(0,0,0,${a0})`);
        g.addColorStop(1, `rgba(0,0,0,${a1})`);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = g;
        ctx.stroke();
      }

      // 3. Head fade: strengthens as the trail nears the marker for smooth disappearance
      const markerDiam = Math.max(6, Math.round(14 * uiScale));
      const shortThresh = markerDiam * 2;
      const shortness = trailLen < shortThresh ? 1 - trailLen / shortThresh : 0;
      const headFadePx = Math.max(4, Math.round((4 + shortness * 8) * uiScale));
      const headMaxAlpha = 0.15 + shortness * 0.35;
      const headStart = trailLen - headFadePx;
      if (headStart > 0 && shortness < 0.5) {
        for (let i = pts.length - 2; i >= 0; i--) {
          if (arcDist[i + 1] <= headStart) break;
          const d0 = arcDist[i];
          const d1 = arcDist[i + 1];
          const a0 = d0 >= headStart ? Math.min(headMaxAlpha, ((d0 - headStart) / headFadePx) * headMaxAlpha) : 0;
          const a1 = d1 >= headStart ? Math.min(headMaxAlpha, ((d1 - headStart) / headFadePx) * headMaxAlpha) : 0;
          if (a0 < 0.001 && a1 < 0.001) continue;
          const fx = offX + (i === 0 ? startX : pts[i].x);
          const fy = offY + (i === 0 ? startY : pts[i].y);
          const ex = offX + pts[i + 1].x;
          const ey = offY + pts[i + 1].y;
          if (Math.hypot(ex - fx, ey - fy) < 0.5) continue;
          const g = ctx.createLinearGradient(fx, fy, ex, ey);
          g.addColorStop(0, `rgba(0,0,0,${a0})`);
          g.addColorStop(1, `rgba(0,0,0,${a1})`);
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(ex, ey);
          ctx.strokeStyle = g;
          ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      return true;
    }

    _drawTrailFrame() {
      this._trailRafId = null;
      const c = this._trailCanvas;
      const ctx = this._trailCtx;
      if (!c || !ctx) return;

      this._resizeTrailCanvas();
      const dpr = this._dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = c.width / dpr;
      const h = c.height / dpr;

      const now = performance.now();
      const dt = Math.min(now - (this._lastTrailFrame || now), 100);
      this._lastTrailFrame = now;

      const uiScale = this._uiScale || getUiScale();
      const chartW = Math.max(1, this.chartArea && this.chartArea.width || 200);
      const chartH = Math.max(1, this.chartArea && this.chartArea.height || 100);
      // Aspect-corrected distances so horizontal and vertical trails feel equal
      const gm = Math.sqrt(chartW * chartH);
      const sx = gm / chartW;
      const sy = gm / chartH;
      const seg = (ax, ay, bx, by) => Math.hypot((bx - ax) * sx, (by - ay) * sy);
      const thick = Math.max(0.5, 2 * uiScale - 1);

      const pts = this._trailPoints;
      const hovering = this._tooltipVisible;

      this._advanceTrailPhysics(dt, now, seg);

      ctx.clearRect(0, 0, w, h);

      let hasGhost = this._trailGhostAlpha > 0.01;
      if (hasGhost && this._trailGhostCanvas) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = this._trailGhostAlpha;
        ctx.drawImage(this._trailGhostCanvas, 0, 0);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const dtSec = dt / 1000;
        this._trailGhostAlpha -= dtSec * 2.5;
        if (this._trailGhostAlpha <= 0.01) {
          this._trailGhostAlpha = 0;
          hasGhost = false;
        }
      }

      if (pts.length < 2) {
        this._trailTailDist = 0;
        if (hasGhost || hovering) {
          this._trailRafId = requestAnimationFrame(() => this._drawTrailFrame());
        }
        return;
      }

      const canvasRect = this._getCanvasRect();
      const parentRect = this._getParentRect();
      if (!parentRect) return;
      const offX = canvasRect.left - parentRect.left;
      const offY = canvasRect.top - parentRect.top;

      const rendered = this._renderTrail(ctx, pts, offX, offY, seg, thick, uiScale);
      if (!rendered && hasGhost) {
        this._trailRafId = requestAnimationFrame(() => this._drawTrailFrame());
        return;
      }

      this._trailRafId = requestAnimationFrame(() => this._drawTrailFrame());
    }

    _snapshotTrailGhost() {
      const c = this._trailCanvas;
      if (!c || !c.width || !c.height) return;
      if (this._trailPoints.length < 3) return;
      if (!this._trailGhostCanvas) {
        this._trailGhostCanvas = document.createElement("canvas");
      }
      const gc = this._trailGhostCanvas;
      gc.width = c.width;
      gc.height = c.height;
      gc.getContext("2d").drawImage(c, 0, 0);
      this._trailGhostAlpha = 1.0;
    }

    _clearTrail() {
      this._trailPoints.length = 0;
      this._trailTailDist = 0;
      this._lastTrailFrame = 0;
      this._trailGhostAlpha = 0;
      this._trailFadeAlpha = 1;
      if (this._trailRafId) {
        cancelAnimationFrame(this._trailRafId);
        this._trailRafId = null;
      }
      if (this._trailCtx && this._trailCanvas) {
        const dpr = this._dpr;
        this._trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._trailCtx.clearRect(0, 0, this._trailCanvas.width / dpr, this._trailCanvas.height / dpr);
      }
    }

    _resolveIndexToPoint(frac, labels, values, colorCache, dataset) {
      if (!this.chartArea || !this.chartArea.width) return null;
      const chartArea = this.chartArea;
      const count = Math.min(labels.length || values.length, values.length || labels.length);
      if (!count || count < 2) return null;
      const width = Math.max(1, chartArea.width);
      const height = Math.max(1, chartArea.height);
      const denom = Math.max(1, count - 1);
      const ii = Math.floor(frac);
      const t = frac - ii;
      const v1 = Number(values[clamp(ii, 0, count - 1)]);
      const v2 = Number(values[clamp(ii + 1, 0, count - 1)]);
      const x = chartArea.left + frac * (width / denom);
      const y = !Number.isFinite(v1) ? chartArea.bottom
        : !Number.isFinite(v2) ? chartArea.bottom - (clamp(v1, 0, 100) / 100) * height
          : chartArea.bottom - ((clamp(v1, 0, 100) * (1 - t) + clamp(v2, 0, 100) * t) / 100) * height;
      const roundedIndex = clamp(Math.round(frac), 0, count - 1);
      const label = formatTimeLabel(labels[roundedIndex] || minuteLabel(roundedIndex));
      const displayValue = clamp((chartArea.bottom - y) / height * 100, 0, 100);
      const colorIdx = colorCache.length > 1
        ? clamp(Math.round((frac / denom) * (colorCache.length - 1)), 0, colorCache.length - 1)
        : roundedIndex;
      const colorHex = colorCache.length ? normalizeHexColor(colorCache[colorIdx]) : null;
      const fallback = normalizeHexColor(dataset && (dataset.borderColor || dataset.backgroundColor));
      return { x, y, label, displayValue, color: colorHex || fallback, index: frac };
    }

    _updateLockedMarker() {
      if (!this._markerLocked || this._lockedIndex == null) return;
      if (!this.chartArea || !this.chartArea.width) return;
      const labels = ensurePathArray(this.data && this.data.labels);
      const dataset = this.data && this.data.datasets && this.data.datasets[0] ? this.data.datasets[0] : null;
      const values = ensurePathArray(dataset && dataset.data);
      const count = Math.min(labels.length || values.length, values.length || labels.length);
      if (!count || count < 2) return;
      const frac = clamp(this._lockedIndex, 0, count - 1);
      const colorCache = ensurePathArray(this.colorHexCache);
      const pt = this._resolveIndexToPoint(frac, labels, values, colorCache, dataset);
      if (!pt) return;
      this._hoverPoint = pt;
      this._updateTooltipContent(pt.label, pt.displayValue, pt.color);
      if (this._hoverTooltipEl) {
        clearTimeout(this._tooltipFadeTimer);
        this._tooltipFadeTimer = null;
        this._hoverTooltipEl.style.opacity = "1";
        this._hoverTooltipEl.style.display = "block";
        this._hoverTooltipEl.style.pointerEvents = "auto";
        this._hoverTooltipEl.style.userSelect = "text";
      }
      this._drawHoverPoint();
    }

    _createHoverMarkerElement() {
      const parent = this.canvas.parentElement || document.body;
      const s = this._uiScale || getUiScale();

      const outer = document.createElement("div");
      outer.style.position = "absolute";
      outer.style.left = "0";
      outer.style.top = "0";
      outer.style.display = "none";
      outer.style.pointerEvents = "none";
      outer.style.zIndex = "29";
      outer.style.boxSizing = "border-box";
      outer.style.transition = "transform 20ms ease-out, opacity 180ms ease-out";

      const inner = document.createElement("div");
      inner.style.position = "absolute";
      inner.style.inset = "0";
      inner.style.borderRadius = "999px";
      inner.style.background = `radial-gradient(circle, #ffffff ${1.5 * s}px, transparent ${2 * s}px)`;
      inner.style.backdropFilter = "invert(1) grayscale(1)";
      inner.style.webkitBackdropFilter = "invert(1) grayscale(1)";
      inner.style.transformOrigin = "center center";
      inner.style.transition = "transform 200ms ease-out, box-shadow 180ms ease-out, opacity 180ms ease-out";

      outer.appendChild(inner);
      parent.appendChild(outer);
      this._hoverMarkerInner = inner;
      return outer;
    }


    _spawnLockPulse(point) {
      if (!point) return;

      const parent = this.canvas.parentElement || document.body;
      const canvasRect = this.canvas.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const pulse = document.createElement("div");
      pulse.className = "chart-lock-pulse";
      pulse.style.left = `${canvasRect.left - parentRect.left + point.x}px`;
      pulse.style.top = `${canvasRect.top - parentRect.top + point.y}px`;
      parent.appendChild(pulse);

      const removePulse = () => {
        if (pulse.parentNode) pulse.parentNode.removeChild(pulse);
      };
      pulse.addEventListener("animationend", removePulse, { once: true });
      window.setTimeout(removePulse, 560);
    }

    _lockMarker() {
      this._holdTimer = null;
      if (!this._hoverPoint) return;
      this._markerLocked = true;
      this._lockedIndex = this._hoverPoint.index != null ? this._hoverPoint.index : null;
      this._spawnLockPulse(this._hoverPoint);
      if (this._hoverTooltipEl) {
        this._hoverTooltipEl.style.userSelect = "text";
        this._hoverTooltipEl.style.pointerEvents = "auto";
      }
    }

    _handlePointerDown(event) {
      if (this._hoverTooltipEl && this._hoverTooltipEl.contains(event.target)) return;
      if (this._markerLocked) {
        this._markerLocked = false;
        if (this._hoverTooltipEl) {
          this._hoverTooltipEl.style.userSelect = "";
          this._hoverTooltipEl.style.pointerEvents = "";
        }
        this._processPointerMove(event);
        return;
      }
      if (event.pointerType === "touch") {
        event.preventDefault();
        this._processPointerMove(event);
      }
      this._holdStartX = event.clientX;
      this._holdStartY = event.clientY;
      clearTimeout(this._holdTimer);
      this._holdTimer = setTimeout(() => this._lockMarker(), 1500);
    }

    _handlePointerUp(event) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
      if (!this._markerLocked && event && event.pointerType === "touch") {
        this._hideTooltip();
      }
    }

    _hideTooltip(shouldRedraw) {
      if (this._markerLocked) return;
      this._tooltipVisible = false;
      this._hoverPoint = null;
      if (this._hoverMarkerEl) {
        this._hoverMarkerEl.style.opacity = "0";
        if (this._hoverMarkerInner) this._hoverMarkerInner.style.transform = "scale(0.6)";
        clearTimeout(this._markerFadeTimer);
        this._markerFadeTimer = setTimeout(() => {
          if (this._hoverMarkerEl) this._hoverMarkerEl.style.display = "none";
          if (this._hoverMarkerInner) this._hoverMarkerInner.style.transform = "scale(1)";
          this._markerFadeTimer = null;
        }, 200);
      }
      if (this._pointerRafId) {
        cancelAnimationFrame(this._pointerRafId);
        this._pointerRafId = null;
      }
      this._pendingPointerEvent = null;
      this._lastGlowColor = null;
      if (this._hoverTooltipEl) {
        this._hoverTooltipEl.style.opacity = "0";
        clearTimeout(this._tooltipFadeTimer);
        this._tooltipFadeTimer = setTimeout(() => {
          if (this._hoverTooltipEl) this._hoverTooltipEl.style.display = "none";
          this._tooltipFadeTimer = null;
        }, 200);
      }
      this._trailAbandoned = true;
      this._trailLeftTime = performance.now();
      const hasTrailOrGhost = this._trailPoints.length >= 2 || this._trailGhostAlpha > 0.01;
      if (hasTrailOrGhost && !this._trailRafId) {
        this._lastTrailFrame = performance.now();
        this._trailRafId = requestAnimationFrame(() => this._drawTrailFrame());
      }
      if (shouldRedraw !== false) {
        this.draw();
      }
    }

    _isWithinHoverBounds(x, y) {
      const b = this._hoverBoundsCache;
      if (!b) return false;
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    }

    _handlePointerMove(event) {
      if (this._markerLocked) return;
      if (this._holdTimer != null) {
        const moveThreshold = event.pointerType === "touch" ? 15 : 6;
        if (Math.hypot(event.clientX - this._holdStartX, event.clientY - this._holdStartY) > moveThreshold) {
          clearTimeout(this._holdTimer);
          this._holdTimer = null;
        }
      }
      this._pendingPointerEvent = event;
      if (!this._pointerRafId) {
        this._pointerRafId = requestAnimationFrame(() => {
          this._pointerRafId = null;
          const ev = this._pendingPointerEvent;
          this._pendingPointerEvent = null;
          if (ev) this._processPointerMove(ev);
        });
      }
    }

    _processPointerMove(event) {
      if (!this.chartArea || !this.chartArea.width || !this.chartArea.height) return;

      const canvasRect = this.canvas.getBoundingClientRect();
      const x = event.clientX - canvasRect.left;
      const y = event.clientY - canvasRect.top;

      if (!this._isWithinHoverBounds(x, y)) {
        this._hideTooltip();
        return;
      }

      const labels = ensurePathArray(this.data && this.data.labels);
      const dataset = this.data && this.data.datasets && this.data.datasets[0] ? this.data.datasets[0] : null;
      const values = ensurePathArray(dataset && dataset.data);
      const count = Math.min(labels.length || values.length, values.length || labels.length);
      if (!count || count < 2) {
        this._hideTooltip();
        return;
      }

      // Nearest-point-on-polyline: project cursor onto each segment for smooth 2D hover
      const chartArea = this.chartArea;
      const width = Math.max(1, chartArea.width);
      const height = Math.max(1, chartArea.height);
      const denom = Math.max(1, count - 1);
      const xStep = width / denom;

      // Scan only segments near cursor x (monotonic polyline)
      const plotX = clamp((x - chartArea.left) / width, 0, 1);
      const centerIdx = plotX * denom;
      const scanPad = 8;
      const startIdx = Math.max(0, Math.floor(centerIdx) - scanPad);
      const endIdx = Math.min(count - 2, Math.ceil(centerIdx) + scanPad);

      let bestDist = Number.POSITIVE_INFINITY;
      let bestX = 0;
      let bestY = 0;
      let bestFrac = centerIdx;

      for (let i = startIdx; i <= endIdx; i++) {
        const v1 = Number(values[i]);
        const v2 = Number(values[i + 1]);
        if (!Number.isFinite(v1) || !Number.isFinite(v2)) continue;
        const px1 = chartArea.left + i * xStep;
        const py1 = chartArea.bottom - (clamp(v1, 0, 100) / 100) * height;
        const px2 = chartArea.left + (i + 1) * xStep;
        const py2 = chartArea.bottom - (clamp(v2, 0, 100) / 100) * height;
        const segDx = px2 - px1;
        const segDy = py2 - py1;
        const segLenSq = segDx * segDx + segDy * segDy;
        if (segLenSq === 0) continue;
        const t = clamp(((x - px1) * segDx + (y - py1) * segDy) / segLenSq, 0, 1);
        const projX = px1 + t * segDx;
        const projY = py1 + t * segDy;
        // Chart-normalized distance: equal x/y influence proportional to axis extent
        const ndx = (x - projX) / width;
        const ndy = (y - projY) / height;
        const dist = ndx * ndx + ndy * ndy;
        if (dist < bestDist) {
          bestDist = dist;
          bestX = projX;
          bestY = projY;
          bestFrac = i + t;
        }
      }

      if (!Number.isFinite(bestDist)) {
        this._hideTooltip();
        return;
      }

      const colorCache = ensurePathArray(this.colorHexCache);
      const pt = this._resolveIndexToPoint(bestFrac, labels, values, colorCache, dataset);
      if (!pt) { this._hideTooltip(); return; }
      const displayValue = clamp((chartArea.bottom - bestY) / height * 100, 0, 100);

      this._tooltipVisible = true;
      this._hoverPoint = { x: bestX, y: bestY, label: pt.label, value: displayValue, color: pt.color, index: bestFrac };
      this._updateTooltipContent(pt.label, displayValue, pt.color);

      this._pushTrailPoint(bestX, bestY);

      this._drawHoverPoint();
    }

  }

  LiteChart.register = LiteChart.register.bind(LiteChart);
  LiteChart.setClockFormat = LiteChart.setClockFormat.bind(LiteChart);
  window.Chart = LiteChart;
})();
