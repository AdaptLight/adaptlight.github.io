/** biome-ignore-all lint/complexity/useOptionalChain: idk */
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

  function getUiScale() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function getXAxisTickStepMinutes(chartWidth) {
    if (chartWidth >= 1000) return 30;
    if (chartWidth < 220) return 180;
    if (chartWidth < 500) return 120;
    return 60;
  }

  function getBrightnessTickStep(chartHeight) {
    if (chartHeight < 180) return 20;
    if (chartHeight < 320) return 10;
    return 5;
  }

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
      this._hoverPoint = null;
      this._trailCanvas = this._createTrailCanvas();
      this._trailCtx = this._trailCanvas.getContext("2d");
      this._trailPoints = [];       // position buffer: { x, y }
      this._trailRafId = null;
      this._trailTailDist = 0;       // arc length consumed from oldest end
      this._lastTrailFrame = 0;      // timestamp of last animation frame
      this._hoverMarkerEl = this._createHoverMarkerElement();
      this._hoverTooltipEl = this._createHoverTooltipElement();
      this._boundMove = this._handlePointerMove.bind(this);
      this._boundClick = this._handleChartClick.bind(this);
      this._boundLeave = this._hideTooltip.bind(this);
      this._boundResize = this.resize.bind(this);

      this.canvas.addEventListener("pointermove", this._boundMove);
      this.canvas.addEventListener("pointerdown", this._boundMove);
      this.canvas.addEventListener("click", this._boundClick);
      this.canvas.addEventListener("pointerleave", this._boundLeave);
      this.canvas.addEventListener("pointercancel", this._boundLeave);
      window.addEventListener("resize", this._boundResize);

      this.resize();
    }

    static register(...plugins) {
      for (const plugin of plugins) {
        if (!plugin || registeredPlugins.indexOf(plugin) !== -1) continue;
        registeredPlugins.push(plugin);
      }
    }

    destroy() {
      this.canvas.removeEventListener("pointermove", this._boundMove);
      this.canvas.removeEventListener("pointerdown", this._boundMove);
      this.canvas.removeEventListener("click", this._boundClick);
      this.canvas.removeEventListener("pointerleave", this._boundLeave);
      this.canvas.removeEventListener("pointercancel", this._boundLeave);
      window.removeEventListener("resize", this._boundResize);
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
      this._hideTooltip(false);
      this.draw();
    }

    update() {
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
      this.scales.x = this._createXScale(this._dataCount(), this.chartArea);
      this.scales.yBrightness = this._createYScale(this.chartArea);

      this._callPlugins("beforeDraw");
      this._drawGrid(layout);
      this._drawDataset(layout);
      this._drawAxes(layout);
      this._drawHoverPoint();
      this._callPlugins("afterDraw");
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
      const labelSample = labels.length ? labels[0] : minuteLabel(0);
      const titlePadding = Number(this.options.scales.yBrightness.title && this.options.scales.yBrightness.title.padding) || 0;
      const yTickWidth = Math.max(
        measureTextWidth(this.ctx, "0", yTickFont),
        measureTextWidth(this.ctx, "100", yTickFont)
      );
      const left = Math.max(Math.round(52 * uiScale), Math.ceil(yTickWidth + Math.round(10 * uiScale) + titlePadding));
      const right = Math.round(16 * uiScale);
      const top = Math.round(20 * uiScale);
      const bottom = Math.max(Math.round(44 * uiScale), Math.ceil(measureTextWidth(this.ctx, labelSample, xTickFont) * 0.62 + Math.round(24 * uiScale)));
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
      const ctx = this.ctx;
      const chartArea = layout.chartArea;
      const xGrid = (this.options.scales.x.grid && this.options.scales.x.grid.color) || "rgba(0,0,0,0.08)";
      const yGrid = (this.options.scales.yBrightness.grid && this.options.scales.yBrightness.grid.color) || "rgba(0,0,0,0.08)";
      const labels = layout.labels;
      const tickStepMinutes = getXAxisTickStepMinutes(chartArea.width);
      const uiScale = this._uiScale || getUiScale();
      const xGridBottomExtend = Math.round(13 * uiScale);
      const yGridLeftExtend = Math.round(11 * uiScale);
      const yStep = getBrightnessTickStep(chartArea.height);

      ctx.save();
      ctx.lineWidth = Math.max(1, uiScale);
      ctx.strokeStyle = xGrid;

      for (let minute = 0; minute <= 24 * 60; minute += tickStepMinutes) {
        const index = Math.min(labels.length - 1, minute);
        const x = this.scales.x.getPixelForValue(index);
        const crispX = Math.round(x) + 0.5;
        ctx.beginPath();
        ctx.moveTo(crispX, chartArea.top);
        ctx.lineTo(crispX, chartArea.bottom + xGridBottomExtend);
        ctx.stroke();
      }

      ctx.strokeStyle = yGrid;
      for (let value = 0; value <= 100; value += yStep) {
        const y = chartArea.bottom - (value / 100) * chartArea.height;
        const crispY = Math.round(y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(chartArea.left - yGridLeftExtend, crispY);
        ctx.lineTo(chartArea.right, crispY);
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
      ctx.moveTo(points[0].x, chartArea.bottom);
      for (const point of points) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.lineTo(points[points.length - 1].x, chartArea.bottom);
      ctx.closePath();
      ctx.fillStyle = dataset.backgroundColor || "rgba(0,0,0,0.04)";
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      const lineWidth = dataset.borderWidth || 2;
      const outlineWidth = lineWidth + Math.max(1, Math.round((this._uiScale || getUiScale()) * 1));
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
      const tickStepMinutes = getXAxisTickStepMinutes(chartArea.width);
      const uiScale = this._uiScale || getUiScale();
      const yStep = getBrightnessTickStep(chartArea.height);

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
      ctx.translate(Math.round(12 * uiScale), Math.round(chartArea.top + chartArea.height / 2));
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
      for (let minute = 0; minute <= 24 * 60; minute += tickStepMinutes) {
        const index = Math.min(labels.length - 1, minute);
        const label = labels[index] || minuteLabel(index);
        const x = Math.round(this.scales.x.getPixelForValue(index));
        ctx.save();
        ctx.translate(x, Math.round(chartArea.bottom + 14 * uiScale));
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    _drawHoverPoint() {
      if (!this._hoverMarkerEl) return;
      if (!this._hoverPoint) {
        this._hoverMarkerEl.style.display = "none";
        return;
      }

      const uiScale = this._uiScale || getUiScale();
      const { x, y } = this._hoverPoint;
      const canvasRect = this.canvas.getBoundingClientRect();
      const parentRect = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
      const canvasOffsetX = canvasRect.left - parentRect.left;
      const canvasOffsetY = canvasRect.top - parentRect.top;
      const size = Math.max(11, Math.round(10 * uiScale));
      const ringW = Math.max(2, Math.round(2 * uiScale));

      this._hoverMarkerEl.style.width = `${size}px`;
      this._hoverMarkerEl.style.height = `${size}px`;
      this._hoverMarkerEl.style.left = `${canvasOffsetX + x}px`;
      this._hoverMarkerEl.style.top = `${canvasOffsetY + y}px`;
      this._hoverMarkerEl.style.display = "block";
      // Fully opaque colored glow ring + soft outer glow
      const glowColor = (this._hoverPoint && this._hoverPoint.color) || "#ffffff";
      this._hoverMarkerEl.style.boxShadow = `0 0 0 ${ringW}px ${glowColor}, 0 0 ${Math.round(7 * uiScale)}px ${Math.round(2 * uiScale)}px ${glowColor}`;
      // Subtle scale pulse: briefly enlarge then return
      this._hoverMarkerEl.style.transform = "translate(-50%, -50%) scale(1.18)";
      clearTimeout(this._markerScaleTimer);
      this._markerScaleTimer = setTimeout(() => {
        if (this._hoverMarkerEl) this._hoverMarkerEl.style.transform = "translate(-50%, -50%) scale(1)";
      }, 80);
      this._positionTooltip(canvasOffsetX + x, canvasOffsetY + y, parentRect.width, parentRect.height);
    }

    _createHoverTooltipElement() {
      const parent = this.canvas.parentElement || document.body;
      const el = document.createElement("div");
      el.className = "chart-tooltip";
      el.style.display = "none";

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
      return el;
    }

    _updateTooltipContent(label, value, hex) {
      if (!this._hoverTooltipEl) return;
      if (this._ttTimeEl) this._ttTimeEl.textContent = label || "--:--";
      if (this._ttBrightnessEl) this._ttBrightnessEl.textContent = Number.isFinite(value) ? `${value.toFixed(1)}%` : "--%";
      if (this._ttHexEl) this._ttHexEl.textContent = hex || "";
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

      el.style.display = "block";
      const rect = el.getBoundingClientRect();
      const tooltipW = rect.width;
      const tooltipH = rect.height;

      if (left + tooltipW > containerW - 4) {
        left = markerX - offset - tooltipW;
      }
      if (top < 4) {
        top = markerY + offset;
      }
      if (top + tooltipH > containerH - 4) {
        top = containerH - tooltipH - 4;
      }
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
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
      const r = c.parentElement.getBoundingClientRect();
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
      if (this._trailPoints.length > 0) {
        const last = this._trailPoints[this._trailPoints.length - 1];
        if (Math.hypot(px - last.x, py - last.y) < 2) return;
      }
      this._trailPoints.push({ x: px, y: py });
      this._trailHasFresh = true;
      if (!this._trailRafId) {
        this._lastTrailFrame = performance.now();
        this._trailRafId = requestAnimationFrame(() => this._drawTrailFrame());
      }
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
      const maxLength = Math.max(100, Math.round(200 * uiScale));
      const thick = Math.max(0.5, 2 * uiScale - 1);

      const pts = this._trailPoints;

      // Compute total arc length for soft-cap contraction
      let totalArc = 0;
      for (let i = pts.length - 1; i > 0; i--) {
        totalArc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }

      // Contraction: always-on base rate when idle; when moving, only
      // a soft cap gently trims excess length instead of a hard splice.
      const baseRate = maxLength * 2.5;
      if (!this._trailHasFresh) {
        this._trailTailDist += baseRate * dt / 1000;
      } else if (totalArc > maxLength) {
        const excess = totalArc - maxLength;
        this._trailTailDist += excess * 0.15;
      }
      this._trailHasFresh = false;

      // Remove points fully consumed by contraction
      let consumedArc = 0;
      let consumed = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        if (consumedArc + seg <= this._trailTailDist) {
          consumedArc += seg;
          consumed++;
        } else {
          break;
        }
      }
      if (consumed > 0) {
        pts.splice(0, consumed);
        this._trailTailDist -= consumedArc;
      }

      ctx.clearRect(0, 0, w, h);

      if (pts.length < 2) {
        this._trailTailDist = 0;
        return;
      }

      const canvasRect = this.canvas.getBoundingClientRect();
      const parentRect = c.parentElement.getBoundingClientRect();
      const offX = canvasRect.left - parentRect.left;
      const offY = canvasRect.top - parentRect.top;

      // Cumulative arc distance from tail (index 0) for each point
      const arcDist = new Array(pts.length);
      arcDist[0] = 0;
      for (let i = 1; i < pts.length; i++) {
        arcDist[i] = arcDist[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      const trailLen = arcDist[pts.length - 1] || 1;
      const tailEnd = trailLen * 0.55;

      ctx.lineWidth = thick;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // 1. Draw entire trail as one continuous path at full opacity
      ctx.beginPath();
      ctx.moveTo(offX + pts[0].x, offY + pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(offX + pts[i].x, offY + pts[i].y);
      }
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      // 2. Erase tail with a single gradient destination-out pass.
      // Linear gradient from full erase at tail tip to zero at boundary.
      ctx.globalCompositeOperation = "destination-out";
      let fadeIdx = pts.length - 1;
      for (let i = 1; i < pts.length; i++) {
        if (arcDist[i] >= tailEnd) { fadeIdx = i; break; }
      }
      const tx0 = offX + pts[0].x;
      const ty0 = offY + pts[0].y;
      const tx1 = offX + pts[fadeIdx].x;
      const ty1 = offY + pts[fadeIdx].y;
      if (Math.hypot(tx1 - tx0, ty1 - ty0) > 4) {
        const tailGrad = ctx.createLinearGradient(tx0, ty0, tx1, ty1);
        tailGrad.addColorStop(0, "rgba(0,0,0,1)");
        tailGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.moveTo(tx0, ty0);
        for (let i = 1; i <= fadeIdx; i++) {
          ctx.lineTo(offX + pts[i].x, offY + pts[i].y);
        }
        ctx.strokeStyle = tailGrad;
        ctx.stroke();
      }

      // 3. Head fade: fixed pixel size, not proportional to trail length
      const headFadePx = Math.max(8, Math.round(15 * uiScale));
      const headDist = trailLen - headFadePx;
      if (headDist > 0) {
        let headI = pts.length - 1;
        for (let i = pts.length - 1; i > 0; i--) {
          if (arcDist[i] <= headDist) { headI = i; break; }
        }
        if (headI < pts.length - 1) {
          const hx0 = offX + pts[headI].x;
          const hy0 = offY + pts[headI].y;
          const hx1 = offX + pts[pts.length - 1].x;
          const hy1 = offY + pts[pts.length - 1].y;
          if (Math.hypot(hx1 - hx0, hy1 - hy0) > 3) {
            const headGrad = ctx.createLinearGradient(hx0, hy0, hx1, hy1);
            headGrad.addColorStop(0, "rgba(0,0,0,0)");
            headGrad.addColorStop(1, "rgba(0,0,0,0.6)");
            ctx.beginPath();
            ctx.moveTo(hx0, hy0);
            for (let i = headI + 1; i < pts.length; i++) {
              ctx.lineTo(offX + pts[i].x, offY + pts[i].y);
            }
            ctx.strokeStyle = headGrad;
            ctx.stroke();
          }
        }
      }

      ctx.globalCompositeOperation = "source-over";

      this._trailRafId = requestAnimationFrame(() => this._drawTrailFrame());
    }

    _clearTrail() {
      this._trailPoints.length = 0;
      this._trailTailDist = 0;
      this._lastTrailFrame = 0;
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

    _createHoverMarkerElement() {
      const el = document.createElement("div");
      const parent = this.canvas.parentElement || document.body;
      el.className = "chart-hover-marker";
      el.style.position = "absolute";
      el.style.left = "0";
      el.style.top = "0";
      el.style.display = "none";
      el.style.pointerEvents = "none";
      el.style.zIndex = "29";
      el.style.borderRadius = "999px";
      el.style.background = "radial-gradient(circle, #ffffff 1.5px, transparent 2px)";
      el.style.border = "none";
      el.style.boxSizing = "border-box";
      el.style.backdropFilter = "invert(1) grayscale(1)";
      el.style.webkitBackdropFilter = "invert(1) grayscale(1)";
      el.style.transform = "translate(-50%, -50%) scale(1)";
      el.style.transformOrigin = "center center";
      el.style.transition = "transform 120ms ease-out, box-shadow 180ms ease-out";
      parent.appendChild(el);
      return el;
    }


    _spawnClickPulse(point) {
      if (!point) return;

      const parent = this.canvas.parentElement || document.body;
      const canvasRect = this.canvas.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const pulse = document.createElement("div");
      pulse.className = "chart-copy-pulse";
      pulse.style.left = `${canvasRect.left - parentRect.left + point.x}px`;
      pulse.style.top = `${canvasRect.top - parentRect.top + point.y}px`;
      parent.appendChild(pulse);

      const removePulse = () => {
        if (pulse.parentNode) pulse.parentNode.removeChild(pulse);
      };
      pulse.addEventListener("animationend", removePulse, { once: true });
      window.setTimeout(removePulse, 560);
    }

    _copyTextToClipboard(text) {
      if (!text) return false;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(text).catch(() => {
          this._copyTextToClipboardFallback(text);
        });
        return true;
      }
      return this._copyTextToClipboardFallback(text);
    }

    _copyTextToClipboardFallback(text) {
      if (!document.body) return false;
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      textarea.remove();
      return copied;
    }

    _hideTooltip(shouldRedraw) {
      this._tooltipVisible = false;
      this._hoverPoint = null;
      if (this._hoverMarkerEl) {
        this._hoverMarkerEl.style.display = "none";
        this._hoverMarkerEl.style.boxShadow = "none";
      }
      if (this._hoverTooltipEl) {
        this._hoverTooltipEl.style.display = "none";
      }
      this._clearTrail();
      if (shouldRedraw !== false) {
        this.draw();
      }
    }

    _getHoverBounds() {
      // Directional hover pad: the chart stays active slightly further outside
      // its drawn area, with different generosity on each side. Click-to-copy
      // uses the exact same bounds so there is no dead zone where hovering
      // works but clicking does not.
      const s = this._uiScale || getUiScale();
      return {
        left: this.chartArea.left - Math.round(25 * s),
        right: this.chartArea.right + Math.round(14 * s),
        top: this.chartArea.top - Math.round(30 * s),
        bottom: this.chartArea.bottom + Math.round(25 * s),
      };
    }

    _isWithinHoverBounds(x, y) {
      const b = this._getHoverBounds();
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    }

    _handlePointerMove(event) {
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

      // Nearest-point-on-polyline: the cursor is projected onto each segment
      // between consecutive data points and the closest projection wins. This
      // gives true 2D hover feel (y coordinate matters) while eliminating the
      // discontinuous jumps that a pure nearest-vertex search has at corners,
      // because the marker slides continuously along each segment instead of
      // snapping from one vertex to the next.
      const chartArea = this.chartArea;
      const width = Math.max(1, chartArea.width);
      const height = Math.max(1, chartArea.height);
      const denom = Math.max(1, count - 1);
      const xStep = width / denom;

      // Restrict the segment search to a window around the cursor's x. The
      // polyline is monotonic in x with uniform spacing, so the relevant
      // segments are those whose x-range brackets the cursor. A small pad
      // covers edge cases without scanning all 1440 segments.
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
        // Chart-normalized distance: dividing by the axis extent gives
        // x and y equal influence in proportion to the chart's data range.
        // On nearly-flat segments the y term is negligible (all projections
        // share roughly the same y), but near steep ramps the cursor's
        // vertical position pulls the marker toward the closest part of
        // the curve. Segment projection still prevents corner jumps.
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

      const roundedIndex = clamp(Math.round(bestFrac), 0, count - 1);
      const label = labels[roundedIndex] || minuteLabel(roundedIndex);
      // Display value derived from the marker's actual y position so the
      // number always matches where the marker sits on the curve.
      const displayValue = clamp((chartArea.bottom - bestY) / height * 100, 0, 100);

      const colorCache = ensurePathArray(this.colorHexCache);
      const colorIndex = colorCache.length > 1
        ? clamp(Math.round((bestFrac / denom) * (colorCache.length - 1)), 0, colorCache.length - 1)
        : roundedIndex;
      const colorHex = colorCache.length ? normalizeHexColor(colorCache[colorIndex]) : null;
      const datasetSwatchColor = normalizeHexColor(dataset && (dataset.borderColor || dataset.backgroundColor));
      const hoveredHex = colorHex || datasetSwatchColor;

      this._tooltipVisible = true;
      this._hoverPoint = {
        x: bestX,
        y: bestY,
        label,
        value: displayValue,
        color: hoveredHex,
      };
      this._updateTooltipContent(label, displayValue, hoveredHex);

      this._pushTrailPoint(bestX, bestY);

      this.draw();
    }

    _handleChartClick(event) {
      if (!this.chartArea || !this._hoverPoint || !this._hoverPoint.color) return;

      const canvasRect = this.canvas.getBoundingClientRect();
      const x = event.clientX - canvasRect.left;
      const y = event.clientY - canvasRect.top;
      if (!this._isWithinHoverBounds(x, y)) return;

      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const lastCopyAt = this._lastCopyAt || 0;
      if (now - lastCopyAt < 400) return;
      this._lastCopyAt = now;

      this._copyTextToClipboard(this._hoverPoint.color);
      this._spawnClickPulse(this._hoverPoint);
    }
  }

  LiteChart.register = LiteChart.register.bind(LiteChart);

  window.Chart = LiteChart;
})();
