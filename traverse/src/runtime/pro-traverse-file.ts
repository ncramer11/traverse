/**
 * ArcGIS Pro / ArcMap traverse file (.txt) reader and writer.
 *
 * Format reference:
 *   https://doc.esri.com/en/arcgis-pro/latest/help/editing/traverse-file-format.html
 *
 * A traverse file is a plain-text file of header directives followed by one
 * line per course:
 *
 *   DT QB                        direction type   QB | NA | SA | P
 *   DU DMS                       direction units  DD | DMS | R | G
 *   SP 454868.9 298986.09        start point (required)
 *   EP 454868.9 298986.09        end point (optional)
 *   DD N90-0-0E 105              direction + distance
 *   AD 45-0-0 100                angle + distance (never the first course)
 *   TC C 45 D 100-0-0 L          tangent curve
 *   NC C 45 D 100-0-0 C N45-0-0E R   nontangent curve
 *
 * Esri's rules that shape this module: a direction carries no internal spaces,
 * and every distance is a bare numeral "in the distance units of the coordinate
 * system into which the traverse is loaded" — the file itself names no unit. So
 * a writer has to normalize every course to ONE unit and tell the user which,
 * and a reader has to be told which unit to assume. That is why
 * `buildProTraverseFile` takes distances already converted, and
 * `parseProTraverseFile` returns bare numbers for the caller to tag.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProDirectionType = 'QB' | 'NA' | 'SA' | 'P'
export type ProDirectionUnits = 'DD' | 'DMS' | 'R' | 'G'
export type ProCurveDirection = 'left' | 'right'

/** One parsed course, normalized to an absolute azimuth in degrees. */
export interface ProCourse {
  type: 'line' | 'curve'
  /** Absolute azimuth, 0–360° clockwise from north. For a curve, the CHORD azimuth. */
  az: number
  /** For a line, its length. For a curve, its ARC length. In the file's distance units. */
  distance: number
  /** Curve only — radius, in the file's distance units. */
  radius?: number
  /** Curve only — which way the arc bends relative to the direction of travel. */
  curveDirection?: ProCurveDirection
}

export interface ProTraverseFile {
  directionType: ProDirectionType
  directionUnits: ProDirectionUnits
  startPoint: { x: number; y: number } | null
  endPoint: { x: number; y: number } | null
  courses: ProCourse[]
  /** Non-fatal problems: unknown keywords, assumptions made, courses skipped. */
  warnings: string[]
}

export class ProTraverseParseError extends Error {}

// ---------------------------------------------------------------------------
// Angle helpers
// ---------------------------------------------------------------------------

const norm360 = (deg: number): number => {
  const r = deg % 360
  return r < 0 ? r + 360 : r
}

/** Splits a decimal degree value into whole degrees, minutes and seconds. */
function toDms (angle: number): { d: number; m: number; s: number } {
  let d = Math.floor(angle)
  const minF = (angle - d) * 60
  let m = Math.floor(minF)
  let s = Math.round((minF - m) * 60)
  if (s === 60) { s = 0; m++ }
  if (m === 60) { m = 0; d++ }
  return { d, m, s }
}

/** "45-30-0" — Esri's DMS punctuation, unpadded, as in the documented sample. */
function formatDms (angle: number): string {
  const { d, m, s } = toDms(angle)
  return `${d}-${m}-${s}`
}

/** Parses "45-30-00", "45-30", "45", or a bare decimal, into decimal degrees. */
function parseDmsParts (raw: string): number | null {
  const parts = raw.split('-').filter(p => p !== '')
  if (parts.length === 0) return null
  const nums = parts.map(p => parseFloat(p))
  if (nums.some(n => isNaN(n))) return null
  const [d, m = 0, s = 0] = nums
  return d + m / 60 + s / 3600
}

