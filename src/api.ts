import { Arrival, Station } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://api.georgesheppard.dev';

export async function searchStations(query: string): Promise<Station[]> {
  const url = new URL('/tfl/stations', API_BASE_URL);
  url.searchParams.set('query', query);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Station search failed: ${response.status}`);
  const data = (await response.json()) as { stations: Station[] };
  return data.stations;
}

export async function getArrivals(
  stopPointId: string,
  options: { lineId?: string; direction?: string; limit?: number } = {}
): Promise<Arrival[]> {
  const url = new URL('/tfl/arrivals', API_BASE_URL);
  url.searchParams.set('stopPointId', stopPointId);
  if (options.lineId) url.searchParams.set('lineId', options.lineId);
  if (options.direction) url.searchParams.set('direction', options.direction);
  if (options.limit) url.searchParams.set('limit', String(options.limit));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Arrivals fetch failed: ${response.status}`);
  const data = (await response.json()) as { arrivals: Arrival[] };
  return data.arrivals;
}
