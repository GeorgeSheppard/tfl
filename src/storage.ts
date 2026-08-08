import { Favourite } from './types';

const STORAGE_KEY = 'tfl.favourites';

export function favouriteId(
  stopPointId: string,
  lineId: string,
  direction: string,
  terminus?: string
): string {
  return `${stopPointId}:${lineId}:${direction}:${terminus ?? '*'}`;
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