/** Converts an angle in the file's direction units into decimal degrees. */
function angleToDegrees (raw: string, units: ProDirectionUnits): number | null {
  const str = raw.trim()
  if (!str) return null
  if (units === 'DMS') return parseDmsParts(str)
  const val = parseFloat(str)
  if (isNaN(val)) return null
  if (units === 'DD') return val
  if (units === 'R') return val * 180 / Math.PI
  if (units === 'G') return val * 0.9 // 400 gradians = 360°
  return null
}

/** Formats decimal degrees in the file's direction units (no internal spaces). */
function degreesToAngle (deg: number, units: ProDirectionUnits): string {
  if (units === 'DMS') return formatDms(deg)
  if (units === 'R') return (deg * Math.PI / 180).toFixed(8)
  if (units === 'G') return (deg / 0.9).toFixed(6)
  return deg.toFixed(6)
}

// ---------------------------------------------------------------------------
// Direction strings
// ---------------------------------------------------------------------------

/**
 * Renders an absolute azimuth as a direction token in the file's type/units.
 * Quadrant bearings come out as N45-30-0E; azimuths as a bare angle.
 */
export function formatProDirection (
  az: number, type: ProDirectionType, units: ProDirectionUnits
): string {
  const a = norm360(az)
  if (type === 'QB') {
    let ns: string, ew: string, angle: number
    if (a <= 90)       { ns = 'N'; ew = 'E'; angle = a }
    else if (a <= 180) { ns = 'S'; ew = 'E'; angle = 180 - a }
    else if (a <= 270) { ns = 'S'; ew = 'W'; angle = a - 180 }
    else               { ns = 'N'; ew = 'W'; angle = 360 - a }
    return `${ns}${degreesToAngle(angle, units)}${ew}`
  }
  if (type === 'SA') return degreesToAngle(norm360(a - 180), units)
  // Polar is counterclockwise from east.
  if (type === 'P') return degreesToAngle(norm360(90 - a), units)
  return degreesToAngle(a, units)
}

/**
 * Parses a direction token into an absolute azimuth (0–360° clockwise from
 * north). Returns null if the token doesn't match the declared type/units.
 */
export function parseProDirection (
  raw: string, type: ProDirectionType, units: ProDirectionUnits
): number | null {
  // Esri forbids spaces inside a direction; strip any anyway so a hand-edited
  // file ("N 45-30-0 E") still reads.
  const str = raw.replace(/\s+/g, '').toUpperCase()
  if (!str) return null

  if (type === 'QB') {
    const m = str.match(/^([NS])(.+)([EW])$/)
    if (!m) return null
    const angle = angleToDegrees(m[2], units)
    if (angle === null || angle < 0 || angle > 90) return null
    if (m[1] === 'N' && m[3] === 'E') return angle
    if (m[1] === 'S' && m[3] === 'E') return 180 - angle
    if (m[1] === 'S' && m[3] === 'W') return 180 + angle
    return 360 - angle
  }

  const angle = angleToDegrees(str, units)
  if (angle === null) return null
  if (type === 'SA') return norm360(angle + 180)
  if (type === 'P') return norm360(90 - angle)
  return norm360(angle)
}

// ---------------------------------------------------------------------------
// Curve parameter resolution
// ---------------------------------------------------------------------------

/**
 * A curve is given by any two of: D (central angle), A (arc), C (chord),
 * R (radius). This resolves whichever pair was supplied to the (arc, radius,
 * delta) triple the widget stores.
 *
 * The A+C pair has no closed form — C/A = 2·sin(Δ/2)/Δ is transcendental — so
 * it falls back to bisection. That ratio decreases monotonically from 1 as Δ
 * grows, which is what makes bisection safe here.
 */
