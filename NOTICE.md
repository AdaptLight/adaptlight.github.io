# Third-Party Notices

This project includes code derived from or inspired by the following open-source projects.

---

## sun.js

Ported from **astral** by Simon Kennedy.

- Source: <https://github.com/sffjunkie/astral>
- License: Apache License 2.0
- File: `docs/resources/sun.js`

Only the sunrise/sunset calculation functions were ported from Python to JavaScript. The rest of the astral library (moon phases, solar azimuth, etc.) is not included.

---

## chart-lite.js

Derived from **Chart.js** by Chart.js Contributors.

- Source: <https://github.com/chartjs/Chart.js>
- License: MIT License
- File: `docs/resources/chart-lite.js`

A lightweight reimplementation inspired by Chart.js's API structure. Significantly reduced in scope: only line charts with custom canvas rendering, hover trails, and a plugin system are retained. Most of Chart.js's original code has been rewritten.

---

## engine.js

Original code. Uses the following well-known public-domain algorithms:

- **Oklab color space** by Bjorn Ottosson (<https://bottosson.github.io/posts/oklab/>)
- **Kelvin-to-RGB conversion** by Tanner Helland (<https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html>)

These are mathematical formulas in the public domain with no license obligations.

---

## timepicker.js

Inspired by **clock-timepicker** by Lukas Blažauskas.

- Source: <https://github.com/luca-nicola/clock-timepicker>
- License: MIT License
- File: `docs/resources/timepicker.js`

The custom time picker was written from scratch. The clock-timepicker library was studied for analog clock face UX ideas but no code was ported.

---

## Material Design Icons Light (MDIL)

The overlay toggle icons (`overlayIconShow` and `overlayIconHide` SVG paths in `index.html`) are from Material Design Icons Light.

- Source: <https://pictogrammers.com/library/mdil/>
- License: Apache License 2.0 — <https://pictogrammers.com/docs/general/license/>
