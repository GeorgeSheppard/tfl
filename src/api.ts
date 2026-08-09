import { GetTflArrivalsDirection, getTflArrivals, getTflStations } from './api/generated';
import { Arrival, Station } from './types';

export interface StationLineData {
  stationId: string;
  stationName: string;
  lines: Array<{
    lineId: string;
    lineName: string;
    direction: string;
  }>;
}

let cachedStationLines: StationLineData[] | null = null;

export async function getStationLines(): Promise<StationLineData[]> {
  if (cachedStationLines) {
    return cachedStationLines;
  }

  const response = await fetch('/api/tfl/station-lines');
  if (!response.ok) {
    throw new Error(`Failed to fetch station lines: ${response.statusText}`);
  }

  const data = (await response.json()) as { stations: StationLineData[] };
  cachedStationLines = data.stations;
  return cachedStationLines;
}

export async function searchStations(query: string): Promise<Station[]> {
  const { stations } = await getTflStations({ query });
  return stations;
}

export async function getArrivals(
  stopPointId: string,
  options: {
    lineId?: string;
    direction?: GetTflArrivalsDirection;
    limit?: number;
    signal?: AbortSignal;
  } = {}
): Promise<Arrival[]> {
  const { signal, ...params } = options;
  const { arrivals } = await getTflArrivals({ stopPointId, ...params }, { signal });
  return arrivals;
}