export function resolveProCurve (
  specs: Array<{ key: string; value: number }>
): { arc: number; radius: number; deltaRad: number } | null {
  const get = (k: string): number | undefined => specs.find(s => s.key === k)?.value
  const D = get('D')   // central angle, in degrees (already converted)
  const A = get('A')   // arc length
  const C = get('C')   // chord length
  const R = get('R')   // radius

  let deltaRad: number | null = null
  let radius: number | null = null

  if (D !== undefined) {
    deltaRad = D * Math.PI / 180
    if (R !== undefined) radius = R
    else if (A !== undefined) radius = deltaRad > 0 ? A / deltaRad : null
    else if (C !== undefined) {
      const halfSin = Math.sin(deltaRad / 2)
      radius = halfSin > 0 ? C / (2 * halfSin) : null
    }
  } else if (R !== undefined) {
    radius = R
    if (A !== undefined) deltaRad = R > 0 ? A / R : null
    else if (C !== undefined) {
      const ratio = C / (2 * R)
      if (ratio > 1 || ratio <= 0) return null
      deltaRad = 2 * Math.asin(ratio)
    }
  } else if (A !== undefined && C !== undefined) {
    if (!(A > 0) || !(C > 0) || C > A) return null
    const target = C / A
    let lo = 1e-9, hi = 2 * Math.PI - 1e-9
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2
      const f = 2 * Math.sin(mid / 2) / mid
      if (f > target) lo = mid; else hi = mid
    }
    deltaRad = (lo + hi) / 2
    radius = A / deltaRad
  }

  if (deltaRad === null || radius === null) return null
  if (!(radius > 0) || !(deltaRad > 0) || deltaRad >= 2 * Math.PI) return null
  return { arc: radius * deltaRad, radius, deltaRad }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export interface ProWriteCourse {
  type: 'line' | 'curve'
  /** Absolute azimuth; for a curve, the chord azimuth. */
  az: number
  /** Line length, or curve ARC length, in the single output unit. */
  distance: number
  radius?: number
  curveDirection?: ProCurveDirection
}

export interface ProWriteOptions {
  directionType: ProDirectionType
  directionUnits: ProDirectionUnits
  startPoint: { x: number; y: number }
  endPoint?: { x: number; y: number } | null
  courses: ProWriteCourse[]
}

const num = (v: number): string => {
  // Trim float noise without forcing a fixed precision on round values. The
  // guard matters: an unguarded /0+$/ on a zero-decimal string turns 1200
  // into 12.
  const fixed = v.toFixed(6)
  const s = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return s === '' || s === '-0' ? '0' : s
}

/**
 * Serializes a traverse to Esri traverse-file text.
 *
 * Every course is written as DD (line) or NC (nontangent curve). NC is used for
 * all curves even where one happens to be tangent to its predecessor: the
 * widget stores an absolute chord bearing per curve and never enforces
 * tangency, so TC — which derives its direction from the previous course —
 * would silently rewrite a non-tangent curve's geometry on reload.
 */
