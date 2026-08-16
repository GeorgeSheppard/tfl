import { getTflArrivals, getTflStations } from './api/generated';
import { Arrival, Station } from './types';

// Every tube station and the lines serving it. Meant to be fetched once and cached client-side
// (see storage.ts) rather than queried per search.
export async function fetchAllStations(): Promise<Station[]> {
  const { stations } = await getTflStations();
  return stations;
}

export async function getArrivals(
  stopPointId: string,
  options: {
    lineId: string;
    limit?: number;
    signal?: AbortSignal;
  }
): Promise<Arrival[]> {
  const { signal, ...params } = options;
  const { arrivals } = await getTflArrivals({ stopPointId, ...params }, { signal });
  return arrivals;
}
