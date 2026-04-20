/** biome-ignore-all lint/correctness/noUnusedVariables: wrong in context */
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
  if (duration === 0) return 1;
  return clamp(elapsed / duration, 0, 1);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function smoothstep2(t) {
  return smoothstep(smoothstep(t));
}

function easeIn(t) {
  return t * t;
}

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

function shapeCurve(t, curveType) {
  if (curveType === "smooth") return smoothstep(t);
  if (curveType === "steep") return smoothstep2(t);
  if (curveType === "ease_in") return easeIn(t);
  if (curveType === "ease_out") return easeOut(t);
  return t;
}

function interpolate(t, yStart, yEnd, curveType) {
  const shaped = shapeCurve(t, curveType);
  return yStart + shaped * (yEnd - yStart);
}

const EASE_DOZE_FLIP = { ease_in: "ease_out", ease_out: "ease_in" };

function resolveEaseForDoze(curveType) {
  return EASE_DOZE_FLIP[curveType] || curveType;
}

function curveValueAt(now, ws, we, ds, de, minVal, maxVal, curveType) {
  // Detect backwards ramps: forward duration > 12h means user intended
  // the short arc in reverse direction
  let wakeRev = false;
  let dozeRev = false;

  if (mod(we - ws, DAY_S) > DAY_S / 2) {
    [ws, we] = [we, ws];
    wakeRev = true;
  }
  if (mod(de - ds, DAY_S) > DAY_S / 2) {
    [ds, de] = [de, ds];
    dozeRev = true;
  }

  const boundaries = [
    { s: ws, seg: "wake" },
    { s: we, seg: "hold_wake" },
    { s: ds, seg: "doze" },
    { s: de, seg: "hold_doze" },
  ];
  let best = "hold_doze";
  let bestElapsed = DAY_S;
  for (const { s, seg } of boundaries) {
    const elapsed = mod(now - s, DAY_S);
    if (elapsed < bestElapsed) {
      bestElapsed = elapsed;
      best = seg;
    }
  }

  if (best === "wake") {
    const t = progress(now, ws, we);
    const from = wakeRev ? maxVal : minVal;
    const to = wakeRev ? minVal : maxVal;
    return interpolate(t, from, to, curveType);
  }
  if (best === "hold_wake") {
    return wakeRev ? minVal : maxVal;
  }
  if (best === "doze") {
    const t = progress(now, ds, de);
    const from = dozeRev ? minVal : maxVal;
    const to = dozeRev ? maxVal : minVal;
    return interpolate(t, from, to, resolveEaseForDoze(curveType));
  }
  return dozeRev ? maxVal : minVal;
}

function applySunShift(ws, we, ds, de, sunriseS, sunsetS, strength) {
  // Normalize backwards ramps for correct midpoint/duration math
  const wakeRev = mod(we - ws, DAY_S) > DAY_S / 2;
  const dozeRev = mod(de - ds, DAY_S) > DAY_S / 2;
  if (wakeRev) [ws, we] = [we, ws];
  if (dozeRev) [ds, de] = [de, ds];

  const wakeDur = mod(we - ws, DAY_S);
  const wakeHalf = wakeDur / 2;
  const configWakeMid = mod(ws + wakeHalf, DAY_S);
  const sunWakeMid = configWakeMid + (sunriseS - configWakeMid) * strength;
  let newWs = mod(sunWakeMid - wakeHalf, DAY_S);
  let newWe = mod(sunWakeMid + wakeHalf, DAY_S);

  const dozeDur = mod(de - ds, DAY_S);
  const dozeHalf = dozeDur / 2;
  const configDozeMid = mod(ds + dozeHalf, DAY_S);
  const sunDozeMid = configDozeMid + (sunsetS - configDozeMid) * strength;
  let newDs = mod(sunDozeMid - dozeHalf, DAY_S);
  let newDe = mod(sunDozeMid + dozeHalf, DAY_S);

  // Restore reversed order so curveValueAt can detect the reversal
  if (wakeRev) [newWs, newWe] = [newWe, newWs];
  if (dozeRev) [newDs, newDe] = [newDe, newDs];

  return { ws: newWs, we: newWe, ds: newDs, de: newDe };
}

