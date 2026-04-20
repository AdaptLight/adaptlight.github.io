// Minimal sunrise/sunset calculator ported from Python astral 3.2.
// Only the functions needed for sunrise() and sunset() are included.
// Input: latitude (°N positive), longitude (°E positive), Date object.
// Output: { sunrise: "HH:MM", sunset: "HH:MM" } in local time, or null on failure.

var SunCalc = (() => {
  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;
  var SUN_APPARENT_RADIUS = 32 / (60 * 2);

  function julianDay(date) {
    var y = date.getUTCFullYear();
    var m = date.getUTCMonth() + 1;
    var d = date.getUTCDate();
    var frac = (date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()) / 86400;
    if (m <= 2) { y--; m += 12; }
    var a = Math.floor(y / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + frac + b - 1524.5;
  }

  function jdToJC(jd) { return (jd - 2451545) / 36525; }

  function geomMeanLongSun(jc) { return (280.46646 + jc * (36000.76983 + 0.0003032 * jc)) % 360; }
  function geomMeanAnomalySun(jc) { return 357.52911 + jc * (35999.05029 - 0.0001537 * jc); }
  function eccentricityEarthOrbit(jc) { return 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc); }

  function sunEqOfCenter(jc) {
    var mr = geomMeanAnomalySun(jc) * RAD;
    return Math.sin(mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
         + Math.sin(2 * mr) * (0.019993 - 0.000101 * jc)
         + Math.sin(3 * mr) * 0.000289;
  }

  function sunApparentLong(jc) {
    var trueLong = geomMeanLongSun(jc) + sunEqOfCenter(jc);
    return trueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * jc) * RAD);
  }

  function meanObliquityOfEcliptic(jc) {
    var sec = 21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813));
    return 23 + (26 + sec / 60) / 60;
  }

  function obliquityCorrection(jc) {
    return meanObliquityOfEcliptic(jc) + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * RAD);
  }

  function sunDeclination(jc) {
    var e = obliquityCorrection(jc) * RAD;
    var al = sunApparentLong(jc) * RAD;
    return Math.asin(Math.sin(e) * Math.sin(al)) * DEG;
  }

  function eqOfTime(jc) {
    var l0 = geomMeanLongSun(jc) * RAD;
    var e = eccentricityEarthOrbit(jc);
    var m = geomMeanAnomalySun(jc) * RAD;
    var y = Math.tan(obliquityCorrection(jc) * RAD / 2);
    y *= y;
    return (y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0)
            - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m)) * DEG * 4;
  }

  function refractionAtZenith(zenith) {
    var elev = 90 - zenith;
    if (elev >= 85) return 0;
    var te = Math.tan(elev * RAD);
    var corr;
    if (elev > 5) {
      corr = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / te ** 5;
    } else if (elev > -0.575) {
      corr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    } else {
      corr = -20.774 / te;
    }
    return corr / 3600;
  }

  function hourAngle(lat, decl, zenith, rising) {
    var h = (Math.cos(zenith * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD))
            / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
    if (h < -1 || h > 1) return null;
    var ha = Math.acos(h);
    return rising ? ha : -ha;
  }

  function timeOfTransit(lat, lon, date, zenith, rising) {
    if (lat > 89.8) lat = 89.8;
    else if (lat < -89.8) lat = -89.8;
    var refr = refractionAtZenith(zenith);
    var jd = julianDay(date);
    var adj = 0, timeUTC = 0;
    var jc, decl, ha, delta, offset;
    for (var i = 0; i < 2; i++) {
      jc = jdToJC(jd + adj);
      decl = sunDeclination(jc);
      ha = hourAngle(lat, decl, zenith + refr, rising);
      if (ha === null) return null;
      delta = -lon - ha * DEG;
      offset = delta * 4 - eqOfTime(jc);
      if (offset < -720) offset += 1440;
      timeUTC = 720 + offset;
      adj = timeUTC / 1440;
    }
    return timeUTC;
  }

  function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }

  function minutesToHHMM(minutes, tzOffsetMinutes) {
    var m = minutes + tzOffsetMinutes;
    m = ((m % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60);
    var min = Math.round(m - h * 60);
    if (min === 60) { min = 0; h++; }
    if (h >= 24) h -= 24;
    return `${pad2(h)}:${pad2(min)}`;
  }

  function calculate(lat, lon, date) {
    var zenith = 90 + SUN_APPARENT_RADIUS;
    var tzOffsetMinutes = -date.getTimezoneOffset();
    var utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var riseUTC = timeOfTransit(lat, lon, utcDate, zenith, true);
    var setUTC = timeOfTransit(lat, lon, utcDate, zenith, false);
    if (riseUTC === null || setUTC === null) return null;
    return {
      sunrise: minutesToHHMM(riseUTC, tzOffsetMinutes),
      sunset: minutesToHHMM(setUTC, tzOffsetMinutes),
    };
  }

  return { calculate: calculate };
})();
