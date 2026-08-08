import './style.css';
import { getArrivals, searchStations } from './api';
import { addFavourite, favouriteId, getFavourites, removeFavourite } from './storage';
import { Arrival, Favourite, Station } from './types';

const favouritesEl = document.querySelector<HTMLDivElement>('#favourites')!;
const addBtn = document.querySelector<HTMLButtonElement>('#add-btn')!;
const dialog = document.querySelector<HTMLDialogElement>('#add-dialog')!;
const searchInput = document.querySelector<HTMLInputElement>('#station-search')!;
const stationResultsEl = document.querySelector<HTMLDivElement>('#station-results')!;
const routeResultsEl = document.querySelector<HTMLDivElement>('#route-results')!;
const cancelBtn = document.querySelector<HTMLButtonElement>('#cancel-add')!;

function formatEta(seconds: number): string {
  if (seconds < 30) return 'Due';
  return `${Math.round(seconds / 60)} min`;
}

function renderFavourites(): void {
  const favourites = getFavourites();
  favouritesEl.innerHTML = '';

  if (favourites.length === 0) {
    favouritesEl.innerHTML = `<p class="empty">No stations yet. Tap "+ Add" to add your first one.</p>`;
    return;
  }

  for (const favourite of favourites) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = favourite.id;
    card.innerHTML = `
      <div class="card-header">
        <div>
          <h2>${favourite.stopName}</h2>
          <p class="subtitle">${favourite.lineName} — towards ${favourite.destinationName}</p>
        </div>
        <button class="remove-btn" aria-label="Remove ${favourite.stopName}">✕</button>
      </div>
      <div class="times">
        <span class="loading">Loading…</span>
      </div>
    `;
    favouritesEl.appendChild(card);

    card.querySelector('.remove-btn')!.addEventListener('click', () => {
      removeFavourite(favourite.id);
      renderFavourites();
    });

    loadArrivalsForCard(card, favourite);
  }
}

async function loadArrivalsForCard(card: HTMLElement, favourite: Favourite): Promise<void> {
  const timesEl = card.querySelector<HTMLDivElement>('.times')!;
  try {
    const arrivals = await getArrivals(favourite.stopPointId, {
      lineId: favourite.lineId,
      direction: favourite.direction,
      limit: 3,
    });

    if (arrivals.length === 0) {
      timesEl.innerHTML = `<span class="no-arrivals">No arrivals</span>`;
      return;
    }

    timesEl.innerHTML = arrivals
      .map((arrival) => `<span class="time">${formatEta(arrival.timeToStationSeconds)}</span>`)
      .join('');
  } catch {
    timesEl.innerHTML = `<span class="error">Couldn't load times</span>`;
  }
}

let searchDebounce: number | undefined;

function openAddDialog(): void {
  searchInput.value = '';
  stationResultsEl.innerHTML = '';
  routeResultsEl.innerHTML = '';
  dialog.showModal();
  searchInput.focus();
}

async function handleStationSearch(): Promise<void> {
  const query = searchInput.value.trim();
  routeResultsEl.innerHTML = '';
  if (query.length < 2) {
    stationResultsEl.innerHTML = '';
    return;
  }

  try {
    const stations = await searchStations(query);
    renderStationResults(stations);
  } catch {
    stationResultsEl.innerHTML = `<p class="error">Search failed, try again</p>`;
  }
}

function renderStationResults(stations: Station[]): void {
  stationResultsEl.innerHTML = '';
  if (stations.length === 0) {
    stationResultsEl.innerHTML = `<p class="empty">No stations found</p>`;
    return;
  }

  for (const station of stations) {
    const btn = document.createElement('button');
    btn.className = 'result-btn';
    btn.textContent = station.name;
    btn.addEventListener('click', () => handleStationSelected(station));
    stationResultsEl.appendChild(btn);
  }
}

async function handleStationSelected(station: Station): Promise<void> {
  stationResultsEl.innerHTML = '';
  routeResultsEl.innerHTML = `<p class="loading">Loading lines…</p>`;

  try {
    const arrivals = await getArrivals(station.id, { limit: 50 });
    renderRouteResults(station, arrivals);
  } catch {
    routeResultsEl.innerHTML = `<p class="error">Couldn't load lines for this station</p>`;
  }
}

function renderRouteResults(station: Station, arrivals: Arrival[]): void {
  const seen = new Map<string, Arrival>();
  for (const arrival of arrivals) {
    const key = `${arrival.lineId}:${arrival.direction}`;
    if (!seen.has(key)) seen.set(key, arrival);
  }

  routeResultsEl.innerHTML = '';

  if (seen.size === 0) {
    routeResultsEl.innerHTML = `<p class="empty">No live arrivals right now, try again later</p>`;
    return;
  }

  for (const arrival of seen.values()) {
    const btn = document.createElement('button');
    btn.className = 'result-btn';
    btn.textContent = `${arrival.lineName} — towards ${arrival.destinationName}`;
    btn.addEventListener('click', () => {
      const favourite: Favourite = {
        id: favouriteId(station.id, arrival.lineId, arrival.direction),
        stopPointId: station.id,
        stopName: station.name,
        lineId: arrival.lineId,
        lineName: arrival.lineName,
        direction: arrival.direction,
        destinationName: arrival.destinationName,
      };
      addFavourite(favourite);
      dialog.close();
      renderFavourites();
    });
    routeResultsEl.appendChild(btn);
  }
}

addBtn.addEventListener('click', openAddDialog);
cancelBtn.addEventListener('click', () => dialog.close());
searchInput.addEventListener('input', () => {
  window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(handleStationSearch, 300);
});

renderFavourites();
