import {
  GetTflArrivals200ArrivalsItem,
  GetTflArrivalsDirection,
  GetTflStations200StationsItem,
} from './api/generated';

// Types are generated from the backend's OpenAPI schema — see orval.config.ts.
export type Station = GetTflStations200StationsItem;
export type Arrival = GetTflArrivals200ArrivalsItem;

export interface Favourite {
  id: string;
  stopPointId: string;
  stopName: string;
  lineId: string;
  lineName: string;
  direction: GetTflArrivalsDirection;
  /** Undefined means "any destination on this line/direction" — e.g. Earl's Court eastbound
   * has no real branching, so filtering to one specific terminus would hide valid trains. */
  destinationName?: string;
  /** e.g. "Southbound" — derived from platformName, used for display instead of destination/inbound-outbound */
  directionLabel: string;
}
