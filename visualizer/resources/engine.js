const DAY_S = 86400;

function mod(n, m) {
  return ((n % m) + m) % m;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function timeToSeconds(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 3600 + m * 60;
}

function inCircularRange(now, start, end) {
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end;
}

function progress(now, start, end) {
  const elapsed = mod(now - start, DAY_S);
  const duration = mod(end - start, DAY_S);
  if (duration === 0) return 0;
  return clamp(elapsed / duration, 0, 1);
}

const TANH_A = (Math.atanh(2 * 0.95 - 1) - Math.atanh(2 * 0.05 - 1)) / 1.0;
const TANH_B = -Math.atanh(2 * 0.05 - 1) / TANH_A;

function tanhShape(t) {
  return 0.5 * (Math.tanh(TANH_A * (t - TANH_B)) + 1);
}

function interpolate(t, yStart, yEnd, curveType) {
  const shaped = curveType === "tanh" ? tanhShape(t) : t;
  return yStart + shaped * (yEnd - yStart);
}

function curveValueAt(now, ws, we, ds, de, minVal, maxVal, curveType) {
  if (inCircularRange(now, ws, we)) {
    const t = progress(now, ws, we);
    return interpolate(t, minVal, maxVal, curveType);
  }
  if (inCircularRange(now, we, ds)) {
    return maxVal;
  }
  if (inCircularRange(now, ds, de)) {
    const t = progress(now, ds, de);
    return interpolate(t, maxVal, minVal, curveType);
  }
  return minVal;
}

function applySunShift(ws, we, ds, de, sunriseS, sunsetS, strength) {
  const wakeDur = mod(we - ws, DAY_S);
  const wakeHalf = wakeDur / 2;
  const configWakeMid = mod(ws + wakeHalf, DAY_S);
  const sunWakeMid = configWakeMid + (sunriseS - configWakeMid) * strength;
  const newWs = mod(sunWakeMid - wakeHalf, DAY_S);
  const newWe = mod(sunWakeMid + wakeHalf, DAY_S);

  const dozeDur = mod(de - ds, DAY_S);
  const dozeHalf = dozeDur / 2;
  const configDozeMid = mod(ds + dozeHalf, DAY_S);
  const sunDozeMid = configDozeMid + (sunsetS - configDozeMid) * strength;
  const newDs = mod(sunDozeMid - dozeHalf, DAY_S);
  const newDe = mod(sunDozeMid + dozeHalf, DAY_S);

  return { ws: newWs, we: newWe, ds: newDs, de: newDe };
}

function applyLux(curveBrightness, currentLux, effectiveMax, strength, minB, maxB) {
  if (effectiveMax <= 0) return curveBrightness;
  const luxRatio = clamp(currentLux / effectiveMax, 0, 1);
  const multiplier = 1 - strength + strength * luxRatio;
  return clamp(curveBrightness * multiplier, minB, maxB);
}

function rgbToHs(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s };
}

function hsToRgb(h, s) {
  const v = 1;
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

function shortestHueLerp(hStart, hEnd, t) {
  const diff = mod(hEnd - hStart + 180, 360) - 180;
  return mod(hStart + t * diff, 360);
}

// Linear HSV interpolation on an already-shaped progress value.
// curveValueAt already applies tanh when curve_type="tanh",
// so this function must NOT re-apply it.
function rgbColorAtLinear(shapedProgress, startHex, endHex) {
  const t = clamp(shapedProgress, 0, 1);
  const hsStart = rgbToHs(startHex);
  const hsEnd = rgbToHs(endHex);
  const h = shortestHueLerp(hsStart.h, hsEnd.h, t);
  const s = hsStart.s + t * (hsEnd.s - hsStart.s);
  return hsToRgb(h, s);
}

function kelvinToRgb(kelvin) {
  const temp = kelvin / 100;
  let r, g, b;
  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }
  r = clamp(Math.round(r), 0, 255);
  g = clamp(Math.round(g), 0, 255);
  b = clamp(Math.round(b), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function generateCurveData(params) {
  const POINTS = 1440;
  const step = DAY_S / POINTS;

  let bws = timeToSeconds(params.wakeStart);
  let bwe = timeToSeconds(params.wakeEnd);
  let bds = timeToSeconds(params.dozeStart);
  let bde = timeToSeconds(params.dozeEnd);

  let cws, cwe, cds, cde;
  if (params.syncCurves) {
    cws = bws; cwe = bwe; cds = bds; cde = bde;
  } else {
    cws = timeToSeconds(params.colorWakeStart);
    cwe = timeToSeconds(params.colorWakeEnd);
    cds = timeToSeconds(params.colorDozeStart);
    cde = timeToSeconds(params.colorDozeEnd);
  }

  if (params.sunShiftEnabled) {
    const sunriseS = timeToSeconds(params.sunrise);
    const sunsetS = timeToSeconds(params.sunset);
    const str = params.sunShiftStrength;
    const bShifted = applySunShift(bws, bwe, bds, bde, sunriseS, sunsetS, str);
    bws = bShifted.ws; bwe = bShifted.we; bds = bShifted.ds; bde = bShifted.de;
    if (params.syncCurves) {
      cws = bws; cwe = bwe; cds = bds; cde = bde;
    } else {
      const cShifted = applySunShift(cws, cwe, cds, cde, sunriseS, sunsetS, str);
      cws = cShifted.ws; cwe = cShifted.we; cds = cShifted.ds; cde = cShifted.de;
    }
  }

  const labels = [];
  const brightness = [];
  const colorTemp = [];
  const colorHex = [];

  for (let i = 0; i < POINTS; i++) {
    const now = i * step;
    const h = Math.floor(now / 3600);
    const m = Math.floor((now % 3600) / 60);
    labels.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

    let bVal = curveValueAt(now, bws, bwe, bds, bde,
      params.minBrightness, params.maxBrightness, params.curveType);

    if (params.luxEnabled) {
      bVal = applyLux(bVal, params.currentLux, params.effectiveMax,
        params.luxStrength, params.minBrightness, params.maxBrightness);
    }

    brightness.push(bVal);

    if (params.useRgbColor) {
      // Per FORMULAS.md section 4: color_progress uses full 4-segment curve
      // with min=0, max=1. Tanh shaping is applied inside curveValueAt.
      const colorProg = curveValueAt(now, cws, cwe, cds, cde, 0, 1, params.curveType);
      const hex = rgbColorAtLinear(colorProg, params.rgbStartColor, params.rgbEndColor);
      colorHex.push(hex);
      colorTemp.push(null);
    } else {
      const cVal = curveValueAt(now, cws, cwe, cds, cde,
        params.minColorTemp, params.maxColorTemp, params.curveType);
      colorTemp.push(cVal);
      colorHex.push(kelvinToRgb(cVal));
    }
  }

  return { labels, brightness, colorTemp, colorHex };
}
