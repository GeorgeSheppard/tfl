export interface Station {
  id: string;
  name: string;
}

export interface Arrival {
  lineId: string;
  lineName: string;
  platformName: string;
  direction: string;
  destinationName: string;
  timeToStationSeconds: number;
  expectedArrival: string;
  currentLocation: string;
}

export interface Favourite {
  id: string;
  stopPointId: string;
  stopName: string;
  lineId: string;
  lineName: string;
  direction: string;
  destinationName: string;
  /** e.g. "Southbound" — derived from platformName, used for display instead of destination/inbound-outbound */
  directionLabel: string;
}