function applyLux(curveBrightness, currentLux, effectiveMax, strength, minB, maxB) {
  if (effectiveMax <= 0) return curveBrightness;
  const luxRatio = clamp(currentLux / effectiveMax, 0, 1);
  const multiplier = 1 - strength + strength * luxRatio;
  const lo = Math.min(minB, maxB);
  const hi = Math.max(minB, maxB);
  return clamp(curveBrightness * multiplier, lo, hi);
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1.0 / 2.4)) - 0.055;
}

function rgbToOklab(r, g, b) {
  const rl = srgbToLinear(r / 255);
  const gl = srgbToLinear(g / 255);
  const bl = srgbToLinear(b / 255);

  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rl = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gl = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  const r = clamp(Math.round(linearToSrgb(clamp(rl, 0, 1)) * 255), 0, 255);
  const g = clamp(Math.round(linearToSrgb(clamp(gl, 0, 1)) * 255), 0, 255);
  const bOut = clamp(Math.round(linearToSrgb(clamp(bl, 0, 1)) * 255), 0, 255);
  return [r, g, bOut];
}

function rgbToHex(r, g, b) {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function enforceFullBrightness(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  if (mx === 0) return "#ffffff";
  return rgbToHex(
    clamp(Math.round((r / mx) * 255), 0, 255),
    clamp(Math.round((g / mx) * 255), 0, 255),
    clamp(Math.round((b / mx) * 255), 0, 255),
  );
}

function lerpRgb(shapedProgress, startHex, endHex) {
  const t = clamp(shapedProgress, 0, 1);
  const sr = parseInt(startHex.slice(1, 3), 16);
  const sg = parseInt(startHex.slice(3, 5), 16);
  const sb = parseInt(startHex.slice(5, 7), 16);
  const er = parseInt(endHex.slice(1, 3), 16);
  const eg = parseInt(endHex.slice(3, 5), 16);
  const eb = parseInt(endHex.slice(5, 7), 16);

  const [L1, a1, b1] = rgbToOklab(sr, sg, sb);
  const [L2, a2, b2] = rgbToOklab(er, eg, eb);

  const [r, g, bVal] = oklabToRgb(
    L1 + t * (L2 - L1),
    a1 + t * (a2 - a1),
    b1 + t * (b2 - b1),
  );
  return rgbToHex(r, g, bVal);
}

function kelvinToRgb(kelvin) {
  const temp = kelvin / 100;
  let r, g, b;
  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * ((temp - 60) ** -0.1332047592);
    g = 288.1221695283 * ((temp - 60) ** -0.0755148492);
    b = 255;
  }
  return rgbToHex(
    clamp(Math.round(r), 0, 255),
    clamp(Math.round(g), 0, 255),
    clamp(Math.round(b), 0, 255),
  );
}

function generateCurveData(params) {
  const B_POINTS = 1440;
  const C_POINTS = 4320;
  const bStep = DAY_S / B_POINTS;
  const cStep = DAY_S / C_POINTS;

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

  for (let i = 0; i < B_POINTS; i++) {
    const now = i * bStep;
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
  }

  const colorHex = [];
  const startHex = params.useRgbColor ? enforceFullBrightness(params.rgbStartColor) : null;
  const endHex = params.useRgbColor ? enforceFullBrightness(params.rgbEndColor) : null;

  const startOklab = startHex ? rgbToOklab(
    parseInt(startHex.slice(1, 3), 16),
    parseInt(startHex.slice(3, 5), 16),
    parseInt(startHex.slice(5, 7), 16),
  ) : null;
  const endOklab = endHex ? rgbToOklab(
    parseInt(endHex.slice(1, 3), 16),
    parseInt(endHex.slice(3, 5), 16),
    parseInt(endHex.slice(5, 7), 16),
  ) : null;

  for (let i = 0; i < C_POINTS; i++) {
    const now = i * cStep;
    if (params.useRgbColor) {
      const t = clamp(curveValueAt(now, cws, cwe, cds, cde, 0, 1, params.curveType), 0, 1);
      const [r, g, bVal] = oklabToRgb(
        startOklab[0] + t * (endOklab[0] - startOklab[0]),
        startOklab[1] + t * (endOklab[1] - startOklab[1]),
        startOklab[2] + t * (endOklab[2] - startOklab[2]),
      );
      colorHex.push(rgbToHex(r, g, bVal));
    } else {
      const cVal = curveValueAt(now, cws, cwe, cds, cde,
        params.minColorTemp, params.maxColorTemp, params.curveType);
      colorHex.push(kelvinToRgb(cVal));
    }
  }

  return { labels, brightness, colorHex };
}
