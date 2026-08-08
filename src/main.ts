import './style.css';
import { getArrivals, searchStations } from './api';
import { addFavourite, favouriteId, getFavourites, removeFavourite } from './storage';
import { GetTflArrivalsDirection } from './api/generated';
import { lineColor, lineTextColor } from './lines';
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

const COMPASS_DIRECTIONS = ['Northbound', 'Southbound', 'Eastbound', 'Westbound'];

function directionLabelFor(arrival: Arrival): string {
  const compass = COMPASS_DIRECTIONS.find((d) => arrival.platformName.includes(d));
  return compass ?? `towards ${arrival.destinationName}`;
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
    card.style.setProperty('--line-color', lineColor(favourite.lineId));
    card.style.setProperty('--line-text-color', lineTextColor(favourite.lineId));
    card.innerHTML = `
      <div class="card-header">
        <div>
          <h2>${favourite.stopName}</h2>
          <p class="subtitle">
            <span class="line-badge">${favourite.lineName}</span>
            ${favourite.directionLabel}
          </p>
        </div>
        <div class="card-actions">
          <button class="refresh-btn" aria-label="Refresh ${favourite.stopName}">↻</button>
          <button class="remove-btn" aria-label="Remove ${favourite.stopName}">✕</button>
        </div>
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

    card.querySelector('.refresh-btn')!.addEventListener('click', () => {
      loadArrivalsForCard(card, favourite);
    });

    loadArrivalsForCard(card, favourite);
  }
}

async function loadArrivalsForCard(card: HTMLElement, favourite: Favourite): Promise<void> {
  const timesEl = card.querySelector<HTMLDivElement>('.times')!;
  const refreshBtn = card.querySelector<HTMLButtonElement>('.refresh-btn')!;

  timesEl.innerHTML = `<span class="loading">Loading…</span>`;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');

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
      .map(
        (arrival) => `
          <div class="arrival">
            <span class="time">${formatEta(arrival.timeToStationSeconds)}</span>
            <span class="location">${arrival.currentLocation}</span>
          </div>
        `
      )
      .join('');
  } catch {
    timesEl.innerHTML = `<span class="error">Couldn't load times</span>`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('spinning');
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
    const label = directionLabelFor(arrival);
    const btn = document.createElement('button');
    btn.className = 'result-btn';
    btn.style.setProperty('--line-color', lineColor(arrival.lineId));
    btn.innerHTML = `<span class="line-badge" style="--line-color: ${lineColor(arrival.lineId)}; --line-text-color: ${lineTextColor(arrival.lineId)}">${arrival.lineName}</span> ${label}`;
    btn.addEventListener('click', () => {
      const favourite: Favourite = {
        id: favouriteId(station.id, arrival.lineId, arrival.direction),
        stopPointId: station.id,
        stopName: station.name,
        lineId: arrival.lineId,
        lineName: arrival.lineName,
        // TfL always returns 'inbound'/'outbound' here even though the schema types it as string
        direction: arrival.direction as GetTflArrivalsDirection,
        destinationName: arrival.destinationName,
        directionLabel: label,
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
