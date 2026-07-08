# Traverse Widget for ArcGIS Experience Builder

A COGO traverse widget for ArcGIS Experience Builder. Enter survey courses by bearing and distance (or curve arc data) and the widget draws the traverse on the map, complete with a closure report, per-course distance units, on-map click-to-draw with snapping, traverse rotation, and GeoJSON export.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

- **Authors:** Eric McAvoy and Nicholas Cramer (Polk County, Oregon)
- **Built and tested on:** ArcGIS Experience Builder Developer Edition 1.20

> The widget folder itself lives in [`traverse/`](traverse). This repo wraps it with project files (license, this readme) so it works for both downloading a release and cloning.

<!-- Tip: add a screenshot or GIF of the widget here to give people a quick visual. -->

## Getting the widget

There are two ways to get it. Both end with you placing a `traverse` folder into your Experience Builder install.

### Option 1: Download a release (recommended)

1. Go to the [Releases](https://github.com/ncramer11/traverse/releases) page.
2. Under the latest release, download the `traverse.zip` asset.
3. Extract it. You will get a `traverse` folder.

### Option 2: Clone or download the repo

```bash
git clone https://github.com/ncramer11/traverse.git
```

Or use the green **Code** button above and choose **Download ZIP**. The `traverse` folder is inside.

## Installation

1. Copy the `traverse` folder into your Experience Builder install:

   ```
   <ArcGISExperienceBuilder>/client/your-extensions/widgets/traverse
   ```

   Keep `manifest.json` directly inside `traverse/`, not nested a second level deep. Nesting is the usual cause of the widget not registering.

2. Start (or restart) the client and refresh the Builder window. The widget appears under **Insert Widget > Custom**.

The widget has no external npm dependencies, so no additional install step is needed.

## Requirements

- ArcGIS Experience Builder Developer Edition 1.20 (the build and test target). Earlier editions may work but are untested.

## Features

- Course entry by bearing and distance, with quadrant (N 45°30'00" E) and azimuth bearing formats.
- Curve courses: enter a radius and left/right direction, and curves render as true arcs on the map. The closure report follows standard COGO practice (arc length for total distance, chord for departure/latitude).
- Per-course distance units (feet, chains, meters, rods) with a global default/report unit, so mixed-unit deed calls can be entered without conversion.
- Live redraw as you type, so the traverse updates on the map while you enter courses.
- On-map click-to-draw: click vertices on the map and the widget derives the bearing and distance for each course, with snapping to visible map features.
- Start point picking on the map, also with snapping.
- Traverse rotation with a live preview and an optional custom pivot point.
- Closure report with precision ratio, total distance, and enclosed area.
- GeoJSON export (points, lines, and polygon). Curves export as densified geometry, so exported lines actually curve rather than cutting across the chord.
- On-map color picker and keyboard navigation for fast course entry.
- Optional popup suppression while drafting a traverse, so map clicks do not open identify popups.

## Settings

In the widget settings panel you can select the map widget, set the default bearing format (quadrant or azimuth), and set the default distance unit (feet, chains, or meters). Individual courses can override the default unit.

## Feedback and issues

Please report bugs and enhancement requests in this repo's [Issues](https://github.com/ncramer11/traverse/issues) tab.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright Polk County, Oregon.