export function buildProTraverseFile (opts: ProWriteOptions): string {
  const { directionType: dt, directionUnits: du, startPoint, endPoint, courses } = opts
  const lines: string[] = [
    `DT ${dt}`,
    `DU ${du}`,
    `SP ${num(startPoint.x)} ${num(startPoint.y)}`
  ]
  if (endPoint) lines.push(`EP ${num(endPoint.x)} ${num(endPoint.y)}`)

  for (const c of courses) {
    const dir = formatProDirection(c.az, dt, du)
    if (c.type === 'curve' && c.radius && c.radius > 0) {
      const lr = c.curveDirection === 'left' ? 'L' : 'R'
      lines.push(`NC A ${num(c.distance)} R ${num(c.radius)} C ${dir} ${lr}`)
    } else {
      lines.push(`DD ${dir} ${num(c.distance)}`)
    }
  }
  return lines.join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const CURVE_SPEC_KEYS = ['D', 'A', 'C', 'R']

/** Reads "x y" or "x,y" into a point. */
function parsePointArgs (args: string[]): { x: number; y: number } | null {
  const flat = args.join(' ').replace(/,/g, ' ').trim().split(/\s+/)
  if (flat.length < 2) return null
  const x = parseFloat(flat[0]); const y = parseFloat(flat[1])
  if (isNaN(x) || isNaN(y)) return null
  return { x, y }
}

/**
 * Parses an Esri traverse file.
 *
 * Distances are returned exactly as written — the format carries no unit, so
 * the caller decides what they mean.
 *
 * Two conventions are worth stating because the format documentation leaves
 * them implicit, and both are recorded as warnings on any file that uses them:
 *
 * - **AD** turns its angle from the BACKSIGHT (the previous course reversed),
 *   clockwise, which is the standard occupy-backsight-turn-right convention.
 *   Esri's angle entry uses `+` for clockwise and `-` for anticlockwise; an
 *   unsigned angle is read as clockwise.
 * - **TC** takes its tangent direction from the previous course's forward
 *   azimuth, so its chord runs at tangent ± Δ/2 (+ right, − left).
 */
export function parseProTraverseFile (text: string): ProTraverseFile {
  const warnings: string[] = []
  let directionType: ProDirectionType | null = null
  let directionUnits: ProDirectionUnits | null = null
  let startPoint: { x: number; y: number } | null = null
  let endPoint: { x: number; y: number } | null = null
  const courses: ProCourse[] = []

  const rawLines = text.split(/\r?\n/)

  for (let ln = 0; ln < rawLines.length; ln++) {
    const line = rawLines[ln].trim()
    if (!line) continue
    const where = `line ${ln + 1}`

    const tokens = line.split(/\s+/)
    const keyword = tokens[0].toUpperCase()
    const args = tokens.slice(1)

    // -- Header -------------------------------------------------------------
    if (keyword === 'DT') {
      const v = (args[0] || '').toUpperCase()
      if (v !== 'QB' && v !== 'NA' && v !== 'SA' && v !== 'P') {
        throw new ProTraverseParseError(`Unknown direction type "${args[0]}" on ${where}. Expected QB, NA, SA or P.`)
      }
      directionType = v
      continue
    }
    if (keyword === 'DU') {
      const v = (args[0] || '').toUpperCase()
      if (v !== 'DD' && v !== 'DMS' && v !== 'R' && v !== 'G') {
        throw new ProTraverseParseError(`Unknown direction units "${args[0]}" on ${where}. Expected DD, DMS, R or G.`)
      }
      directionUnits = v
      continue
    }
    if (keyword === 'SP') {
      startPoint = parsePointArgs(args)
      if (!startPoint) throw new ProTraverseParseError(`Could not read the start point on ${where}.`)
      continue
    }
    if (keyword === 'EP') {
      endPoint = parsePointArgs(args)
      if (!endPoint) warnings.push(`Ignored an unreadable end point on ${where}.`)
      continue
    }

    // Courses can't be read until the header has declared how to read them.
    if (!directionType || !directionUnits) {
      throw new ProTraverseParseError(
        `Course "${keyword}" appears on ${where} before the DT and DU header lines.`
      )
    }
    const dt = directionType; const du = directionUnits

    // -- Courses ------------------------------------------------------------
    if (keyword === 'DD') {
      const az = parseProDirection(args[0] || '', dt, du)
      const dist = parseFloat(args[1])
      if (az === null || isNaN(dist)) {
        warnings.push(`Skipped an unreadable DD course on ${where}.`)
        continue
      }
      courses.push({ type: 'line', az, distance: dist })
      continue
    }

    if (keyword === 'AD') {
      const prev = courses[courses.length - 1]
      if (!prev) {
        warnings.push(`Skipped an AD course on ${where} — an angle course cannot be first.`)
        continue
      }
      const signed = (args[0] || '').trim()
      const ccw = signed.startsWith('-')
      const angle = angleToDegrees(signed.replace(/^[+-]/, ''), du)
      const dist = parseFloat(args[1])
      if (angle === null || isNaN(dist)) {
        warnings.push(`Skipped an unreadable AD course on ${where}.`)
        continue
      }
      // Turned from the backsight (previous course reversed).
      const az = norm360(prev.az + 180 + (ccw ? -angle : angle))
      courses.push({ type: 'line', az, distance: dist })
      warnings.push(`${where}: AD angle read as turned ${ccw ? 'anticlockwise' : 'clockwise'} from the backsight.`)
      continue
    }

    if (keyword === 'TC' || keyword === 'NC') {
      // Two curve specs, then (NC only) a direction spec, then L|R.
      const specs: Array<{ key: string; value: number }> = []
      let i = 0
      while (i < args.length && specs.length < 2 && CURVE_SPEC_KEYS.includes(args[i].toUpperCase())) {
        const key = args[i].toUpperCase()
        const rawVal = args[i + 1] || ''
        // D is an angle in the file's direction units; the rest are distances.
        const value = key === 'D' ? angleToDegrees(rawVal, du) : parseFloat(rawVal)
        if (value === null || isNaN(value)) break
        specs.push({ key, value })
        i += 2
      }

      let dirSpec: string | null = null
      let dirValue: string | null = null
      if (keyword === 'NC') {
        const k = (args[i] || '').toUpperCase()
        if (k === 'C' || k === 'R' || k === 'T') {
          dirSpec = k
          dirValue = args[i + 1] || ''
          i += 2
        }
      }

      const lrToken = (args[i] || '').toUpperCase()
      const curveDirection: ProCurveDirection = lrToken === 'L' ? 'left' : 'right'
      if (lrToken !== 'L' && lrToken !== 'R') {
        warnings.push(`${where}: no L/R on the curve — assumed it turns right.`)
      }

      const resolved = specs.length === 2 ? resolveProCurve(specs) : null
      if (!resolved) {
        warnings.push(`Skipped an unreadable ${keyword} curve on ${where}.`)
        continue
      }
      const halfDeltaDeg = resolved.deltaRad * 90 / Math.PI // (Δ/2) in degrees
      const sign = curveDirection === 'right' ? 1 : -1

      let chordAz: number | null = null
      if (keyword === 'TC') {
        const prev = courses[courses.length - 1]
        if (!prev) {
          warnings.push(`Skipped a TC curve on ${where} — a tangent curve cannot be first.`)
          continue
        }
        chordAz = norm360(prev.az + sign * halfDeltaDeg)
        warnings.push(`${where}: tangent curve took its direction from the previous course.`)
      } else if (dirSpec === 'C') {
        chordAz = parseProDirection(dirValue || '', dt, du)
      } else if (dirSpec === 'T') {
        const tangent = parseProDirection(dirValue || '', dt, du)
        if (tangent !== null) chordAz = norm360(tangent + sign * halfDeltaDeg)
      } else if (dirSpec === 'R') {
        // Radial points from the curve's start toward its center: 90° clockwise
        // of the tangent for a right curve, 90° anticlockwise for a left one.
        const radial = parseProDirection(dirValue || '', dt, du)
        if (radial !== null) chordAz = norm360(radial - sign * 90 + sign * halfDeltaDeg)
      } else {
        warnings.push(`Skipped an NC curve on ${where} — no chord, tangent or radial direction given.`)
        continue
      }

      if (chordAz === null) {
        warnings.push(`Skipped a ${keyword} curve on ${where} — its direction could not be read.`)
        continue
      }
      courses.push({
        type: 'curve',
        az: chordAz,
        distance: resolved.arc,
        radius: resolved.radius,
        curveDirection
      })
      continue
    }

    warnings.push(`Ignored an unrecognized line on ${where}: "${line}".`)
  }

  if (!directionType || !directionUnits) {
    throw new ProTraverseParseError('The file has no DT (direction type) and DU (direction units) header lines — it does not look like an Esri traverse file.')
  }
  if (courses.length === 0) {
    throw new ProTraverseParseError('The file contains no readable courses.')
  }

  return { directionType, directionUnits, startPoint, endPoint, courses, warnings }
}
