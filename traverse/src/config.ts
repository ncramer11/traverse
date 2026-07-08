import type { ImmutableObject } from 'seamless-immutable'

export type BearingFormat = 'quadrant' | 'azimuth'
export type DistanceUnit = 'feet' | 'chains' | 'meters' | 'rods'

export interface Config {
  defaultBearingFormat: BearingFormat
  defaultDistanceUnit: DistanceUnit
}

export type IMConfig = ImmutableObject<Config>
