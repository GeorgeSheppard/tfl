import { Favourite, Station } from './types';

const STORAGE_KEY = 'tfl.favourites';
const STATIONS_STORAGE_KEY = 'tfl.stations';

export function favouriteId(stopPointId: string, lineId: string): string {
  return `${stopPointId}:${lineId}`;
}

export function getFavourites(): Favourite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Favourite[]) : [];
  } catch {
    return [];
  }
}

function saveFavourites(favourites: Favourite[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favourites));
}

export function addFavourite(favourite: Favourite): Favourite[] {
  const existing = getFavourites();
  if (existing.some((f) => f.id === favourite.id)) {
    return existing;
  }
  const updated = [...existing, favourite];
  saveFavourites(updated);
  return updated;
}

export function removeFavourite(id: string): Favourite[] {
  const updated = getFavourites().filter((f) => f.id !== id);
  saveFavourites(updated);
  return updated;
}

// The full tube station + line list, fetched once and cached here so station search and line
// selection keep working offline (e.g. underground) — only live arrivals need a network request.
export function getCachedStations(): Station[] {
  try {
    const raw = localStorage.getItem(STATIONS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Station[]) : [];
  } catch {
    return [];
  }
}

export function saveCachedStations(stations: Station[]): void {
  localStorage.setItem(STATIONS_STORAGE_KEY, JSON.stringify(stations));
}
