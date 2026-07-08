# traverse
A custom widget for ArcGIS Experience Builder Developer Edition.

**Purpose:** COGO traverse entry widget. Users enter a series of courses (bearing + distance, or curve arc data) to draw a traverse polygon on the map. Features include live debounced redraw, quadrant-number bearing format, GeoJSON export, on-map color picker, keyboard navigation, per-course distance units, on-map click-to-draw with snapping, traverse rotation, and curve course support.

**Per-course distance units:**
- `TraverseCourse` carries `{ type, bearing, distance, unit: DistanceUnit, radius?, curveDirection? }`. Each row has its own unit dropdown (ft / ch / m / rd).
- The global selector is the **"Default / Report Unit"**: it sets the unit for newly added rows and controls the closure report summary. Individual courses can freely override it, so mixed-unit deed calls can be entered without conversion.
- All geometry math (`_liveRedraw`, `_drawTraverse`), closure report, and GeoJSON export follow `course.unit`. The GeoJSON `totalDistance` property sums all courses in meters then converts to the report unit.

**Curve courses:**
- `TraverseCourse.type` is `'line' | 'curve'`. A curve row expands to show a radius input and a Left/Right direction toggle.
- All geometry, closure, highlight, and GeoJSON export paths go through `resolveCourseStep()`, which returns the chord bearing and chord length for a curve (what separates PC from PT) plus `arcMeters` (the traveled arc length) for perimeter totals. The closure report uses `arcMeters` for total distance but `stepMeters` (chord) for departure/latitude math — matching standard COGO practice.
- `computeCurvePoints()` interpolates 24 arc segments for rendering and GeoJSON export (`densePoints`), so exported LineStrings and Polygons actually curve rather than cutting straight across the chord. The Points export uses the chord endpoints (PC/PT) only.
- Curve lines render with `style: 'dash-dot'`; straight lines use `style: 'dash'` — visually distinguishable on the map.

**Snapping:**
- All three pick modes (start point, rotation pivot, course-drawing vertices) use a shared `SketchViewModel` (`_snapSVM`) backed by a scratch graphics layer (`_snapScratchLayer`). This replaces the old `view.on('click')` approach.
- `_activePickMode: 'start' | 'rotation' | 'draw' | null` tracks which pick is in progress. `_handleSnapCreateEvent()` routes completed picks to the correct handler and re-arms the SVM for the next course-drawing vertex.
- A "Snap to Map Features" checkbox toggles `snappingOptions.enabled`. Feature sources are rebuilt from visible map layers before each pick via `_applySnapSources()`.
- Esc cancels the SVM natively (no separate key handler needed). The cancel event routes through `_handleSnapCreateEvent` and calls `_finishDrawingCourses()` for draw mode, or cleans up start/rotation picks.
- `_snapSVM.destroy()` is called in `componentWillUnmount`. `_snapScratchLayer` is removed from the map alongside the other traverse layers.

**On-map click-to-draw:**
- "Draw Courses on Map" enters `isDrawingCourses` mode (crosshair cursor, popup suppressed via `_syncPopup`).
- The first click sets the start point if one is not already set. Each subsequent click calls `computeAzimuthAndDistance()` (inverse of `computeNextPoint`) to derive bearing and distance from the previous vertex, then `formatBearingForEntry()` to serialize the azimuth into the active bearing format, and appends the result (or fills an empty trailing row) in state.
- Clicks are handled via the snapping SVM (`_snapSVM.create('point')`), re-armed after each completed point by `_handleSnapCreateEvent`. Esc or "Finish Drawing" exits via `_finishDrawingCourses()`.

**Traverse rotation:**
- The "Rotate Traverse" section has a degree offset input (positive = CW, negative = CCW). The preview is live: `rotationOffset` participates in `geometryChanged`, so `_liveRedraw` renders the rotated geometry as the user types.
- An optional "Set Rotation Point" picker places a custom pivot on the map, shown as a purple diamond marker on `_pivotLayer` (a dedicated `GraphicsLayer` added on top of the stack). Default pivot is the start point.
- "Apply Rotation" commits: rewrites every parseable course's bearing via `rotateAzimuth()` and, if the pivot is not the start point, moves the start point via `rotatePointAround()`. Rows that do not currently parse (empty/incomplete) are left untouched, then `rotationOffset` is reset to `''`.
- `_pivotLayer` must be added, removed, and cleared alongside the other traverse layers — see `_initLayers`, `componentWillUnmount`, and `_clearAll`.

**Popup coordination:**
- A toggle lets the user disable map identify popups while drafting a traverse.
- `_syncPopup(popupEnabledByUser, isPicking)` is the **only** place in the widget that writes `view.popupEnabled`. Never write it directly elsewhere in the widget. The `isPicking` flag is `true` during start-point picking, course drawing, and rotation-pivot picking — all three modes suppress the popup.
- While picking a start point, popups are suppressed and restored via `setTimeout(..., 0)` (defers past the pick click's own event processing).
- On `componentWillUnmount`, restores `view.popupEnabled = true`.

---
