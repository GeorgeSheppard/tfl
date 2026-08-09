import { GetTflArrivalsDirection, getTflArrivals, getTflStations } from './api/generated';
import { Arrival, Station } from './types';

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
