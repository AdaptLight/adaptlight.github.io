// Drag-only clock-face time picker.
// Replaces <input type="time"> with a rotary dial dropdown.
// Hour/minute modes opened separately. Drag to set value, no click-to-select.
// Crossing 12→1 boundary toggles AM/PM in 12h; 24h uses [0-11]/[12-23] label sets.
// Auto-closes when pointer moves outside the circular close zone around the clock.
(() => {
  const HALF_CLOCK = 65;
  const CLOCK_SIZE = HALF_CLOCK * 2;

  let activeInstance = null;

  function pad2(n) { return String(n).padStart(2, "0"); }

  function parseHHMM(str) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(str || "");
    if (!m) return { h: 0, m: 0 };
    return { h: Math.min(23, +m[1]), m: Math.min(59, +m[2]) };
  }

  let _is12h = localStorage.getItem("clockFormat") === "12";
  function is12h() { return _is12h; }

  function formatDisplay(h, m) {
    if (is12h()) {
      const suffix = h >= 12 ? "PM" : "AM";
      return { text: `${h % 12 || 12}:${pad2(m)}`, suffix };
    }
    return { text: `${String(h)}:${pad2(m)}`, suffix: "" };
  }

  function closeActive() {
    if (activeInstance) {
      activeInstance.close();
      activeInstance = null;
    }
  }

  // Close on outside click
  document.addEventListener("pointerdown", (e) => {
    if (!activeInstance) return;
    if (activeInstance._dragging) return;
    if (!activeInstance._dropdown?.contains(e.target) &&
        !activeInstance._display.contains(e.target)) {
      closeActive();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeActive();
  });


  function getAngle(ev, clock) {
    const rect = clock.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const x = (ev.clientX ?? 0) - cx;
    const y = (ev.clientY ?? 0) - cy;
    let deg = Math.atan2(y, x) * 180 / Math.PI + 90;
    if (deg < 0) deg += 360;
    return deg;
  }

  // Intentional copy of getUiScale from app.js/chart-lite.js — each module reads the CSS var independently so they stay self-contained
  function getUiScale() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  class TimePicker {
    constructor(originalInput) {
      this._input = originalInput;
      const parsed = parseHHMM(originalInput.value || originalInput.defaultValue);
      this._hour = parsed.h;
      this._minute = parsed.m;
      this._mode = "hour";
      this._open = false;
      this._dragging = false;
      this._prevAngle = null;
      this._keyBuffer = "";
      this._handAngle = null;
      this._scrollLockHandlers = null;
      this._ghostBoundary = null;
      this._ghostHandLen = null;
      this._graceOpen = false;
      this._graceTimer = null;
      this._activeEditField = null;
      this._minuteMarkEls = null;
      this._hoverMarkIdx = null;
      this._selectedMarkIdx = null;
      this._fadeTid = null;
      this._tapOriginOnNumber = null;
      this._tapOriginX = 0;
      this._tapOriginY = 0;
      this._tapMoved = false;
      this._openRow = null;
      this._openSection = null;
      this._backspaceBlank = false;
      this._scrollLockEl = null;
      this._scrollLockTop = 0;
      this._ghostHandEl = null;
      this._ghostPulseEl = null;
      this._ghostArrowEl = null;
      this._blurOverlay = null;
      this._dragState = null;
      this._boundDragMove = null;
      this._boundDragUp = null;

      this._buildDOM();
      this._updateDisplay();
      this._input.style.display = "none";
    }

    _buildDOM() {
      const wrapper = document.createElement("span");
      wrapper.className = "tp-wrapper";

      const display = document.createElement("span");
      display.className = "tp-display";
      display.tabIndex = 0;

      this._hourDigit = document.createElement("span");
      this._hourDigit.className = "tp-digit tp-hour-digit";
      this._hourDigit.tabIndex = 0;
      this._colonEl = document.createElement("span");
      this._colonEl.className = "tp-colon";
      this._colonEl.textContent = ":";
      this._minuteDigit = document.createElement("span");
      this._minuteDigit.className = "tp-digit tp-minute-digit";
      this._minuteDigit.tabIndex = 0;
      this._ampmEl = document.createElement("span");
      this._ampmEl.className = "tp-ampm";

      display.appendChild(this._hourDigit);
      display.appendChild(this._colonEl);
      display.appendChild(this._minuteDigit);
      display.appendChild(this._ampmEl);

      // Click opens clock for corresponding mode; clicking same field again closes
      this._hourDigit.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this._open && this._mode === "hour") { closeActive(); return; }
        this._mode = "hour";
        this._openDropdown(this._hourDigit);
      });
      this._minuteDigit.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this._open && this._mode === "minute") { closeActive(); return; }
        this._mode = "minute";
        this._openDropdown(this._minuteDigit);
      });

      // Keyboard input on digits
      this._hourDigit.addEventListener("keydown", (e) => this._handleKey(e, "hour"));
      this._minuteDigit.addEventListener("keydown", (e) => this._handleKey(e, "minute"));

      this._hourDigit.addEventListener("focusin", () => { this._activeEditField = "hour"; });
      this._minuteDigit.addEventListener("focusin", () => { this._activeEditField = "minute"; });
      this._hourDigit.addEventListener("focusout", () => {
        this._activeEditField = null;
        this._backspaceBlank = false;
        this._commitEditField("hour");
        this._updateDisplay();
      });
      this._minuteDigit.addEventListener("focusout", () => {
        this._activeEditField = null;
        this._backspaceBlank = false;
        this._commitEditField("minute");
        this._updateDisplay();
      });

      const dropdown = document.createElement("div");
      dropdown.className = "tp-dropdown";
      document.body.appendChild(dropdown);

      wrapper.appendChild(display);

      this._input.parentNode.insertBefore(wrapper, this._input);
      wrapper.appendChild(this._input);

      this._wrapper = wrapper;
      this._display = display;
      this._dropdown = dropdown;
    }

    _handleKey(e, field) {
      if (e.key === "Escape") { closeActive(); return; }
      if (e.key === "Enter") { this._commitEditField(field); return; }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        this._keyBuffer = "";
        const def = parseHHMM(this._input.defaultValue);
        if (field === "hour") this._hour = def.h;
        else this._minute = def.m;
        this._backspaceBlank = true;
        const digit = field === "hour" ? this._hourDigit : this._minuteDigit;
        digit.textContent = "";
        this._syncToInput();
        if (this._open) { this._updateHand(); this._highlightSelected(); this._updateGhostHand(this._hour); }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (field === "hour") this._hour = (this._hour + 1) % 24;
        else this._minute = (this._minute + 1) % 60;
        this._syncToInput();
        this._updateDisplay();
        if (this._open) {
          this._updateHand();
          if (field === "hour") this._refreshHourLabels(); else this._highlightSelected();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (field === "hour") this._hour = (this._hour + 23) % 24;
        else this._minute = (this._minute + 59) % 60;
        this._syncToInput();
        this._updateDisplay();
        if (this._open) {
          this._updateHand();
          if (field === "hour") this._refreshHourLabels(); else this._highlightSelected();
        }
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        this._commitEditField(field);
        this._minuteDigit.focus();
        if (this._open) { this._mode = "minute"; this._renderClock(); this._highlightSelected(); this._updateDisplay(); this._positionDropdown(this._minuteDigit); }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        this._commitEditField(field);
        this._hourDigit.focus();
        if (this._open) { this._mode = "hour"; this._renderClock(); this._updateDisplay(); this._positionDropdown(this._hourDigit); }
        return;
      }
      if (e.key === "Tab") return;
      if (!/^\d$/.test(e.key)) { e.preventDefault(); return; }
      e.preventDefault();
      if (this._keyBuffer.length >= 2) return;
      this._backspaceBlank = false;
      this._keyBuffer += e.key;
      const digit = field === "hour" ? this._hourDigit : this._minuteDigit;
      digit.textContent = this._keyBuffer;
    }

    _commitEditField(field) {
      this._backspaceBlank = false;
      if (!this._keyBuffer) { this._updateDisplay(); return; }
      const max = field === "hour" ? 23 : 59;
      const val = Math.min(parseInt(this._keyBuffer, 10), max);
      if (field === "hour") this._hour = val;
      else this._minute = val;
      this._keyBuffer = "";
      this._syncToInput();
      this._updateDisplay();
      if (this._open) { this._updateHand(); this._highlightSelected(); this._updateGhostHand(this._hour); }
    }

    _updateDisplay() {
      const fmt = formatDisplay(this._hour, this._minute);
      const parts = fmt.text.split(":");
      const blankH = this._backspaceBlank && this._activeEditField === "hour";
      const blankM = this._backspaceBlank && this._activeEditField === "minute";
      if (!blankH && (this._activeEditField !== "hour" || this._open)) this._hourDigit.textContent = parts[0];
      if (!blankM && (this._activeEditField !== "minute" || this._open)) this._minuteDigit.textContent = parts[1];
      this._ampmEl.textContent = fmt.suffix;
      this._ampmEl.style.display = fmt.suffix ? "" : "none";

      this._hourDigit.classList.toggle("tp-active", this._open && this._mode === "hour");
      this._minuteDigit.classList.toggle("tp-active", this._open && this._mode === "minute");
    }

    _syncToInput() {
      const val = `${pad2(this._hour)}:${pad2(this._minute)}`;
      if (this._input.value !== val) {
        this._input.value = val;
        this._input.dataset.lastValidValue = val;
        this._input.dispatchEvent(new Event("input", { bubbles: true }));
        this._input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    _openDropdown(triggerEl) {
      if (activeInstance && activeInstance !== this) activeInstance.close();
      activeInstance = this;
      if (this._fadeTid) { clearTimeout(this._fadeTid); this._fadeTid = null; }
      this._open = true;
      this._handAngle = null;
      this._dropdown.classList.add("tp-open");
      document.body.classList.add("tp-open-backdrop");
      const _sbEl = document.getElementById("sidebar");
      if (_sbEl) {
        if (this._blurOverlay) {
          const _ol = this._blurOverlay;
          _ol.style.opacity = "0";
          requestAnimationFrame(() => { if (this._blurOverlay === _ol) _ol.style.opacity = "1"; });
        } else {
          const _r = _sbEl.getBoundingClientRect();
          const _ol = document.createElement("div");
          _ol.style.cssText = `position:fixed;left:${_r.left}px;top:${_r.top}px;width:${_r.width}px;height:${_r.height}px;backdrop-filter:blur(1.5px);-webkit-backdrop-filter:blur(1.5px);z-index:100;background:rgba(0,0,0,0.001);pointer-events:none;transition:opacity 250ms;opacity:0`;
          document.body.appendChild(_ol);
          this._blurOverlay = _ol;
          requestAnimationFrame(() => { if (this._blurOverlay === _ol) _ol.style.opacity = "1"; });
        }
      }
      const row = this._input.closest(".time-row");
      if (row) { row.classList.add("tp-open-row"); this._openRow = row; }
      const section = this._input.closest(".control-group");
      if (section) { section.classList.add("tp-open-section"); this._openSection = section; }
      if (!this._scrollLockEl) {
        const sidebar = document.getElementById("sidebar");
        if (sidebar) {
          this._scrollLockEl = sidebar;
          this._scrollLockTop = sidebar.scrollTop;
          const onWheel = (e) => { e.preventDefault(); };
          const onTouchMove = (e) => { e.preventDefault(); };
          this._scrollLockHandlers = { onWheel, onTouchMove };
          sidebar.addEventListener("wheel", onWheel, { passive: false });
          sidebar.addEventListener("touchmove", onTouchMove, { passive: false });
        }
      }
      this._positionDropdown(triggerEl);
      this._renderClock();
      if (this._mode === "minute") this._highlightSelected();
      this._updateDisplay();
      this._graceOpen = true;
      clearTimeout(this._graceTimer);
      this._graceTimer = setTimeout(() => { this._graceOpen = false; }, 500);
    }

    close() {
      this._open = false;
      this._dragging = false;
      this._prevAngle = null;
      this._handAngle = null;
      clearTimeout(this._graceTimer);
      this._graceOpen = false;
      this._clearBezelMark();
      this._selectedMarkIdx = null;
      this._dropdown.classList.remove("tp-open");
      document.body.classList.remove("tp-open-backdrop");
      if (this._fadeTid) { clearTimeout(this._fadeTid); this._fadeTid = null; }
      const _row = this._openRow;
      const _section = this._openSection;
      this._openRow = null;
      this._openSection = null;
      if (this._blurOverlay) {
        const _ol = this._blurOverlay;
        _ol.style.opacity = "0";
        this._fadeTid = setTimeout(() => {
          this._fadeTid = null;
          if (_ol.parentNode) _ol.parentNode.removeChild(_ol);
          if (this._blurOverlay === _ol) this._blurOverlay = null;
          if (_row) _row.classList.remove("tp-open-row");
          if (_section) _section.classList.remove("tp-open-section");
        }, 260);
      } else {
        if (_row) _row.classList.remove("tp-open-row");
        if (_section) _section.classList.remove("tp-open-section");
      }
      if (this._dropdown) { delete this._dropdown.dataset.tpState; }
      this._ghostHandEl = null;
      this._ghostPulseEl = null;
      this._ghostArrowEl = null;
      this._ghostBoundary = null;
      if (this._scrollLockEl) {
        const { onWheel, onTouchMove } = this._scrollLockHandlers || {};
        if (onWheel) this._scrollLockEl.removeEventListener("wheel", onWheel);
        if (onTouchMove) this._scrollLockEl.removeEventListener("touchmove", onTouchMove);
        this._scrollLockEl.scrollTop = this._scrollLockTop;
        this._scrollLockHandlers = null;
        this._scrollLockEl = null;
      }
      this._updateDisplay();
    }

    _positionDropdown(triggerEl) {
      if (window.innerWidth <= 600) {
        this._positionDropdownMobile(triggerEl);
      } else {
        this._positionDropdownDesktop(triggerEl);
      }
    }

    _positionDropdownMobile(triggerEl) {
      const dd = this._dropdown;
      const s = getUiScale();
      const ddH = CLOCK_SIZE * s;
      const ddW = CLOCK_SIZE * s;
      const sbEl = document.getElementById("sidebar");
      const sbRect = sbEl ? sbEl.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight * 0.45 };
      const tRect = triggerEl ? triggerEl.getBoundingClientRect() : { left: sbRect.left, top: sbRect.top, right: sbRect.left + 60, bottom: sbRect.top + 30 };
      const dCX = (tRect.left + tRect.right) / 2;
      const dCY = (tRect.top + tRect.bottom) / 2;
      const gap = Math.round(10 * s);
      const pad = 4;
      const clampL = (l) => Math.max(sbRect.left + pad, Math.min(l, sbRect.right - ddW - pad));
      const clampT = (t) => Math.max(sbRect.top + pad, Math.min(t, sbRect.bottom - ddH - pad));
      const centeredT = tRect.top + (tRect.height - ddH) / 2;
      const centeredL = tRect.left + (tRect.width - ddW) / 2;
      const candidates = [
        { l: clampL(tRect.right + gap),      t: clampT(centeredT) },
        { l: clampL(tRect.left - ddW - gap), t: clampT(centeredT) },
        { l: clampL(centeredL),              t: clampT(tRect.top - ddH - gap) },
        { l: clampL(centeredL),              t: clampT(tRect.bottom + gap) },
      ];
      let best = candidates[0], bestScore = Infinity;
      for (const c of candidates) {
        const dist = Math.hypot(c.l + ddW / 2 - dCX, c.t + ddH / 2 - dCY);
        const chartOver = Math.max(0, c.t + ddH - (sbRect.bottom - pad));
        const digOvX = Math.max(0, Math.min(c.l + ddW, tRect.right) - Math.max(c.l, tRect.left));
        const digOvY = Math.max(0, Math.min(c.t + ddH, tRect.bottom) - Math.max(c.t, tRect.top));
        const score = dist + chartOver * 1000 + digOvX * digOvY * 10;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      dd.style.left = `${best.l}px`;
      dd.style.top  = `${best.t}px`;
    }

    _positionDropdownDesktop(triggerEl) {
      const dd = this._dropdown;
      const s = getUiScale();
      const ddH = CLOCK_SIZE * s;
      const ddW = CLOCK_SIZE * s;
      const gap = Math.round(8 * s);
      const pad = 8;
      const dispRect = this._display.getBoundingClientRect();

      // Center X on the clicked digit; fall back to display center
      let left;
      if (triggerEl) {
        const tr = triggerEl.getBoundingClientRect();
        left = tr.left + tr.width / 2 - ddW / 2;
      } else {
        left = dispRect.left + dispRect.width / 2 - ddW / 2;
      }
      left = Math.max(pad, Math.min(left, window.innerWidth - ddW - pad));

      // Y: below the display bar if there is room, otherwise above it
      let top;
      if (window.innerHeight - dispRect.bottom >= ddH + gap) {
        top = dispRect.bottom + gap;
      } else {
        top = dispRect.top - ddH - gap;
      }
      top = Math.max(pad, top);

      dd.style.left = `${left}px`;
      dd.style.top  = `${top}px`;
    }

    _renderClock() {
      this._handAngle = null;
      this._clearBezelMark();
      this._selectedMarkIdx = null;
      const dd = this._dropdown;
      dd.innerHTML = "";

      const clock = document.createElement("div");
      clock.className = "tp-clock";
      this._clock = clock;

      const s = getUiScale();
      const size = CLOCK_SIZE * s;
      clock.style.width = `${size}px`;
      clock.style.height = `${size}px`;
      const cx = size / 2;
      const cy = size / 2;
      const numHalf = 13 * s;

      if (this._mode === "hour") {
        this._renderHourFace(clock, cx, cy, numHalf, s);
      } else {
        this._renderMinuteFace(clock, cx, cy, numHalf, s);
      }

      const hand = document.createElement("div");
      hand.className = "tp-hand";
      clock.appendChild(hand);
      this._hand = hand;

      const dot = document.createElement("div");
      dot.className = "tp-center-dot";
      clock.appendChild(dot);

      dd.appendChild(clock);
      this._updateHand();

      // Drag from anywhere on clock
      clock.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this._startDrag(e);
      });

      // Bezel mark tracking (minute mode)
      clock.addEventListener("pointermove", (e) => {
        if (this._mode !== "minute" || !this._minuteMarkEls || this._dragging) return;
        const idx = Math.round(getAngle(e, clock) / 6) % 60;
        this._setBezelMark(idx, e.target);
      });
      clock.addEventListener("pointerleave", () => {
        if (!this._dragging) {
          this._clearBezelMark();
          this._highlightSelected();
        }
      });
    }

    _renderHourFace(clock, cx, cy, numHalf, s) {
      this._ghostBoundary = null;
      this._ghostHandLen = null;
      const pulse = document.createElement("div");
      pulse.className = "tp-ghost-pulse";
      clock.appendChild(pulse);
      this._ghostPulseEl = pulse;

      const radius = Math.round(HALF_CLOCK * 0.80) * s;
      const labels = this._hourLabels();

      labels.forEach((num, i) => {
        const angle = (i * 30 - 90) * Math.PI / 180;
        const x = cx + radius * Math.cos(angle) - numHalf;
        const y = cy + radius * Math.sin(angle) - numHalf;
        const el = this._makeNumber(String(num), x, y);
        if (num === this._hour || (is12h() && (this._hour % 12 || 12) === num)) el.classList.add("tp-selected");
        clock.appendChild(el);
      });

      if (is12h()) {
        const ind = document.createElement("div");
        ind.className = "tp-pm-indicator";
        ind.textContent = this._hour >= 12 ? "PM" : "AM";
        clock.appendChild(ind);
      }

      const ghostHand = document.createElement("div");
      ghostHand.className = "tp-ghost-hand";
      clock.appendChild(ghostHand);
      this._ghostHandEl = ghostHand;

      this._dropdown.dataset.tpState = this._hour >= 12 ? "pm" : "am";
      this._updateGhostHand(this._hour);
    }

    _renderMinuteFace(clock, cx, cy, numHalf, s) {
      delete this._dropdown.dataset.tpState;
      const radius = Math.round(HALF_CLOCK * 0.80) * s;
      const markR = HALF_CLOCK * s;
      this._minuteMarkEls = [];

      for (let i = 0; i < 60; i++) {
        const mark = document.createElement("div");
        mark.className = "tp-minute-mark" + (i % 5 === 0 ? " tp-major" : "");
        const angleDeg = i * 6;
        const angleRad = (angleDeg - 90) * Math.PI / 180;
        const mx = cx + markR * Math.cos(angleRad);
        const my = cy + markR * Math.sin(angleRad);
        mark.style.left = `${mx - s}px`;
        mark.style.top = `${my - 3 * s}px`;
        mark.style.transform = `rotate(${angleDeg}deg)`;
        mark.style.transformOrigin = "center center";
        clock.appendChild(mark);
        this._minuteMarkEls.push(mark);
      }

      [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].forEach((num, i) => {
        const angle = (i * 30 - 90) * Math.PI / 180;
        const x = cx + radius * Math.cos(angle) - numHalf;
        const y = cy + radius * Math.sin(angle) - numHalf;
        const el = this._makeNumber(pad2(num), x, y);
        if (this._minute === num) el.classList.add("tp-selected");
        clock.appendChild(el);
      });
    }

    _startDrag(e) {
      if (this._backspaceBlank) {
        this._backspaceBlank = false;
        this._updateDisplay();
      }
      this._clearBezelMark();
      this._dragging = true;
      if (this._clock) this._clock.classList.add("tp-dragging");
      this._prevAngle = getAngle(e, this._clock);

      // Tap-to-select: minute mode number-label snaps on up; hour mode defers apply to up for long-arc
      const onNumber = this._mode === "minute" && e.target && e.target.classList.contains("tp-clock-number");
      const isHour = this._mode === "hour";
      if (!onNumber && !isHour) this._applyAngle(this._prevAngle);
      this._tapOriginOnNumber = onNumber ? parseInt(e.target.textContent, 10) : null;
      this._tapOriginX = e.clientX;
      this._tapOriginY = e.clientY;
      this._tapMoved = false;

      this._dragState = {
        tapAngle: this._prevAngle,
        isHour,
        savedHour: isHour ? this._hour : 0,
        savedHandAngle: isHour ? this._handAngle : null,
        hourDragStarted: false,
        pendingEv: null,
        rafId: null,
      };
      this._boundDragMove = (ev) => this._onDragMove(ev);
      this._boundDragUp = () => this._onDragUp();
      window.addEventListener("pointermove", this._boundDragMove);
      window.addEventListener("pointerup", this._boundDragUp);
    }

    _onDragMove(ev) {
      ev.preventDefault();
      const ds = this._dragState;
      if (Math.hypot(ev.clientX - this._tapOriginX, ev.clientY - this._tapOriginY) > 6) {
        this._tapMoved = true;
      }
      ds.pendingEv = ev;
      if (!ds.rafId) {
        ds.rafId = requestAnimationFrame(() => {
          ds.rafId = null;
          if (ds.pendingEv) {
            const angle = getAngle(ds.pendingEv, this._clock);
            if (ds.isHour && !ds.hourDragStarted) {
              ds.hourDragStarted = true;
              this._applyAngle(ds.tapAngle);
            }
            this._applyAngle(angle);
            this._prevAngle = angle;
            ds.pendingEv = null;
          }
        });
      }
    }

    _onDragUp() {
      const ds = this._dragState;
      if (ds.rafId) { cancelAnimationFrame(ds.rafId); ds.rafId = null; }
      this._dragging = false;
      if (this._clock) this._clock.classList.remove("tp-dragging");
      if (!this._tapMoved || (ds.isHour && !ds.hourDragStarted)) {
        if (this._tapOriginOnNumber != null) {
          this._minute = this._tapOriginOnNumber;
          this._syncToInput();
          this._updateDisplay();
          this._updateHand();
          this._highlightSelected();
        } else if (ds.isHour) {
          if (ds.hourDragStarted) {
            this._hour = ds.savedHour;
            if (ds.savedHandAngle !== null) this._handAngle = ds.savedHandAngle;
          }
          this._applyAngle(ds.tapAngle, true);
        }
      }
      this._tapOriginOnNumber = null;
      this._prevAngle = null;
      window.removeEventListener("pointermove", this._boundDragMove);
      window.removeEventListener("pointerup", this._boundDragUp);
      this._boundDragMove = null;
      this._boundDragUp = null;
      this._dragState = null;
    }

    _applyAngle(angle, fromTap = false) {
      if (this._mode === "hour") {
        this._applyHourAngle(angle, fromTap);
      } else {
        this._applyMinuteAngle(angle);
      }
    }

    _applyHourAngle(angle, fromTap = false) {
      const prevAngle = this._prevAngle;
      const newH12 = Math.round(angle / 30) % 12;
      const wasSecondHalf = this._hour >= 12;
      let newH = wasSecondHalf ? newH12 + 12 : newH12;

      // Detect crossing the 12/0 boundary (short path only, ±180°)
      if (prevAngle !== null) {
        const delta = angle - prevAngle;
        const wrapped = ((delta + 540) % 360) - 180;
        const prevSlot = Math.round(prevAngle / 30) % 12;
        if (prevSlot === 11 && newH12 <= 1 && wrapped > 0) {
          newH = wasSecondHalf ? newH12 : newH12 + 12;
        } else if (prevSlot <= 1 && newH12 === 11 && wrapped < 0) {
          newH = wasSecondHalf ? newH12 : newH12 + 12;
        }
      }

      if (newH >= 24) newH -= 24;
      if (newH < 0) newH += 24;
      if (newH !== this._hour) {
        const prevHalf = this._hour >= 12;
        this._hour = newH;
        this._syncToInput();
        this._updateDisplay();
        this._updateHand(fromTap);
        if ((this._hour >= 12) !== prevHalf) {
          this._refreshHourLabels();
        } else {
          this._highlightSelected();
          this._updateGhostHand(this._hour);
        }
      }
    }

    _applyMinuteAngle(angle) {
      const minute = Math.round(angle / 6) % 60;
      if (minute !== this._minute) {
        this._minute = minute;
        this._syncToInput();
        this._updateDisplay();
        this._updateHand();
        this._highlightSelected();
      }
    }

    _hourLabels() {
      if (is12h()) return [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      return this._hour >= 12
        ? [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
        : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    }

    _refreshHourLabels() {
      if (!this._clock) return;
      const labels = this._hourLabels();
      const nums = this._clock.querySelectorAll(".tp-clock-number");
      nums.forEach((el, i) => { el.textContent = String(labels[i]); });
      this._highlightSelected();
      const ind = this._clock.querySelector(".tp-pm-indicator");
      if (ind) ind.textContent = this._hour >= 12 ? "PM" : "AM";
      this._dropdown.dataset.tpState = this._hour >= 12 ? "pm" : "am";
      this._updateGhostHand(this._hour);
    }

    _highlightSelected() {
      if (!this._clock) return;
      const nums = this._clock.querySelectorAll(".tp-clock-number");
      for (const el of nums) {
        const val = parseInt(el.textContent, 10);
        if (this._mode === "minute") {
          el.classList.toggle("tp-selected", val === this._minute);
        } else if (is12h()) {
          el.classList.toggle("tp-selected", val === (this._hour % 12 || 12));
        } else {
          el.classList.toggle("tp-selected", val === this._hour);
        }
      }
      if (this._mode === "minute" && this._minuteMarkEls) {
        if (this._selectedMarkIdx != null) {
          this._minuteMarkEls[this._selectedMarkIdx].classList.remove("tp-bezel-active");
        }
        this._selectedMarkIdx = this._minute % 60;
        this._minuteMarkEls[this._selectedMarkIdx].classList.add("tp-bezel-active");
      }
    }

    _makeNumber(text, x, y) {
      const el = document.createElement("div");
      el.className = "tp-clock-number";
      el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      return el;
    }

    _updateHand(fromTap = false) {
      if (!this._hand) return;
      const s = getUiScale();
      const hourLen = Math.round(0.80 * HALF_CLOCK * s);
      const minLen  = hourLen;
      const length = this._mode === "hour" ? hourLen : minLen;

      if (this._mode === "minute") {
        // Direct angle: CSS transition animates the stored numeric value change,
        // so 354°→0° animates counterclockwise (long way) as expected.
        const angle = (this._minute / 60) * 360;
        if (this._handAngle === null) {
          this._handAngle = angle;
          this._hand.style.transition = "none";
          void this._hand.offsetHeight;
        } else {
          this._handAngle = angle;
          this._hand.style.transition = "transform 0.12s ease-out";
        }
      } else {
        const targetAngle = ((this._hour % 12) / 12) * 360;
        if (this._handAngle === null) {
          this._handAngle = targetAngle;
          this._hand.style.transition = "none";
          void this._hand.offsetHeight;
        } else {
          const curNorm = ((this._handAngle % 360) + 360) % 360;
          const shortDelta = ((targetAngle - curNorm + 540) % 360) - 180;
          const crossesTwelve = (curNorm + shortDelta >= 360) || (curNorm + shortDelta < 0);
          if (fromTap && crossesTwelve) {
            const longDelta = shortDelta > 0 ? shortDelta - 360 : shortDelta + 360;
            this._handAngle += longDelta;
            this._hand.style.transition = "transform 0.12s ease-out";
          } else {
            this._handAngle += shortDelta;
            this._hand.style.transition = "transform 0.12s ease-out";
          }
        }
      }
      this._hand.style.height = `${length}px`;
      this._hand.style.transform = `translateX(-50%) rotate(${this._handAngle}deg)`;
    }

    _setBezelMark(idx, target) {
      if (!this._minuteMarkEls) return;
      if (target && target.classList.contains("tp-clock-number")) {
        this._clearBezelMark();
        return;
      }
      if (idx === this._selectedMarkIdx) { this._clearBezelMark(); return; }
      if (this._hoverMarkIdx === idx) return;
      this._clearBezelMark();
      this._hoverMarkIdx = idx;
      this._minuteMarkEls[idx].classList.add("tp-bezel-hover");
    }

    _clearBezelMark() {
      if (this._hoverMarkIdx != null && this._minuteMarkEls) {
        this._minuteMarkEls[this._hoverMarkIdx].classList.remove("tp-bezel-hover");
        this._hoverMarkIdx = null;
      }
    }

    _updateGhostHand(hour) {
      if (!this._ghostHandEl || this._mode !== "hour") return;
      const h12 = hour % 12;
      const atBoundary = h12 === 11 || h12 === 0;

      if (!atBoundary) {
        if (this._ghostBoundary !== null) {
          this._ghostBoundary = null;
          this._ghostHandLen = null;
          this._clock.classList.remove("tp-ghost-active", "tp-ghost-at-11", "tp-ghost-at-12");
        }
        return;
      }

      const s = getUiScale();
      const handLen = Math.round(HALF_CLOCK * 0.80 * s);
      if (this._ghostHandLen !== handLen) {
        this._ghostHandLen = handLen;
        this._ghostHandEl.style.height = `${handLen}px`;
      }

      const boundary = h12 === 11 ? "11" : "0";
      if (this._ghostBoundary !== boundary) {
        this._ghostBoundary = boundary;
        if (h12 === 11) {
          this._clock.style.setProperty("--ghost-a", "330deg");
          this._clock.style.setProperty("--ghost-b", "360deg");
          this._clock.classList.add("tp-ghost-active", "tp-ghost-at-11");
          this._clock.classList.remove("tp-ghost-at-12");
        } else {
          this._clock.style.setProperty("--ghost-a", "0deg");
          this._clock.style.setProperty("--ghost-b", "-30deg");
          this._clock.classList.add("tp-ghost-active", "tp-ghost-at-12");
          this._clock.classList.remove("tp-ghost-at-11");
        }
      }
    }

    refresh() {
      _is12h = localStorage.getItem("clockFormat") === "12";
      const parsed = parseHHMM(this._input.value);
      this._hour = parsed.h;
      this._minute = parsed.m;
      this._updateDisplay();
      if (this._open) this._renderClock();
    }

    setEnabled(enabled) {
      this._wrapper.style.opacity = enabled ? "" : "0.5";
      this._wrapper.style.pointerEvents = enabled ? "" : "none";
      if (!enabled && this._open) this.close();
    }

    syncFromInput() {
      const parsed = parseHHMM(this._input.value);
      this._hour = parsed.h;
      this._minute = parsed.m;
      this._updateDisplay();
    }
  }

  window.TimePicker = TimePicker;
})();
