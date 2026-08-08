import {
  GetTflArrivals200ArrivalsItem,
  GetTflArrivalsDirection,
  GetTflBranches200BranchesItem,
  GetTflStations200StationsItem,
} from './api/generated';

// Types are generated from the backend's OpenAPI schema — see orval.config.ts.
export type Station = GetTflStations200StationsItem;
export type Arrival = GetTflArrivals200ArrivalsItem;
export type Branch = GetTflBranches200BranchesItem;

export interface Favourite {
  id: string;
  stopPointId: string;
  stopName: string;
  lineId: string;
  lineName: string;
  direction: GetTflArrivalsDirection;
  /** e.g. "Southbound" — derived from platformName, used for display instead of destination/inbound-outbound */
  directionLabel: string;
  /** Undefined means "any destination on this line/direction" — e.g. Earl's Court eastbound has
   * no real branching, so filtering to one specific terminus would hide valid trains. When
   * present, this is every station on the chosen branch (from TfL's route topology), not just
   * its terminus — so a train that short-turns before reaching the terminus still matches. */
  destinations?: string[];
  /** The backend's raw branch label, e.g. "Wimbledon" or, when disambiguation was needed,
   * "Morden via Bank" — used for display (after frontend cleanup, see cleanBranchLabel) and as
   * the uniqueness key in favouriteId, since two branches can share a terminus. Undefined
   * exactly when destinations is undefined. */
  label?: string;
}
