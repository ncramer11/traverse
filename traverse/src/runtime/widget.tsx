import { React, type AllWidgetProps } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView, loadArcGISJSAPIModules } from 'jimu-arcgis'
import type { BearingFormat, DistanceUnit, IMConfig } from '../config'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'calcite-button': any
      'calcite-select': any
      'calcite-option': any
    }
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNIT_TO_METERS: Record<string, number> = { feet: 0.3048, chains: 20.1168, meters: 1.0, rods: 5.0292 }
const R_EARTH = 6378137

// ---------------------------------------------------------------------------
// Bearing parsing helpers
// ---------------------------------------------------------------------------

function parseQuadrantBearing (input: string): number | null {
  if (!input) return null
  const str = input.trim().toUpperCase()
    .replace(/[°'"]+/g, ' ')
    .replace(/[-,]+/g, ' ')
    .replace(/\s+/g, ' ')
  // Cardinal direction shortcuts: N=0°, E=90°, S=180°, W=270°
  if (str === 'N') return 0
  if (str === 'E') return 90
  if (str === 'S') return 180
  if (str === 'W') return 270
  const m = str.match(/^([NS])\s*([\d.]+)\s*([\d.]*)\s*([\d.]*)\s*([EW])$/)
  if (!m) return null
  const ns = m[1], d = parseFloat(m[2] || '0'), min = parseFloat(m[3] || '0'), sec = parseFloat(m[4] || '0'), ew = m[5]
  const dd = d + min / 60 + sec / 3600
  if (dd < 0 || dd > 90) return null
  if (ns === 'N' && ew === 'E') return dd
  if (ns === 'S' && ew === 'E') return 180 - dd
  if (ns === 'S' && ew === 'W') return 180 + dd
  if (ns === 'N' && ew === 'W') return 360 - dd
  return null
}

function parseQuadrantNumberBearing (quadrant: number, angleStr: string): number | null {
  if (quadrant < 1 || quadrant > 4) return null
  if (!angleStr) return null
  const str = angleStr.trim()
    .replace(/[°'"]+/g, ' ')
    .replace(/[-,]+/g, ' ')
    .replace(/\s+/g, ' ')
  const parts = str.split(' ')
  const d   = parseFloat(parts[0] || '0')
  const min = parseFloat(parts[1] || '0')
  const sec = parseFloat(parts[2] || '0')
  if (isNaN(d)) return null
  const dd = d + (isNaN(min) ? 0 : min) / 60 + (isNaN(sec) ? 0 : sec) / 3600
  if (dd < 0 || dd > 90) return null
  if (quadrant === 1) return dd
  if (quadrant === 2) return 180 - dd
  if (quadrant === 3) return 180 + dd
  if (quadrant === 4) return 360 - dd
  return null
}

function parseAzimuth (input: string): number | null {
  if (!input) return null
  const upper = input.trim().toUpperCase()
  if (upper === 'N') return 0
  if (upper === 'E') return 90
  if (upper === 'S') return 180
  if (upper === 'W') return 270
  const val = parseFloat(input)
  if (isNaN(val) || val < 0 || val >= 360) return null
  return val
}

function parseBearing (bearing: string, format: BearingFormat): number | null {
  return format === 'quadrant' ? parseQuadrantBearing(bearing) : parseAzimuth(bearing)
}

function parseBearingValue (
  bearing: string,
  format: BearingFormat,
  bearingEntry: BearingEntry
): number | null {
  if (format === 'quadrant' && bearingEntry === 'number') {
    const sep = bearing.indexOf('|')
    if (sep === -1) return null
    const q = parseInt(bearing.slice(1, sep), 10)
    const angle = bearing.slice(sep + 1)
    return parseQuadrantNumberBearing(q, angle)
  }
  return parseBearing(bearing, format)
}

// ---------------------------------------------------------------------------
// Distance / geometry helpers
// ---------------------------------------------------------------------------

function toMeters (distance: string, unit: string): number {
  return parseFloat(distance) * (UNIT_TO_METERS[unit] || 1)
}

function webMercatorToWGS84 (x: number, y: number): [number, number] {
  const lon = x / R_EARTH * (180 / Math.PI)
  const lat = (2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) * (180 / Math.PI)
  return [parseFloat(lon.toFixed(7)), parseFloat(lat.toFixed(7))]
}

function hexToRgba (hex: string): [number, number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    255
  ]
}

function computeNextPoint (x: number, y: number, azimuthDeg: number, distanceMeters: number) {
  const lat_rad = 2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2
  const cos_lat = Math.cos(lat_rad)
  const az_rad = azimuthDeg * Math.PI / 180
  return {
    x: x + distanceMeters * Math.sin(az_rad) / cos_lat,
    y: y + distanceMeters * Math.cos(az_rad) / cos_lat
  }
}

/** Adds a rotation offset (degrees) to an azimuth, normalized to 0–360°. */
function rotateAzimuth (az: number, rotationOffset: number): number {
  const r = (az + rotationOffset) % 360
  return r < 0 ? r + 360 : r
}

/**
 * Rotates point (px, py) about (pivotX, pivotY) by deltaDeg, using the same
 * clockwise-from-north sense as azimuths (so rotating a course's endpoint by
 * delta here always agrees with rotateAzimuth(az, delta) on that course).
 */
function rotatePointAround (px: number, py: number, pivotX: number, pivotY: number, deltaDeg: number) {
  const rad = deltaDeg * Math.PI / 180
  const dx = px - pivotX
  const dy = py - pivotY
  const cosD = Math.cos(rad)
  const sinD = Math.sin(rad)
  return {
    x: pivotX + dx * cosD + dy * sinD,
    y: pivotY + dy * cosD - dx * sinD
  }
}

/**
 * Inverse of computeNextPoint: given two Web Mercator points, derive the
 * azimuth (0–360°) and ground distance (meters) of the course between them.
 */
function computeAzimuthAndDistance (x0: number, y0: number, x1: number, y1: number) {
  const lat_rad = 2 * Math.atan(Math.exp(y0 / R_EARTH)) - Math.PI / 2
  const cos_lat = Math.cos(lat_rad)
  const dx = x1 - x0
  const dy = y1 - y0
  let az = Math.atan2(dx, dy) * 180 / Math.PI
  if (az < 0) az += 360
  const distanceMeters = cos_lat * Math.sqrt(dx * dx + dy * dy)
  return { az, distanceMeters }
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** 'line': straight course (bearing + distance). 'curve': arc defined by chord
 *  bearing, arc length, radius, and direction (left/right of travel). */
type CourseType = 'line' | 'curve'
type CurveDirection = 'left' | 'right'

interface TraverseCourse {
  type: CourseType
  bearing: string
  distance: string
  unit: DistanceUnit
  /** Curve only — radius in the same unit as `distance`. */
  radius?: string
  /** Curve only — which side of the chord direction the arc bends toward. */
  curveDirection?: CurveDirection
}
interface TraversePoint { x: number; y: number }

/** Controls how the bearing field is rendered in the UI when format = 'quadrant'. */
type BearingEntry = 'letters' | 'number'

// ---------------------------------------------------------------------------
// Traverse calculation
// ---------------------------------------------------------------------------

/**
 * Resolves a single course to the azimuth and ground distance to step by.
 * For a line: its own bearing/distance.
 * For a curve: the chord bearing and chord length (chord is what separates
 * PC from PT). `arcMeters` is the traveled arc length (= stepMeters for a
 * line), used for perimeter/precision-ratio totals.
 * Returns null if the course doesn't parse, or for a curve if the radius is
 * missing/invalid or the arc spans ≥ 360°.
 */
function resolveCourseStep (
  course: TraverseCourse,
  bearingFormat: BearingFormat,
  bearingEntry: BearingEntry
): { az: number; stepMeters: number; arcMeters: number; deltaRad?: number; radiusMeters?: number } | null {
  const az = parseBearingValue(course.bearing, bearingFormat, bearingEntry)
  if (az === null || !course.distance) return null
  const distMeters = toMeters(course.distance, course.unit)
  if (isNaN(distMeters) || distMeters <= 0) return null
  if (course.type === 'curve') {
    const radiusMeters = toMeters(course.radius || '', course.unit)
    if (!(radiusMeters > 0)) return null
    const deltaRad = distMeters / radiusMeters
    if (deltaRad >= Math.PI * 2) return null
    const chordMeters = 2 * radiusMeters * Math.sin(deltaRad / 2)
    return { az, stepMeters: chordMeters, arcMeters: distMeters, deltaRad, radiusMeters }
  }
  return { az, stepMeters: distMeters, arcMeters: distMeters }
}

/**
 * Interpolates points along a curve's arc, given its chord (start + chord
 * azimuth/length), radius, central angle (deltaRad), and direction.
 * Used to draw actual arc geometry rather than a straight chord line.
 */
function computeCurvePoints (
  startX: number, startY: number,
  chordAz: number, chordMeters: number, radiusMeters: number, deltaRad: number,
  direction: CurveDirection, segments = 24
): TraversePoint[] {
  const mid = computeNextPoint(startX, startY, chordAz, chordMeters / 2)
  const h = radiusMeters * Math.cos(deltaRad / 2)
  const perpAz = direction === 'right' ? chordAz + 90 : chordAz - 90
  const center = computeNextPoint(mid.x, mid.y, perpAz, h)
  const { az: azToStart } = computeAzimuthAndDistance(center.x, center.y, startX, startY)
  const sign = direction === 'right' ? 1 : -1
  const pts: TraversePoint[] = []
  for (let s = 0; s <= segments; s++) {
    const a = azToStart + sign * deltaRad * (s / segments)
    pts.push(computeNextPoint(center.x, center.y, a, radiusMeters))
  }
  return pts
}

/** Convenience wrapper: arc points for a curve course given its resolved step. */
function computeCourseCurvePoints (
  startX: number, startY: number,
  step: { az: number; stepMeters: number; deltaRad?: number; radiusMeters?: number },
  direction: CurveDirection
): TraversePoint[] {
  return computeCurvePoints(startX, startY, step.az, step.stepMeters, step.radiusMeters!, step.deltaRad!, direction)
}

function buildTraversePoints (
  startX: number, startY: number,
  courses: TraverseCourse[],
  bearingFormat: BearingFormat,
  bearingEntry: BearingEntry
): TraversePoint[] | null {
  const points: TraversePoint[] = [{ x: startX, y: startY }]
  for (let i = 0; i < courses.length; i++) {
    const step = resolveCourseStep(courses[i], bearingFormat, bearingEntry)
    if (step === null) return null
    const last = points[points.length - 1]
    points.push(computeNextPoint(last.x, last.y, step.az, step.stepMeters))
  }
  return points
}

interface ClosureReport {
  closureError: number
  precisionRatio: number
  totalDist: number
  sumDep: number
  sumLat: number
  areaAcres: number
  areaSqFt: number
}

function computeClosureReport (
  courses: TraverseCourse[],
  reportUnit: string,
  bearingFormat: BearingFormat,
  bearingEntry: BearingEntry
): ClosureReport | null {
  let sumDep = 0, sumLat = 0, totalDist = 0
  let gx = 0, gy = 0
  const gPts: TraversePoint[] = [{ x: 0, y: 0 }]
  for (let i = 0; i < courses.length; i++) {
    const step = resolveCourseStep(courses[i], bearingFormat, bearingEntry)
    if (step === null) return null
    const az_rad = step.az * Math.PI / 180
    const dep = step.stepMeters * Math.sin(az_rad)
    const lat = step.stepMeters * Math.cos(az_rad)
    sumDep += dep; sumLat += lat; totalDist += step.arcMeters
    gx += dep; gy += lat
    gPts.push({ x: gx, y: gy })
  }
  const closureM = Math.sqrt(sumDep * sumDep + sumLat * sumLat)
  const unitFactor = 1 / (UNIT_TO_METERS[reportUnit] || 1)
  const precisionRatio = closureM > 0.001 ? Math.round(totalDist / closureM) : 999999

  let area = 0
  const n = gPts.length
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n
    area += gPts[j].x * gPts[k].y - gPts[k].x * gPts[j].y
  }
  const areaSqM = Math.abs(area / 2)

  return {
    closureError: closureM * unitFactor,
    precisionRatio,
    totalDist: totalDist * unitFactor,
    sumDep: sumDep * unitFactor,
    sumLat: sumLat * unitFactor,
    areaAcres: areaSqM * 0.000247105,
    areaSqFt: areaSqM * 10.7639
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatBearingLabel (az: number, format: BearingFormat): string {
  if (format === 'azimuth') return az.toFixed(4) + '°'
  let ns: string, ew: string, angle: number
  if (az <= 90)       { ns = 'N'; ew = 'E'; angle = az }
  else if (az <= 180) { ns = 'S'; ew = 'E'; angle = 180 - az }
  else if (az <= 270) { ns = 'S'; ew = 'W'; angle = az - 180 }
  else                { ns = 'N'; ew = 'W'; angle = 360 - az }
  let deg = Math.floor(angle)
  const minF = (angle - deg) * 60
  let min = Math.floor(minF)
  let sec = Math.round((minF - min) * 60)
  if (sec === 60) { sec = 0; min++ }
  if (min === 60) { min = 0; deg++ }
  return `${ns} ${String(deg).padStart(2, '0')}°${String(min).padStart(2, '0')}'${String(sec).padStart(2, '0')}" ${ew}`
}

/**
 * Format an azimuth as a course's stored bearing string, matching whichever
 * format/entry mode is active so the value round-trips through parseBearingValue.
 */
function formatBearingForEntry (az: number, format: BearingFormat, entry: BearingEntry): string {
  if (format === 'azimuth') return az.toFixed(4)
  if (entry === 'letters') return formatBearingLabel(az, 'quadrant')

  let ns: string, ew: string, angle: number
  if (az <= 90)       { ns = 'N'; ew = 'E'; angle = az }
  else if (az <= 180) { ns = 'S'; ew = 'E'; angle = 180 - az }
  else if (az <= 270) { ns = 'S'; ew = 'W'; angle = az - 180 }
  else                { ns = 'N'; ew = 'W'; angle = 360 - az }
  let deg = Math.floor(angle)
  const minF = (angle - deg) * 60
  let min = Math.floor(minF)
  let sec = Math.round((minF - min) * 60)
  if (sec === 60) { sec = 0; min++ }
  if (min === 60) { min = 0; deg++ }
  const q = ns === 'N' && ew === 'E' ? 1 : ns === 'S' && ew === 'E' ? 2 : ns === 'S' && ew === 'W' ? 3 : 4
  return encodeQNum(q, `${deg} ${min} ${sec}`)
}

function getPointColor (isStart: boolean, isEnd: boolean, closureDist: number): number[] {
  if (isStart) return [0, 180, 0, 255]
  if (isEnd && closureDist > 0.05) return [220, 38, 38, 255]
  return [41, 121, 255, 255]
}

// ---------------------------------------------------------------------------
// Helpers for quadrant-number bearing storage format "Q<n>|<angleStr>"
// ---------------------------------------------------------------------------

function decodeQNum (bearing: string): number {
  const sep = bearing.indexOf('|')
  if (sep === -1) return 1
  return parseInt(bearing.slice(1, sep), 10) || 1
}

function decodeQAngle (bearing: string): string {
  const sep = bearing.indexOf('|')
  if (sep === -1) return bearing
  return bearing.slice(sep + 1)
}

function encodeQNum (q: number, angle: string): string {
  return `Q${q}|${angle}`
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S: Record<string, React.CSSProperties> = {
  wrap: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    fontSize: '13px', backgroundColor: '#ffffff', overflow: 'hidden', boxSizing: 'border-box' },
  header: { padding: '12px 16px', fontWeight: '600', fontSize: '15px', color: '#1e293b',
    borderBottom: '1px solid #e2e8f0', flexShrink: 0 },
  body: { flex: 1, overflowY: 'auto', padding: '12px 16px' },
  section: { marginBottom: '14px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: '5px' },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  input: { border: '1px solid #e2e8f0', borderRadius: '5px', padding: '4px 7px',
    fontSize: '12px', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' },
  qNumInput: { border: '1px solid #e2e8f0', borderRadius: '5px', padding: '4px 5px',
    fontSize: '12px', width: '32px', flexShrink: 0, fontFamily: 'monospace',
    textAlign: 'center' as const, boxSizing: 'border-box' as const },
  unitSelect: { border: '1px solid #e2e8f0', borderRadius: '5px', padding: '4px 2px',
    fontSize: '11px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'monospace' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th: { padding: '5px 6px', backgroundColor: '#f8fafc', fontWeight: '600', color: '#64748b',
    textAlign: 'left', borderBottom: '1px solid #e2e8f0', fontSize: '11px' },
  td: { padding: '4px 6px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
  trSelected: { backgroundColor: '#e0f2fe' },
  coordBox: { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '5px',
    padding: '5px 9px', fontSize: '11px', color: '#475569', fontFamily: 'monospace', marginTop: '5px' },
  reportBox: { backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px',
    padding: '11px 14px', marginTop: '8px' },
  reportRow: { display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '12px' },
  reportDivider: { borderTop: '1px solid #bbf7d0', paddingTop: '6px', marginTop: '4px' },
  errorBox: { backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px',
    padding: '7px 11px', fontSize: '12px', color: '#dc2626', marginBottom: '10px' },
  warn: { backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px',
    padding: '7px 11px', fontSize: '12px', color: '#92400e', marginBottom: '10px' },
  hint: { fontSize: '11px', color: '#94a3b8', marginBottom: '10px', lineHeight: '1.5',
    fontFamily: 'monospace', backgroundColor: '#f8fafc', padding: '5px 8px',
    borderRadius: '4px', border: '1px solid #e2e8f0' },
  entryToggle: { display: 'flex', gap: '4px', marginBottom: '6px', alignItems: 'center' },
  entryToggleLabel: { fontSize: '11px', color: '#64748b', marginRight: '2px' }
}

// ---------------------------------------------------------------------------
// Component state interface
// ---------------------------------------------------------------------------

interface StartPoint { x: number; y: number; spatialReference: any }

interface State {
  jimuMapView: JimuMapView | null
  modulesLoaded: boolean
  isPickingStart: boolean
  /** True while the user is click-adding courses to the map. */
  isDrawingCourses: boolean
  startPoint: StartPoint | null
  courses: TraverseCourse[]
  bearingFormat: BearingFormat
  bearingEntry: BearingEntry
  distanceUnit: DistanceUnit
  closureReport: ClosureReport | null
  parseError: string | null
  pendingFocusRow: number | null
  pendingFocusField: 'bearing' | 'distance' | null
  selectedCourseIndex: number | null
  traverseColor: string
  rotationOffset: string
  rotationPoint: StartPoint | null
  isPickingRotationPoint: boolean
  /** When true, all pick operations snap to vertices/edges of visible feature layers. */
  snappingEnabled: boolean
  exportLineString: boolean
  exportPoints: boolean
  exportPolygon: boolean
  exportFileName: string
  popupEnabled: boolean
}

// ---------------------------------------------------------------------------
// Widget component
// ---------------------------------------------------------------------------

class TraverseWidget extends React.Component<AllWidgetProps<IMConfig>, State> {
  private _GraphicsLayer: any = null
  private _Graphic: any = null
  private _Point: any = null
  private _Polyline: any = null
  private _SimpleLine: any = null
  private _SimpleMarker: any = null
  private _TextSymbol: any = null
  private _SketchViewModel: any = null
  private _Collection: any = null
  private _traverseLayer: any = null
  private _labelLayer: any = null
  private _highlightLayer: any = null
  private _pivotLayer: any = null
  private _snapScratchLayer: any = null
  private _snapSVM: any = null
  private _activePickMode: 'start' | 'rotation' | 'draw' | null = null
  private _redrawTimer: ReturnType<typeof setTimeout> | null = null
  private _drawLastVertex: { x: number; y: number } | null = null

  private _bearingRefs: Array<HTMLInputElement | null> = []
  private _distanceRefs: Array<HTMLInputElement | null> = []
  private _qNumRefs: Array<HTMLInputElement | null> = []
  private _qAngleRefs: Array<HTMLInputElement | null> = []
  private _unitSelectRef: React.RefObject<any> = React.createRef()

  constructor (props: AllWidgetProps<IMConfig>) {
    super(props)
    const defaultUnit: DistanceUnit = props.config?.defaultDistanceUnit ?? 'feet'
    this.state = {
      jimuMapView: null,
      modulesLoaded: false,
      isPickingStart: false,
      isDrawingCourses: false,
      startPoint: null,
      courses: [{ type: 'line', bearing: '', distance: '', unit: defaultUnit }],
      bearingFormat: props.config?.defaultBearingFormat ?? 'quadrant',
      bearingEntry: 'letters',
      distanceUnit: defaultUnit,
      closureReport: null,
      parseError: null,
      pendingFocusRow: null,
      pendingFocusField: null,
      selectedCourseIndex: null,
      traverseColor: '#dc2626',
      rotationOffset: '',
      rotationPoint: null,
      isPickingRotationPoint: false,
      snappingEnabled: true,
      exportLineString: true,
      exportPoints: true,
      exportPolygon: true,
      exportFileName: 'traverse',
      popupEnabled: true
    }
    this._onViewChange = this._onViewChange.bind(this)
  }

  // -------------------------------------------------------------------------
  // Calcite web component wiring
  // -------------------------------------------------------------------------

  componentDidMount () {
    const el = this._unitSelectRef.current
    if (!el) return
    el.addEventListener('calciteSelectChange', (ev: any) => {
      this.setState({ distanceUnit: ev.target.value as DistanceUnit, closureReport: null })
    })
  }

  // -------------------------------------------------------------------------
  // Focus management + live redraw trigger
  // -------------------------------------------------------------------------

  componentDidUpdate (_: any, prevState: State) {
    const { pendingFocusRow, pendingFocusField, bearingFormat, bearingEntry } = this.state

    if (pendingFocusRow !== null && pendingFocusField !== null) {
      this.setState({ pendingFocusRow: null, pendingFocusField: null }, () => {
        if (pendingFocusField === 'distance') {
          const el = this._distanceRefs[pendingFocusRow!]
          if (el) { el.focus(); el.select() }
        } else {
          if (bearingFormat === 'quadrant' && bearingEntry === 'number') {
            const el = this._qNumRefs[pendingFocusRow!]
            if (el) { el.focus(); el.select() }
          } else {
            const el = this._bearingRefs[pendingFocusRow!]
            if (el) { el.focus(); el.select() }
          }
        }
      })
    }

    const { startPoint, courses, distanceUnit, modulesLoaded, selectedCourseIndex, rotationOffset, rotationPoint } = this.state

    const geometryChanged =
      prevState.courses        !== courses        ||
      prevState.startPoint     !== startPoint     ||
      prevState.bearingFormat  !== bearingFormat  ||
      prevState.bearingEntry   !== bearingEntry   ||
      prevState.distanceUnit   !== distanceUnit   ||
      prevState.rotationOffset !== rotationOffset ||
      prevState.rotationPoint  !== rotationPoint

    if (geometryChanged && modulesLoaded && startPoint) {
      if (this._redrawTimer !== null) clearTimeout(this._redrawTimer)
      this._redrawTimer = setTimeout(() => {
        this._redrawTimer = null
        this._liveRedraw()
        this._redrawHighlight(this.state.selectedCourseIndex)
      }, 150)
    }

    if (prevState.selectedCourseIndex !== selectedCourseIndex && !geometryChanged && modulesLoaded) {
      this._redrawHighlight(selectedCourseIndex)
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle / map wiring
  // -------------------------------------------------------------------------

  componentWillUnmount () {
    if (this._redrawTimer !== null) { clearTimeout(this._redrawTimer); this._redrawTimer = null }
    this._cancelPick()
    if (this._snapSVM) { try { this._snapSVM.destroy() } catch { /* ignore */ } }
    const view = this.state.jimuMapView?.view
    if (view) {
      try { (view as any).popupEnabled = true } catch { /* ignore */ }
      if (this._traverseLayer)    view.map.remove(this._traverseLayer)
      if (this._labelLayer)       view.map.remove(this._labelLayer)
      if (this._highlightLayer)   view.map.remove(this._highlightLayer)
      if (this._pivotLayer)       view.map.remove(this._pivotLayer)
      if (this._snapScratchLayer) view.map.remove(this._snapScratchLayer)
    }
  }

  // -------------------------------------------------------------------------
  // Map identify popup coordination (works with the draggable-popup widget)
  // -------------------------------------------------------------------------

  /**
   * Sets view.popupEnabled. The draggable-popup widget honors this: when false
   * it lets the popup close and stops re-opening it.
   * The popup is suppressed when EITHER the user has toggled it off OR a pick
   * operation is in progress (so the pick-click can't open an identify popup).
   */
  _syncPopup (popupEnabledByUser: boolean, isPicking: boolean) {
    const view = this.state.jimuMapView?.view as any
    if (!view) return
    const enabled = popupEnabledByUser && !isPicking
    try {
      view.popupEnabled = enabled
      if (!enabled && typeof view.closePopup === 'function') view.closePopup()
    } catch { /* ignore */ }
  }

  _togglePopup () {
    const next = !this.state.popupEnabled
    this.setState({ popupEnabled: next }, () => {
      this._syncPopup(next, this.state.isPickingStart)
    })
  }

  async _onViewChange (jimuMapView: JimuMapView) {
    if (!jimuMapView) return
    this.setState({ jimuMapView }, async () => {
      if (!this.state.modulesLoaded) {
        const mods = await loadArcGISJSAPIModules([
          'esri/layers/GraphicsLayer',
          'esri/Graphic',
          'esri/geometry/Point',
          'esri/geometry/Polyline',
          'esri/symbols/SimpleLineSymbol',
          'esri/symbols/SimpleMarkerSymbol',
          'esri/symbols/TextSymbol',
          'esri/widgets/Sketch/SketchViewModel',
          'esri/core/Collection'
        ])
        this._GraphicsLayer    = mods[0]
        this._Graphic          = mods[1]
        this._Point            = mods[2]
        this._Polyline         = mods[3]
        this._SimpleLine       = mods[4]
        this._SimpleMarker     = mods[5]
        this._TextSymbol       = mods[6]
        this._SketchViewModel  = mods[7]
        this._Collection       = mods[8]
        this.setState({ modulesLoaded: true }, () => this._initLayers())
      } else {
        this._initLayers()
      }
    })
  }

  _initLayers () {
    const view = this.state.jimuMapView?.view
    if (!view || !this._GraphicsLayer) return
    if (!this._traverseLayer) {
      this._traverseLayer    = new this._GraphicsLayer({ listMode: 'hide', id: 'traverse-graphics' })
      this._labelLayer       = new this._GraphicsLayer({ listMode: 'hide', id: 'traverse-labels' })
      this._highlightLayer   = new this._GraphicsLayer({ listMode: 'hide', id: 'traverse-highlight' })
      // Pivot layer sits on top so the rotation-point diamond is never obscured.
      this._pivotLayer       = new this._GraphicsLayer({ listMode: 'hide', id: 'traverse-pivot' })
      // Scratch layer used exclusively by the snapping SVM; cleared after every pick.
      this._snapScratchLayer = new this._GraphicsLayer({ listMode: 'hide', id: 'traverse-snap-scratch' })
      view.map.addMany([
        this._traverseLayer, this._labelLayer,
        this._highlightLayer, this._pivotLayer, this._snapScratchLayer
      ])
    }
    if (!this._snapSVM && this._SketchViewModel) {
      this._snapSVM = new this._SketchViewModel({
        view,
        layer: this._snapScratchLayer,
        snappingOptions: {
          enabled: this.state.snappingEnabled,
          featureEnabled: true,
          selfEnabled: false,
          distance: 15,
          featureSources: new this._Collection()
        }
      })
      this._snapSVM.on('create', (event: any) => this._handleSnapCreateEvent(event))
    }
    this._syncPopup(this.state.popupEnabled, this.state.isPickingStart)
  }

  // -------------------------------------------------------------------------
  // Snapping
  // -------------------------------------------------------------------------

  /** Visible feature layers on the map, used as snap targets. */
  _buildSnapSources (): any[] {
    const view = this.state.jimuMapView?.view
    if (!view) return []
    const sources: any[] = []
    view.map.allLayers.forEach((layer: any) => {
      if (layer?.visible && (layer.type || '').toLowerCase() === 'feature') {
        sources.push({ layer, enabled: true })
      }
    })
    return sources
  }

  /** Refreshes snap-enabled flag and feature sources before a pick session. */
  _applySnapSources () {
    if (!this._snapSVM) return
    this._snapSVM.snappingOptions.enabled = this.state.snappingEnabled
    const fs = this._snapSVM.snappingOptions.featureSources
    const sources = this._buildSnapSources()
    if (fs?.removeAll) { fs.removeAll(); fs.addMany(sources) }
    else this._snapSVM.snappingOptions.featureSources = new this._Collection(sources)
  }

  _toggleSnapping () {
    const next = !this.state.snappingEnabled
    this.setState({ snappingEnabled: next })
    if (this._snapSVM) this._snapSVM.snappingOptions.enabled = next
  }

  /**
   * Shared handler for all SketchViewModel single-point create operations.
   * `_activePickMode` determines which in-progress pick the event belongs to.
   */
  _handleSnapCreateEvent (event: any) {
    const view = this.state.jimuMapView?.view

    if (event.state === 'cancel') {
      const mode = this._activePickMode
      if (this._snapScratchLayer) this._snapScratchLayer.removeAll()
      if (mode === 'draw') {
        this._finishDrawingCourses()
      } else if (mode === 'start') {
        this._activePickMode = null
        if (view) (view as any).cursor = 'auto'
        this.setState({ isPickingStart: false })
        this._syncPopup(this.state.popupEnabled, false)
      } else if (mode === 'rotation') {
        this._activePickMode = null
        if (view) (view as any).cursor = 'auto'
        this.setState({ isPickingRotationPoint: false })
        this._syncPopup(this.state.popupEnabled, false)
      }
      return
    }

    if (event.state !== 'complete') return

    const pt = event.graphic?.geometry
    if (this._snapScratchLayer) this._snapScratchLayer.removeAll()
    if (!pt) { this._activePickMode = null; return }

    if (this._activePickMode === 'start') {
      this._activePickMode = null
      if (view) (view as any).cursor = 'auto'
      this.setState({
        isPickingStart: false,
        startPoint: { x: pt.x, y: pt.y, spatialReference: pt.spatialReference },
        closureReport: null,
        parseError: null
      })
      // Deferred so this pick-click can't itself open an identify popup.
      setTimeout(() => this._syncPopup(this.state.popupEnabled, false), 0)

    } else if (this._activePickMode === 'rotation') {
      this._activePickMode = null
      if (view) (view as any).cursor = 'auto'
      this.setState({
        isPickingRotationPoint: false,
        rotationPoint: { x: pt.x, y: pt.y, spatialReference: pt.spatialReference }
      }, () => this._updatePivotMarker())
      setTimeout(() => this._syncPopup(this.state.popupEnabled, false), 0)

    } else if (this._activePickMode === 'draw') {
      this._handleDrawPoint(pt)
      // Re-arm for the next vertex (still in drawing mode).
      if (this.state.isDrawingCourses) {
        this._applySnapSources()
        this._snapSVM.create('point')
      }
    }
  }

  // -------------------------------------------------------------------------
  // Point picking
  // -------------------------------------------------------------------------

  _cancelPick () {
    if (this._snapSVM && this._snapSVM.state === 'active') this._snapSVM.cancel()
    this._activePickMode = null
    if (this._snapScratchLayer) this._snapScratchLayer.removeAll()
    const view = this.state.jimuMapView?.view
    if (view) (view as any).cursor = 'auto'
  }

  _startPickingPoint () {
    const view = this.state.jimuMapView?.view
    if (!view || !this._snapSVM) return
    this._cancelPick()
    this._activePickMode = 'start'
    this.setState({ isPickingStart: true, isDrawingCourses: false, isPickingRotationPoint: false, parseError: null })
    ;(view as any).cursor = 'crosshair'
    this._syncPopup(this.state.popupEnabled, true)
    this._applySnapSources()
    this._snapSVM.create('point')
  }

  // -------------------------------------------------------------------------
  // Draw courses on the map
  // -------------------------------------------------------------------------

  /**
   * Enters click-sequence draw mode: each map click appends a course computed
   * from the previous vertex to the clicked point. The first click sets the
   * start point if one isn't already set. Snaps to visible feature layers when
   * snappingEnabled is true. Ends via _finishDrawingCourses (Finish button or Esc).
   */
  _startDrawingCourses () {
    const view = this.state.jimuMapView?.view
    if (!view || !this._snapSVM) return
    this._cancelPick()

    const { startPoint, courses, bearingFormat, bearingEntry } = this.state
    if (startPoint) {
      const points = buildTraversePoints(startPoint.x, startPoint.y, courses, bearingFormat, bearingEntry)
      this._drawLastVertex = points ? points[points.length - 1] : { x: startPoint.x, y: startPoint.y }
    } else {
      this._drawLastVertex = null
    }

    this._activePickMode = 'draw'
    this.setState({ isDrawingCourses: true, isPickingStart: false, isPickingRotationPoint: false, parseError: null })
    ;(view as any).cursor = 'crosshair'
    this._syncPopup(this.state.popupEnabled, true)
    this._applySnapSources()
    this._snapSVM.create('point')
  }

  _handleDrawPoint (pt: { x: number; y: number; spatialReference?: any }) {
    if (this._drawLastVertex === null) {
      this._drawLastVertex = { x: pt.x, y: pt.y }
      this.setState({
        startPoint: { x: pt.x, y: pt.y, spatialReference: pt.spatialReference },
        closureReport: null
      })
      return
    }

    const { az, distanceMeters } = computeAzimuthAndDistance(
      this._drawLastVertex.x, this._drawLastVertex.y, pt.x, pt.y
    )
    if (distanceMeters < 0.01) return // ignore accidental same-spot click

    const { distanceUnit, bearingFormat, bearingEntry } = this.state
    const distanceInUnit = distanceMeters / (UNIT_TO_METERS[distanceUnit] || 1)
    const bearingStr = formatBearingForEntry(az, bearingFormat, bearingEntry)
    this._drawLastVertex = { x: pt.x, y: pt.y }

    this.setState(prev => {
      const courses = [...prev.courses]
      const lastIdx = courses.length - 1
      const newRow: TraverseCourse = { type: 'line', bearing: bearingStr, distance: distanceInUnit.toFixed(2), unit: prev.distanceUnit }
      // Fill a still-empty trailing row rather than stacking a redundant one.
      if (lastIdx >= 0 && !courses[lastIdx].bearing && !courses[lastIdx].distance) {
        courses[lastIdx] = newRow
      } else {
        courses.push(newRow)
      }
      return { courses, closureReport: null }
    })
  }

  _finishDrawingCourses () {
    if (this._activePickMode !== 'draw' && !this.state.isDrawingCourses) return
    this._activePickMode = null
    this._drawLastVertex = null
    if (this._snapSVM && this._snapSVM.state === 'active') this._snapSVM.cancel()
    if (this._snapScratchLayer) this._snapScratchLayer.removeAll()
    const view = this.state.jimuMapView?.view
    if (view) (view as any).cursor = 'auto'
    this.setState({ isDrawingCourses: false })
    this._syncPopup(this.state.popupEnabled, false)
  }

  // -------------------------------------------------------------------------
  // Rotation pivot
  // -------------------------------------------------------------------------

  _startPickingRotationPoint () {
    const view = this.state.jimuMapView?.view
    if (!view || !this._snapSVM) return
    this._cancelPick()
    this._activePickMode = 'rotation'
    this.setState({ isPickingRotationPoint: true, isPickingStart: false, isDrawingCourses: false, parseError: null })
    ;(view as any).cursor = 'crosshair'
    this._syncPopup(this.state.popupEnabled, true)
    this._applySnapSources()
    this._snapSVM.create('point')
  }

  _cancelPickingRotationPoint () {
    this._cancelPick()
    this.setState({ isPickingRotationPoint: false })
    this._syncPopup(this.state.popupEnabled, false)
  }

  _resetRotationPoint () {
    this.setState({ rotationPoint: null }, () => this._updatePivotMarker())
  }

  _updatePivotMarker () {
    if (!this._pivotLayer) return
    this._pivotLayer.removeAll()
    const { rotationPoint, startPoint } = this.state
    if (!rotationPoint) return
    const sr = (startPoint ?? rotationPoint).spatialReference
    this._pivotLayer.add(new this._Graphic({
      geometry: new this._Point({ x: rotationPoint.x, y: rotationPoint.y, spatialReference: sr }),
      symbol: new this._SimpleMarker({
        color: [147, 51, 234, 255],
        outline: { color: [255, 255, 255, 255], width: 1.5 },
        size: 11,
        style: 'diamond'
      })
    }))
  }

  // -------------------------------------------------------------------------
  // Leg mutation
  // -------------------------------------------------------------------------

  _addCourse (focusBearing = false) {
    this.setState(prev => ({
      courses: [...prev.courses, { type: 'line', bearing: '', distance: '', unit: prev.distanceUnit }],
      closureReport: null,
      pendingFocusRow: focusBearing ? prev.courses.length : null,
      pendingFocusField: focusBearing ? 'bearing' : null
    }))
  }

  _insertCourse (afterIndex: number) {
    this.setState(prev => {
      const courses = [...prev.courses]
      courses.splice(afterIndex + 1, 0, { type: 'line', bearing: '', distance: '', unit: prev.distanceUnit })
      const sel = prev.selectedCourseIndex
      return {
        courses,
        closureReport: null,
        selectedCourseIndex: sel !== null && sel > afterIndex ? sel + 1 : sel,
        pendingFocusRow: afterIndex + 1,
        pendingFocusField: 'bearing'
      }
    })
  }

  _removeCourse (i: number) {
    this.setState(prev => {
      const sel = prev.selectedCourseIndex
      return {
        courses: prev.courses.filter((_, idx) => idx !== i),
        closureReport: null,
        selectedCourseIndex: sel === i ? null : sel !== null && sel > i ? sel - 1 : sel
      }
    })
  }

  _updateCourse (i: number, field: 'bearing' | 'distance' | 'radius', value: string) {
    this.setState(prev => {
      const courses = [...prev.courses]
      courses[i] = { ...courses[i], [field]: value }
      return { courses, closureReport: null }
    })
  }

  _updateCourseType (i: number, type: CourseType) {
    this.setState(prev => {
      const courses = [...prev.courses]
      const course = courses[i]
      courses[i] = type === 'curve'
        ? { ...course, type, radius: course.radius ?? '', curveDirection: course.curveDirection ?? 'right' }
        : { ...course, type }
      return { courses, closureReport: null }
    })
  }

  _updateCourseDirection (i: number, curveDirection: CurveDirection) {
    this.setState(prev => {
      const courses = [...prev.courses]
      courses[i] = { ...courses[i], curveDirection }
      return { courses, closureReport: null }
    })
  }

  _updateCourseUnit (i: number, unit: DistanceUnit) {
    this.setState(prev => {
      const courses = [...prev.courses]
      courses[i] = { ...courses[i], unit }
      return { courses, closureReport: null }
    })
  }

  // -------------------------------------------------------------------------
  // 10-key keyboard navigation handler
  // -------------------------------------------------------------------------

  _handleCourseKeyDown (
    ev: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    field: 'quadrant' | 'bearing' | 'distance'
  ) {
    const isNumpadEnter = ev.code === 'NumpadEnter'
    const isNumpadPlus  = ev.code === 'NumpadAdd'

    if ((isNumpadEnter || isNumpadPlus) && field === 'distance') {
      ev.preventDefault()
      this._addCourse(true)
      return
    }
    if ((isNumpadEnter || isNumpadPlus) && field === 'quadrant') {
      ev.preventDefault()
      const el = this._qAngleRefs[rowIndex]
      if (el) { el.focus(); el.select() }
      return
    }
    if ((isNumpadEnter || isNumpadPlus) && field === 'bearing') {
      ev.preventDefault()
      const el = this._distanceRefs[rowIndex]
      if (el) { el.focus(); el.select() }
      return
    }
  }

  // -------------------------------------------------------------------------
  // Draw / clear
  // -------------------------------------------------------------------------

  /**
   * Live redraw (debounced). Draws all currently-valid courses without setting
   * parseError or computing the closure report.
   */
  _liveRedraw () {
    const { startPoint, courses, bearingFormat, bearingEntry, rotationPoint } = this.state
    const view = this.state.jimuMapView?.view
    if (!startPoint || !view || !this._traverseLayer) return

    this._updatePivotMarker()

    const rotationOffset = parseFloat(this.state.rotationOffset) || 0
    const pivot = rotationPoint ?? startPoint
    const effectiveStart = rotatePointAround(startPoint.x, startPoint.y, pivot.x, pivot.y, rotationOffset)

    this._traverseLayer.removeAll()
    this._labelLayer.removeAll()

    const sr = startPoint.spatialReference
    const lineColor = hexToRgba(this.state.traverseColor)
    const closureColor = [249, 115, 22, 255]

    const drawnPoints: TraversePoint[] = [{ x: effectiveStart.x, y: effectiveStart.y }]
    const drawnCourseIndices: number[] = []
    const drawnSteps: Array<{ az: number; stepMeters: number; arcMeters: number; deltaRad?: number; radiusMeters?: number }> = []

    for (let i = 0; i < courses.length; i++) {
      const step = resolveCourseStep(courses[i], bearingFormat, bearingEntry)
      if (step === null) break  // stop at first invalid
      const az = rotateAzimuth(step.az, rotationOffset)
      const rotatedStep = { ...step, az }

      const prev = drawnPoints[drawnPoints.length - 1]
      drawnPoints.push(computeNextPoint(prev.x, prev.y, az, step.stepMeters))
      drawnCourseIndices.push(i)
      drawnSteps.push(rotatedStep)
    }

    if (drawnPoints.length < 2) return

    for (let k = 0; k < drawnCourseIndices.length; k++) {
      const i = drawnCourseIndices[k]
      const course = courses[i]
      const step = drawnSteps[k]
      const p0 = drawnPoints[k], p1 = drawnPoints[k + 1]

      if (course.type === 'curve') {
        const arcPts = computeCourseCurvePoints(p0.x, p0.y, step, course.curveDirection || 'right')
        this._traverseLayer.add(new this._Graphic({
          geometry: new this._Polyline({ paths: [arcPts.map(p => [p.x, p.y])], spatialReference: sr }),
          symbol: new this._SimpleLine({ color: lineColor, width: 2, style: 'dash-dot' })
        }))
      } else {
        this._traverseLayer.add(new this._Graphic({
          geometry: new this._Polyline({ paths: [[[p0.x, p0.y], [p1.x, p1.y]]], spatialReference: sr }),
          symbol: new this._SimpleLine({ color: lineColor, width: 2, style: 'dash' })
        }))
      }

      const courseLabel = course.type === 'curve'
        ? `${course.distance} ${course.unit} arc, R=${course.radius}\nChord ${formatBearingLabel(step.az, bearingFormat)}`
        : `${course.distance} ${course.unit}\n${formatBearingLabel(step.az, bearingFormat)}`
      this._labelLayer.add(new this._Graphic({
        geometry: new this._Point({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, spatialReference: sr }),
        symbol: new this._TextSymbol({
          text: courseLabel,
          color: lineColor,
          font: { size: 9, family: 'sans-serif' },
          haloColor: [255, 255, 255, 230],
          haloSize: 1.5,
          horizontalAlignment: 'center',
          verticalAlignment: 'bottom'
        })
      }))
    }

    const first = drawnPoints[0], last = drawnPoints[drawnPoints.length - 1]
    const closureDist = Math.hypot(last.x - first.x, last.y - first.y)
    if (closureDist > 0.05) {
      this._traverseLayer.add(new this._Graphic({
        geometry: new this._Polyline({ paths: [[[last.x, last.y], [first.x, first.y]]], spatialReference: sr }),
        symbol: new this._SimpleLine({ color: closureColor, width: 1.5, style: 'dash' })
      }))
    }

    for (let j = 0; j < drawnPoints.length; j++) {
      const pt = drawnPoints[j]
      this._traverseLayer.add(new this._Graphic({
        geometry: new this._Point({ x: pt.x, y: pt.y, spatialReference: sr }),
        symbol: new this._SimpleMarker({
          color: getPointColor(j === 0, j === drawnPoints.length - 1, closureDist),
          outline: { color: [255, 255, 255, 255], width: 1.5 },
          size: j === 0 ? 12 : 8,
          style: 'circle'
        })
      }))
    }
  }

  _redrawHighlight (index: number | null) {
    if (!this._highlightLayer) return
    this._highlightLayer.removeAll()
    if (index === null) return

    const { startPoint, courses, bearingFormat, bearingEntry, rotationPoint } = this.state
    if (!startPoint) return

    const rotationOffset = parseFloat(this.state.rotationOffset) || 0
    const pivot = rotationPoint ?? startPoint
    const effectiveStart = rotatePointAround(startPoint.x, startPoint.y, pivot.x, pivot.y, rotationOffset)
    const sr = startPoint.spatialReference

    let px = effectiveStart.x, py = effectiveStart.y
    let segPath: Array<[number, number]> | null = null

    for (let i = 0; i <= index; i++) {
      const step = resolveCourseStep(courses[i], bearingFormat, bearingEntry)
      if (step === null) return  // chain broken
      const az = rotateAzimuth(step.az, rotationOffset)
      const rotatedStep = { ...step, az }

      const nx = computeNextPoint(px, py, az, step.stepMeters)
      if (i === index) {
        segPath = courses[i].type === 'curve'
          ? computeCourseCurvePoints(px, py, rotatedStep, courses[i].curveDirection || 'right').map(p => [p.x, p.y] as [number, number])
          : [[px, py], [nx.x, nx.y]]
      }
      px = nx.x
      py = nx.y
    }

    if (!segPath) return

    this._highlightLayer.add(new this._Graphic({
      geometry: new this._Polyline({ paths: [segPath], spatialReference: sr }),
      symbol: new this._SimpleLine({ color: [0, 255, 255, 80], width: 10, style: 'solid' })
    }))
    this._highlightLayer.add(new this._Graphic({
      geometry: new this._Polyline({ paths: [segPath], spatialReference: sr }),
      symbol: new this._SimpleLine({ color: [0, 220, 255, 255], width: 3, style: 'solid' })
    }))
  }

  _drawTraverse () {
    const { startPoint, courses, distanceUnit, bearingFormat, bearingEntry } = this.state
    const view = this.state.jimuMapView?.view

    if (!startPoint) {
      this.setState({ parseError: 'Pick a starting point on the map first.' }); return
    }
    if (!view || !this._traverseLayer) {
      this.setState({ parseError: 'Map not ready.' }); return
    }
    if (courses.length === 0 || courses.every(l => !l.bearing && !l.distance)) {
      this.setState({ parseError: 'Enter at least one traverse course.' }); return
    }

    const points = buildTraversePoints(startPoint.x, startPoint.y, courses, bearingFormat, bearingEntry)
    if (!points) {
      this.setState({ parseError: 'Could not parse one or more courses. Check bearing format and distance values.' }); return
    }

    this._traverseLayer.removeAll()
    this._labelLayer.removeAll()

    const sr = startPoint.spatialReference
    const lineColor = hexToRgba(this.state.traverseColor)
    const closureColor = [249, 115, 22, 255]
    const geomForZoom: any[] = []

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i], p1 = points[i + 1]
      const course = courses[i]
      const step = resolveCourseStep(course, bearingFormat, bearingEntry)!

      let lineGeom: any
      if (course.type === 'curve') {
        const arcPts = computeCourseCurvePoints(p0.x, p0.y, step, course.curveDirection || 'right')
        lineGeom = new this._Polyline({ paths: [arcPts.map(p => [p.x, p.y])], spatialReference: sr })
        this._traverseLayer.add(new this._Graphic({
          geometry: lineGeom,
          symbol: new this._SimpleLine({ color: lineColor, width: 2, style: 'dash-dot' })
        }))
      } else {
        lineGeom = new this._Polyline({ paths: [[[p0.x, p0.y], [p1.x, p1.y]]], spatialReference: sr })
        this._traverseLayer.add(new this._Graphic({
          geometry: lineGeom,
          symbol: new this._SimpleLine({ color: lineColor, width: 2, style: 'dash' })
        }))
      }
      geomForZoom.push(lineGeom)

      const courseLabel = course.type === 'curve'
        ? `${course.distance} ${course.unit} arc, R=${course.radius}\nChord ${formatBearingLabel(step.az, bearingFormat)}`
        : `${course.distance} ${course.unit}\n${formatBearingLabel(step.az, bearingFormat)}`
      this._labelLayer.add(new this._Graphic({
        geometry: new this._Point({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, spatialReference: sr }),
        symbol: new this._TextSymbol({
          text: courseLabel,
          color: lineColor,
          font: { size: 9, family: 'sans-serif' },
          haloColor: [255, 255, 255, 230],
          haloSize: 1.5,
          horizontalAlignment: 'center',
          verticalAlignment: 'bottom'
        })
      }))
    }

    const first = points[0], last = points[points.length - 1]
    const closureDist = Math.hypot(last.x - first.x, last.y - first.y)
    if (closureDist > 0.05) {
      this._traverseLayer.add(new this._Graphic({
        geometry: new this._Polyline({ paths: [[[last.x, last.y], [first.x, first.y]]], spatialReference: sr }),
        symbol: new this._SimpleLine({ color: closureColor, width: 1.5, style: 'dash' })
      }))
    }

    for (let j = 0; j < points.length; j++) {
      const pt = points[j]
      this._traverseLayer.add(new this._Graphic({
        geometry: new this._Point({ x: pt.x, y: pt.y, spatialReference: sr }),
        symbol: new this._SimpleMarker({
          color: getPointColor(j === 0, j === points.length - 1, closureDist),
          outline: { color: [255, 255, 255, 255], width: 1.5 },
          size: j === 0 ? 12 : 8,
          style: 'circle'
        })
      }))
    }

    if (geomForZoom.length > 0) view.goTo(geomForZoom, { animate: true }).catch(() => {})
    this._redrawHighlight(this.state.selectedCourseIndex)
    this.setState({ closureReport: computeClosureReport(courses, distanceUnit, bearingFormat, bearingEntry), parseError: null })
  }

  /**
   * Commits the previewed rotation: rewrites every valid course's bearing by
   * rotationOffset and, if the pivot isn't the start point, moves the start
   * point. Rows that don't currently parse are left untouched. Resets offset to ''.
   */
  _applyRotation () {
    const { courses, bearingFormat, bearingEntry, startPoint, rotationPoint } = this.state
    const rotationOffset = parseFloat(this.state.rotationOffset) || 0
    if (!startPoint || rotationOffset === 0) return

    const rotatedCourses = courses.map(course => {
      const az0 = parseBearingValue(course.bearing, bearingFormat, bearingEntry)
      if (az0 === null) return course
      const az = rotateAzimuth(az0, rotationOffset)
      return { ...course, bearing: formatBearingForEntry(az, bearingFormat, bearingEntry) }
    })

    const pivot = rotationPoint ?? startPoint
    const newStart = rotatePointAround(startPoint.x, startPoint.y, pivot.x, pivot.y, rotationOffset)

    this.setState({
      courses: rotatedCourses,
      startPoint: { ...startPoint, x: newStart.x, y: newStart.y },
      rotationOffset: '',
      closureReport: null
    }, () => this._drawTraverse())
  }

  _clearAll () {
    this._cancelPick()
    this._drawLastVertex = null
    if (this._traverseLayer)    this._traverseLayer.removeAll()
    if (this._labelLayer)       this._labelLayer.removeAll()
    if (this._highlightLayer)   this._highlightLayer.removeAll()
    if (this._pivotLayer)       this._pivotLayer.removeAll()
    this._syncPopup(this.state.popupEnabled, false)
    this.setState(prev => ({
      startPoint: null,
      courses: [{ type: 'line', bearing: '', distance: '', unit: prev.distanceUnit }],
      closureReport: null,
      parseError: null,
      isPickingStart: false,
      isDrawingCourses: false,
      isPickingRotationPoint: false,
      selectedCourseIndex: null,
      rotationOffset: '',
      rotationPoint: null
    }))
  }

  _exportGeoJSON () {
    const { startPoint, courses, distanceUnit, bearingFormat, bearingEntry,
      closureReport, traverseColor, exportLineString, exportPoints, exportPolygon, exportFileName } = this.state
    if (!startPoint) return

    // Walk courses, stopping at the first invalid entry.
    // `points` holds one vertex per course (PC/PT for curves).
    // `densePoints` interpolates each curve's arc for smooth LineString/Polygon export.
    const points: TraversePoint[] = [{ x: startPoint.x, y: startPoint.y }]
    const densePoints: TraversePoint[] = [{ x: startPoint.x, y: startPoint.y }]
    const validCourses: Array<{ course: TraverseCourse; arcMeters: number }> = []

    for (const c of courses) {
      const step = resolveCourseStep(c, bearingFormat, bearingEntry)
      if (step === null) break
      const last = points[points.length - 1]
      const next = computeNextPoint(last.x, last.y, step.az, step.stepMeters)
      points.push(next)
      if (c.type === 'curve') {
        densePoints.push(...computeCourseCurvePoints(last.x, last.y, step, c.curveDirection || 'right').slice(1))
      } else {
        densePoints.push(next)
      }
      validCourses.push({ course: c, arcMeters: step.arcMeters })
    }

    if (validCourses.length === 0) return

    const wgs84      = points.map(p => webMercatorToWGS84(p.x, p.y))
    const denseWgs84 = densePoints.map(p => webMercatorToWGS84(p.x, p.y))
    const features: object[] = []

    if (exportLineString) {
      const totalDistM = validCourses.reduce((s, c) => s + c.arcMeters, 0)
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: denseWgs84 },
        properties: {
          stroke: traverseColor,
          courseCount: validCourses.length,
          totalDistance: parseFloat((totalDistM / (UNIT_TO_METERS[distanceUnit] || 1)).toFixed(3)),
          distanceUnit,
          bearingFormat
        }
      })
    }

    if (exportPoints) {
      wgs84.forEach((coord, i) => {
        const props: Record<string, any> = { 'marker-color': traverseColor, index: i, type: i === 0 ? 'start' : 'vertex' }
        if (i > 0) {
          const { course } = validCourses[i - 1]
          props.courseType   = course.type
          props.bearing      = course.bearing
          props.distance     = parseFloat(course.distance)
          props.distanceUnit = course.unit
          if (course.type === 'curve') {
            props.radius        = parseFloat(course.radius || '0')
            props.curveDirection = course.curveDirection || 'right'
          }
        }
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: props })
      })
    }

    if (exportPolygon && validCourses.length >= 2) {
      const ring = [...denseWgs84, denseWgs84[0]]
      const polyProps: Record<string, any> = { fill: traverseColor, 'fill-opacity': 0.2, stroke: traverseColor }
      if (closureReport) {
        polyProps.areaAcres    = parseFloat(closureReport.areaAcres.toFixed(4))
        polyProps.areaSqFt     = Math.round(closureReport.areaSqFt)
        polyProps.closureError = parseFloat(closureReport.closureError.toFixed(4))
        polyProps.precisionRatio = `1:${closureReport.precisionRatio.toLocaleString()}`
      }
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: polyProps })
    }

    const geojson = { type: 'FeatureCollection', features }
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (exportFileName.trim() || 'traverse') + '.geojson'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // -------------------------------------------------------------------------
  // Render helpers — bearing cell
  // -------------------------------------------------------------------------

  _renderBearingCell (course: TraverseCourse, i: number): React.ReactNode {
    const { bearingFormat, bearingEntry } = this.state

    if (bearingFormat === 'quadrant' && bearingEntry === 'number') {
      const qNum   = decodeQNum(course.bearing)
      const qAngle = decodeQAngle(course.bearing)
      return (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            ref={el => { this._qNumRefs[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            style={S.qNumInput}
            value={qNum}
            title="Quadrant: 1=NE  2=SE  3=SW  4=NW"
            placeholder="Q"
            onChange={ev => {
              const raw = ev.target.value.trim()
              const n = parseInt(raw, 10)
              if (raw === '' || (n >= 1 && n <= 4)) {
                const newQ = raw === '' ? 1 : n
                this._updateCourse(i, 'bearing', encodeQNum(newQ, qAngle))
              }
            }}
            onKeyDown={ev => this._handleCourseKeyDown(ev, i, 'quadrant')}
          />
          <input
            ref={el => { this._qAngleRefs[i] = el }}
            type="text"
            style={{ ...S.input, flex: 1 }}
            value={qAngle}
            placeholder="45 30 00"
            title="Degrees minutes seconds — e.g. 45 30 00"
            onChange={ev => {
              this._updateCourse(i, 'bearing', encodeQNum(qNum, ev.target.value))
            }}
            onKeyDown={ev => this._handleCourseKeyDown(ev, i, 'bearing')}
          />
        </div>
      )
    }

    const bPlaceholder = bearingFormat === 'quadrant' ? "N 45°30'00\" E" : '045.5000'
    return (
      <input
        ref={el => { this._bearingRefs[i] = el }}
        type="text"
        style={S.input}
        value={course.bearing}
        placeholder={bPlaceholder}
        onChange={ev => this._updateCourse(i, 'bearing', ev.target.value)}
        onKeyDown={ev => this._handleCourseKeyDown(ev, i, 'bearing')}
      />
    )
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  render () {
    const { jimuMapView, modulesLoaded, isPickingStart, isDrawingCourses, startPoint, courses,
      bearingFormat, bearingEntry, distanceUnit, closureReport, parseError,
      selectedCourseIndex, traverseColor, exportLineString, exportPoints, exportPolygon,
      popupEnabled, rotationOffset, rotationPoint, isPickingRotationPoint, snappingEnabled } = this.state
    const mapReady = !!jimuMapView && modulesLoaded
    const drawn = closureReport !== null
    const rotationOffsetNum = parseFloat(rotationOffset) || 0

    this._bearingRefs.length  = courses.length
    this._distanceRefs.length = courses.length
    this._qNumRefs.length     = courses.length
    this._qAngleRefs.length   = courses.length

    let hintText: string
    if (bearingFormat === 'azimuth') {
      hintText = 'Azimuth: 045.5000  (0–360° clockwise from north)'
    } else if (bearingEntry === 'number') {
      hintText = 'Quadrant #: type 1–4, then enter angle as D M S  (e.g. 45 30 00)\nQ1=NE  Q2=SE  Q3=SW  Q4=NW'
    } else {
      hintText = "Quadrant: N 45°30'00\" E  or  S12 30 00W  or  N45.504E"
    }

    return (
      <div style={S.wrap}>
        <JimuMapViewComponent
          useMapWidgetId={this.props.useMapWidgetIds?.[0]}
          onActiveViewChange={this._onViewChange}
        />

        <div style={S.header}>Traverse Tool</div>

        <div style={S.body}>
          {!jimuMapView && (
            <div style={S.warn}>Connect this widget to a map in the widget settings.</div>
          )}

          {/* Map Identify Popup toggle */}
          <div style={S.section}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#475569' }}>
              <input
                type="checkbox"
                checked={popupEnabled}
                onChange={() => this._togglePopup()}
              />
              Allow Popups?
            </label>
          </div>

          {/* Snapping toggle */}
          <div style={S.section}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#475569' }}>
              <input
                type="checkbox"
                checked={snappingEnabled}
                onChange={() => this._toggleSnapping()}
              />
              Snap to Map Features
            </label>
            {snappingEnabled && (
              <div style={{ ...S.hint, marginTop: '4px', marginBottom: 0 }}>
                All map picks snap to vertices and edges of visible layers. Hold Ctrl to bypass.
              </div>
            )}
          </div>

          {/* Starting Point */}
          <div style={S.section}>
            <div style={S.label}>Starting Point</div>
            <calcite-button
              appearance={isPickingStart ? 'solid' : 'outline'}
              kind={isPickingStart ? 'brand' : 'neutral'}
              scale="s"
              {...(!mapReady || isDrawingCourses || isPickingRotationPoint ? { disabled: true } : {})}
              onClick={() => this._startPickingPoint()}
            >
              {isPickingStart ? 'Click on map…' : startPoint ? 'Re-pick Start' : 'Pick Start Point'}
            </calcite-button>
            {startPoint && (
              <div style={S.coordBox}>
                X: {startPoint.x.toFixed(2)}{'   '}Y: {startPoint.y.toFixed(2)}
              </div>
            )}
          </div>

          {/* Draw Courses */}
          <div style={S.section}>
            <div style={S.label}>Draw Courses on Map</div>
            <calcite-button
              appearance={isDrawingCourses ? 'solid' : 'outline'}
              kind={isDrawingCourses ? 'brand' : 'neutral'}
              scale="s"
              width="full"
              {...(!mapReady || isPickingStart || isPickingRotationPoint ? { disabled: true } : {})}
              onClick={() => isDrawingCourses ? this._finishDrawingCourses() : this._startDrawingCourses()}
            >
              {isDrawingCourses ? 'Finish Drawing (Esc)' : 'Draw Courses'}
            </calcite-button>
            {isDrawingCourses && (
              <div style={S.hint}>
                Click points on the map to add courses — each click adds a leg from the last point.
                Press Esc or click Finish when done.
              </div>
            )}
          </div>

          {/* Bearing Format + Unit */}
          <div style={{ ...S.section, ...S.row, alignItems: 'flex-start', gap: '14px' }}>
            <div style={{ flex: 1 }}>
              <div style={S.label}>Bearing Format</div>
              <div style={S.row}>
                <calcite-button
                  appearance={bearingFormat === 'quadrant' ? 'solid' : 'outline'}
                  kind={bearingFormat === 'quadrant' ? 'brand' : 'neutral'}
                  scale="s"
                  style={{ flex: 1 }}
                  onClick={() => this.setState({ bearingFormat: 'quadrant', closureReport: null })}
                >Quadrant</calcite-button>
                <calcite-button
                  appearance={bearingFormat === 'azimuth' ? 'solid' : 'outline'}
                  kind={bearingFormat === 'azimuth' ? 'brand' : 'neutral'}
                  scale="s"
                  style={{ flex: 1 }}
                  onClick={() => this.setState({ bearingFormat: 'azimuth', closureReport: null })}
                >Azimuth</calcite-button>
              </div>

              {bearingFormat === 'quadrant' && (
                <div style={{ ...S.entryToggle, marginTop: '6px' }}>
                  <span style={S.entryToggleLabel}>Entry:</span>
                  <calcite-button
                    appearance={bearingEntry === 'letters' ? 'solid' : 'outline'}
                    kind={bearingEntry === 'letters' ? 'brand' : 'neutral'}
                    scale="s"
                    title="Enter bearing as N/S + angle + E/W (traditional)"
                    onClick={() => this.setState({ bearingEntry: 'letters', closureReport: null })}
                  >N/S E/W</calcite-button>
                  <calcite-button
                    appearance={bearingEntry === 'number' ? 'solid' : 'outline'}
                    kind={bearingEntry === 'number' ? 'brand' : 'neutral'}
                    scale="s"
                    title="Enter bearing as quadrant number (1–4) + DMS angle"
                    onClick={() => this.setState({ bearingEntry: 'number', closureReport: null })}
                  >Q1–Q4</calcite-button>
                </div>
              )}
            </div>

            <div>
              <div style={S.label} title="Default unit for new courses; also the unit used to summarize the closure report">Default / Report Unit</div>
              <calcite-select ref={this._unitSelectRef} scale="s">
                <calcite-option value="feet"   {...(distanceUnit === 'feet'   ? { selected: true } : {})}>Feet</calcite-option>
                <calcite-option value="chains" {...(distanceUnit === 'chains' ? { selected: true } : {})}>Chains</calcite-option>
                <calcite-option value="meters" {...(distanceUnit === 'meters' ? { selected: true } : {})}>Meters</calcite-option>
                <calcite-option value="rods"   {...(distanceUnit === 'rods'   ? { selected: true } : {})}>Rods</calcite-option>
              </calcite-select>
            </div>
            <div>
              <div style={S.label}>Color</div>
              <input
                type="color"
                value={traverseColor}
                style={{ width: '40px', height: '30px', border: '1px solid #e2e8f0', borderRadius: '5px', cursor: 'pointer', padding: '1px 2px' }}
                onChange={ev => this.setState({ traverseColor: ev.target.value })}
              />
            </div>
          </div>

          {/* Courses Table */}
          <div style={S.section}>
            <div style={{ ...S.row, marginBottom: '6px' }}>
              <span style={S.label}>Traverse Courses ({courses.length})</span>
              <calcite-button
                appearance="outline"
                kind="neutral"
                scale="s"
                icon-start="plus"
                style={{ marginLeft: 'auto' }}
                onClick={() => this._addCourse(false)}
              >Add Leg</calcite-button>
            </div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={{ ...S.th, width: '22px' }}>#</th>
                  <th style={{ ...S.th, width: '42px' }}>Type</th>
                  <th style={S.th}>
                    {bearingFormat === 'quadrant' && bearingEntry === 'number'
                      ? 'Q# + Angle (D M S)'
                      : 'Bearing'}
                  </th>
                  <th style={{ ...S.th, width: '76px' }}>Distance</th>
                  <th style={{ ...S.th, width: '48px' }}>Unit</th>
                  <th style={{ ...S.th, width: '26px' }}></th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course, i) => {
                  const isSelected = i === selectedCourseIndex
                  const isCurve = course.type === 'curve'
                  const curveDirection = course.curveDirection ?? 'right'
                  const rowStyle: React.CSSProperties = isSelected
                    ? { ...S.trSelected, cursor: 'pointer' }
                    : { cursor: 'pointer' }
                  return (
                    <React.Fragment key={i}>
                      <tr
                        style={rowStyle}
                        onClick={() => {
                          this.setState(prev => ({
                            selectedCourseIndex: prev.selectedCourseIndex === i ? null : i
                          }))
                        }}
                      >
                        <td style={{ ...S.td, color: isSelected ? '#0369a1' : '#94a3b8', fontWeight: '600', fontSize: '11px' }}>{i + 1}</td>
                        <td style={S.td} onClick={ev => ev.stopPropagation()}>
                          <calcite-button
                            appearance={isCurve ? 'solid' : 'outline'}
                            kind={isCurve ? 'brand' : 'neutral'}
                            scale="s"
                            title={isCurve ? 'Curve — click to switch to a straight line' : 'Line — click to switch to a curve'}
                            onClick={() => this._updateCourseType(i, isCurve ? 'line' : 'curve')}
                          >{isCurve ? 'Crv' : 'Line'}</calcite-button>
                        </td>
                        <td style={S.td}>
                          {isCurve && <div style={{ fontSize: '9px', color: '#94a3b8', marginBottom: '2px' }}>Chord bearing</div>}
                          {this._renderBearingCell(course, i)}
                        </td>
                        <td style={S.td}>
                          {isCurve && <div style={{ fontSize: '9px', color: '#94a3b8', marginBottom: '2px' }}>Arc length</div>}
                          <input
                            ref={el => { this._distanceRefs[i] = el }}
                            type="number"
                            style={S.input}
                            value={course.distance}
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            onChange={ev => this._updateCourse(i, 'distance', ev.target.value)}
                            onKeyDown={ev => this._handleCourseKeyDown(ev, i, 'distance')}
                          />
                        </td>
                        <td style={S.td} onClick={ev => ev.stopPropagation()}>
                          <select
                            style={S.unitSelect}
                            value={course.unit}
                            title="Unit for this course's distance"
                            onChange={ev => this._updateCourseUnit(i, ev.target.value as DistanceUnit)}
                          >
                            <option value="feet">ft</option>
                            <option value="chains">ch</option>
                            <option value="meters">m</option>
                            <option value="rods">rd</option>
                          </select>
                        </td>
                        <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                          <calcite-button
                            appearance="outline"
                            kind="neutral"
                            scale="s"
                            icon-start="plus"
                            title="Insert course after"
                            onClick={ev => { ev.stopPropagation(); this._insertCourse(i) }}
                          />
                          {courses.length > 1 && (
                            <calcite-button
                              appearance="solid"
                              kind="danger"
                              scale="s"
                              icon-start="x"
                              title="Remove course"
                              onClick={ev => {
                                ev.stopPropagation()
                                if (isSelected) this._highlightLayer?.removeAll()
                                this._removeCourse(i)
                              }}
                            />
                          )}
                        </td>
                      </tr>
                      {isCurve && (
                        <tr style={isSelected ? S.trSelected : undefined}>
                          <td style={S.td} />
                          <td style={S.td} colSpan={5} onClick={ev => ev.stopPropagation()}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
                              <span>Radius:</span>
                              <input
                                type="number"
                                style={{ ...S.input, width: '70px' }}
                                value={course.radius ?? ''}
                                placeholder="0.00"
                                min="0"
                                step="0.01"
                                onChange={ev => this._updateCourse(i, 'radius', ev.target.value)}
                              />
                              <span>Direction:</span>
                              <calcite-button
                                appearance={curveDirection === 'left' ? 'solid' : 'outline'}
                                kind={curveDirection === 'left' ? 'brand' : 'neutral'}
                                scale="s"
                                title="Curve bends to the left of the direction of travel"
                                onClick={() => this._updateCourseDirection(i, 'left')}
                              >Left</calcite-button>
                              <calcite-button
                                appearance={curveDirection === 'right' ? 'solid' : 'outline'}
                                kind={curveDirection === 'right' ? 'brand' : 'neutral'}
                                scale="s"
                                title="Curve bends to the right of the direction of travel"
                                onClick={() => this._updateCourseDirection(i, 'right')}
                              >Right</calcite-button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Format hint */}
          <div style={{ ...S.hint, whiteSpace: 'pre-line' }}>{hintText}</div>

          {/* Error */}
          {parseError && <div style={S.errorBox}>{parseError}</div>}

          {/* Actions */}
          <div style={{ ...S.row, marginBottom: '6px' }}>
            <calcite-button
              appearance="solid"
              kind="brand"
              scale="s"
              style={{ flex: 1 }}
              {...(!mapReady || !startPoint ? { disabled: true } : {})}
              onClick={() => this._drawTraverse()}
            >{drawn ? 'Redraw Traverse' : 'Draw Traverse'}</calcite-button>
            <calcite-button
              appearance="outline"
              kind="neutral"
              scale="s"
              onClick={() => this._clearAll()}
            >Clear</calcite-button>
          </div>

          {/* Rotate Traverse */}
          <div style={S.section}>
            <div style={S.label}>
              Rotate Traverse (about {rotationPoint ? 'Custom Point' : 'Start Point'})
            </div>
            <div style={{ ...S.row, marginBottom: '6px' }}>
              <calcite-button
                appearance={isPickingRotationPoint ? 'solid' : 'outline'}
                kind={isPickingRotationPoint ? 'brand' : 'neutral'}
                scale="s"
                style={{ flex: 1 }}
                {...(!mapReady || !startPoint || isPickingStart || isDrawingCourses ? { disabled: true } : {})}
                onClick={() => isPickingRotationPoint
                  ? this._cancelPickingRotationPoint()
                  : this._startPickingRotationPoint()}
              >
                {isPickingRotationPoint ? 'Click on map…' : rotationPoint ? 'Re-pick Rotation Point' : 'Set Rotation Point'}
              </calcite-button>
              {rotationPoint && (
                <calcite-button
                  appearance="outline"
                  kind="neutral"
                  scale="s"
                  onClick={() => this._resetRotationPoint()}
                >Use Start Point</calcite-button>
              )}
            </div>
            {rotationPoint && (
              <div style={S.coordBox}>
                Pivot X: {rotationPoint.x.toFixed(2)}{'   '}Y: {rotationPoint.y.toFixed(2)}
              </div>
            )}
            <div style={S.row}>
              <input
                type="number"
                style={{ ...S.input, width: '90px', flex: 'none' }}
                value={rotationOffset}
                placeholder="0.0"
                step="0.1"
                title="Degrees clockwise (+) or counter-clockwise (-)"
                {...(!startPoint ? { disabled: true } : {})}
                onChange={ev => this.setState({ rotationOffset: ev.target.value })}
              />
              <span style={{ fontSize: '12px', color: '#94a3b8', flexShrink: 0 }}>°</span>
              <calcite-button
                appearance="solid"
                kind="brand"
                scale="s"
                style={{ flex: 1 }}
                {...(!startPoint || rotationOffsetNum === 0 ? { disabled: true } : {})}
                onClick={() => this._applyRotation()}
              >Apply Rotation</calcite-button>
            </div>
          </div>

          <div style={{ marginBottom: '6px' }}>
            <div style={{ ...S.label, marginBottom: '4px' }}>File Name</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="text"
                style={{ ...S.input, flex: 1 }}
                value={this.state.exportFileName}
                placeholder="traverse"
                onChange={ev => this.setState({ exportFileName: ev.target.value })}
              />
              <span style={{ fontSize: '12px', color: '#94a3b8', flexShrink: 0 }}>.geojson</span>
            </div>
          </div>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ ...S.label, marginBottom: '4px' }}>Export Geometry</div>
            <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#475569' }}>
              {([
                ['exportLineString', 'Line'] as const,
                ['exportPoints',     'Points'] as const,
                ['exportPolygon',    'Polygon'] as const
              ]).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={this.state[key]}
                    onChange={ev => this.setState({ [key]: ev.target.checked } as any)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: '14px' }}>
            <calcite-button
              appearance="outline"
              kind="neutral"
              scale="s"
              width="full"
              icon-start="download"
              {...(!startPoint ? { disabled: true } : {})}
              onClick={() => this._exportGeoJSON()}
            >Export GeoJSON</calcite-button>
          </div>

          {/* Closure Report */}
          {closureReport && (
            <div style={S.reportBox}>
              <div style={{ fontWeight: '600', fontSize: '13px', color: '#166534', marginBottom: '8px' }}>
                Closure Report
              </div>
              <div style={S.reportRow}>
                <span style={{ color: '#374151' }}>Total Perimeter</span>
                <span style={{ fontWeight: '600' }}>{closureReport.totalDist.toFixed(3)} {distanceUnit}</span>
              </div>
              <div style={S.reportRow}>
                <span style={{ color: '#374151' }}>Sum Departures</span>
                <span style={{ fontWeight: '600' }}>{closureReport.sumDep.toFixed(4)} {distanceUnit}</span>
              </div>
              <div style={S.reportRow}>
                <span style={{ color: '#374151' }}>Sum Latitudes</span>
                <span style={{ fontWeight: '600' }}>{closureReport.sumLat.toFixed(4)} {distanceUnit}</span>
              </div>
              <div style={{ ...S.reportRow, ...S.reportDivider }}>
                <span style={{ color: '#374151' }}>Closure Error</span>
                <span style={{ fontWeight: '600', color: closureReport.closureError > 0.1 ? '#dc2626' : '#166534' }}>
                  {closureReport.closureError.toFixed(4)} {distanceUnit}
                </span>
              </div>
              <div style={S.reportRow}>
                <span style={{ color: '#374151' }}>Precision Ratio</span>
                <span style={{ fontWeight: '600' }}>1 : {closureReport.precisionRatio.toLocaleString()}</span>
              </div>
              {courses.length >= 2 && (
                <div style={{ ...S.reportRow, ...S.reportDivider }}>
                  <span style={{ color: '#374151' }}>Enclosed Area</span>
                  <span style={{ fontWeight: '600' }}>
                    {closureReport.areaAcres.toFixed(4)} ac{'  '}({Math.round(closureReport.areaSqFt).toLocaleString()} sq ft)
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
}

export default TraverseWidget
