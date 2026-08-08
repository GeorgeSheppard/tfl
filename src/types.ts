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
  /** e.g. "Southbound" — derived from platformName, used for display instead of inbound/outbound */
  directionLabel: string;
}
