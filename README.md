# Traverse Widget for ArcGIS Experience Builder

A COGO traverse widget for ArcGIS Experience Builder. Enter survey courses by bearing and distance, or by curve, and the widget draws the traverse on the map with leg labels and a closure report.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

- **Authors:** Eric McAvoy and Nicholas Cramer (Polk County, Oregon)
- **Requires:** ArcGIS Experience Builder Developer Edition 1.21, on a Web Mercator map. All geometry is computed in Web Mercator map units.

## Installation

Download `traverse.zip` from the [latest release](https://github.com/ncramer11/traverse/releases/latest) and extract it, or clone this repo and take the [`traverse/`](traverse) folder. Copy it into your Experience Builder install:

```
<ArcGISExperienceBuilder>/client/your-extensions/widgets/traverse
```

`manifest.json` must sit directly inside `traverse/`. Nesting it a second level deep is the usual cause of the widget not registering.

Restart the client and refresh the Builder window. The widget appears under **Insert Widget > Custom**. There are no npm dependencies, so there is nothing else to install.

## Features

- Bearing and distance entry in quadrant (N 45°30'00" E) or azimuth format, with cardinal shortcuts and 10-key friendly navigation.
- Curve courses by radius and left or right direction, entered as either arc length or chord length. Curves draw as true arcs.
- Per-course distance units (feet, chains, meters, rods), so mixed-unit deed calls need no conversion.
- Live redraw as you type.
- Click-to-draw on the map, start point picking, and a two-point inverse readout, all with snapping to visible map features.
- Traverse rotation with a live preview and an optional custom pivot.
- Closure report with precision ratio, total distance, and enclosed area.
- Export to GeoJSON, or to an [Esri traverse file](https://doc.esri.com/en/arcgis-pro/latest/help/editing/traverse-file-format.html) that ArcGIS Pro can load. Traverse files saved from Pro or ArcMap can be imported. That format records no distance unit, so courses are written and read in the unit selected in the widget, which the panel states.
- Optional popup suppression while drafting, so map clicks do not open identify popups.

## Settings

Select the map widget, the default bearing format (quadrant or azimuth), and the default distance unit. Individual courses can override the unit.

## Feedback

Please report bugs and enhancement requests in the [Issues](https://github.com/ncramer11/traverse/issues) tab.

## License

[Apache License 2.0](LICENSE). Copyright Polk County, Oregon.
