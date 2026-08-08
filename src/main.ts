import './style.css';
import { getArrivals, getBranches, searchStations } from './api';
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

const DESTINATION_SUFFIXES = [
  ' Underground Station',
  ' DLR Station',
  ' Rail Station',
  ' Station',
];

// TfL's destinationName is the full official station name (e.g. "Wimbledon Underground
// Station") — display-only cleanup, the raw value is still what's stored/filtered on.
function cleanDestinationLabel(destinationName: string): string {
  const suffix = DESTINATION_SUFFIXES.find((s) => destinationName.endsWith(s));
  return suffix ? destinationName.slice(0, -suffix.length) : destinationName;
}

// The backend's label is built from the raw terminus name (e.g. "Wimbledon Underground Station
// via Bank" when disambiguation is needed), so the " Underground Station"-style suffix cleanup
// has to happen on just the terminus portion, not blindly on the end of the whole string. " via "
// is a safe split point — no real station name contains it.
function cleanBranchLabel(label: string): string {
  const viaIndex = label.indexOf(' via ');
  if (viaIndex === -1) return cleanDestinationLabel(label);
  return cleanDestinationLabel(label.slice(0, viaIndex)) + label.slice(viaIndex);
}

const COMPASS_DIRECTIONS = ['Northbound', 'Southbound', 'Eastbound', 'Westbound'];

function directionLabelFor(arrival: Arrival): string {
  const compass = COMPASS_DIRECTIONS.find((d) => arrival.platformName.includes(d));
  return compass ?? `towards ${cleanDestinationLabel(arrival.destinationName)}`;
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
    const destinationSuffix = favourite.label ? ` · ${cleanBranchLabel(favourite.label)}` : '';
    card.innerHTML = `
      <div class="card-header">
        <div>
          <h2>${favourite.stopName}</h2>
          <p class="subtitle">
            <span class="line-badge">${favourite.lineName}</span>
            ${favourite.directionLabel}${destinationSuffix}
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
      destinationName: favourite.destinations,
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
            <span class="arrival-destination">${cleanDestinationLabel(arrival.destinationName)}</span>
            <span class="arrival-location">${arrival.currentLocation}</span>
            <span class="arrival-time">${formatEta(arrival.timeToStationSeconds)}</span>
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
    await renderRouteResults(station, arrivals);
  } catch {
    routeResultsEl.innerHTML = `<p class="error">Couldn't load lines for this station</p>`;
  }
}

function createRouteButton(
  station: Station,
  representative: Arrival,
  directionLabel: string,
  destinations: string[] | undefined,
  branchLabel: string | undefined,
  buttonHtml: string,
  dashed: boolean
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = dashed ? 'result-btn result-btn--any' : 'result-btn';
  btn.style.setProperty('--line-color', lineColor(representative.lineId));
  btn.innerHTML = buttonHtml;
  btn.addEventListener('click', () => {
    const favourite: Favourite = {
      id: favouriteId(station.id, representative.lineId, representative.direction, branchLabel),
      stopPointId: station.id,
      stopName: station.name,
      lineId: representative.lineId,
      lineName: representative.lineName,
      // TfL always returns 'inbound'/'outbound' here even though the schema types it as string
      direction: representative.direction as GetTflArrivalsDirection,
      directionLabel,
      destinations,
      label: branchLabel,
    };
    addFavourite(favourite);
    dialog.close();
    renderFavourites();
  });
  return btn;
}

async function renderRouteResults(station: Station, arrivals: Arrival[]): Promise<void> {
  // One representative arrival per line+direction actually running at this station right now —
  // used to know which lines/directions are worth offering, and for direction/line display.
  // The specific branches on offer come from real TfL topology (fetched below), not from what
  // happens to be live, since which destinations are running at this exact moment is down to
  // timing luck and would otherwise hide branches or miss short-turning trains.
  const byLineDirection = new Map<string, Arrival>();
  for (const arrival of arrivals) {
    const ldKey = `${arrival.lineId}:${arrival.direction}`;
    if (!byLineDirection.has(ldKey)) byLineDirection.set(ldKey, arrival);
  }

  routeResultsEl.innerHTML = '';

  if (byLineDirection.size === 0) {
    routeResultsEl.innerHTML = `<p class="empty">No live arrivals right now, try again later</p>`;
    return;
  }

  for (const representative of byLineDirection.values()) {
    const label = directionLabelFor(representative);
    const lineBadge = `<span class="line-badge" style="--line-color: ${lineColor(representative.lineId)}; --line-text-color: ${lineTextColor(representative.lineId)}">${representative.lineName}</span>`;

    routeResultsEl.appendChild(
      createRouteButton(
        station,
        representative,
        label,
        undefined,
        undefined,
        `${lineBadge} ${label} · Any destination`,
        true
      )
    );

    try {
      const branches = await getBranches(
        station.id,
        representative.lineId,
        // TfL always returns 'inbound'/'outbound' here even though the schema types it as string
        representative.direction as GetTflArrivalsDirection
      );
      for (const branch of branches) {
        routeResultsEl.appendChild(
          createRouteButton(
            station,
            representative,
            label,
            branch.destinations,
            branch.label,
            `${lineBadge} ${label} · ${cleanBranchLabel(branch.label)}`,
            false
          )
        );
      }
    } catch {
      // Branch lookup failed for this one line/direction — "Any destination" above still works,
      // just without the more specific per-branch options for it.
    }
  }
}

addBtn.addEventListener('click', openAddDialog);
cancelBtn.addEventListener('click', () => dialog.close());
searchInput.addEventListener('input', () => {
  window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(handleStationSearch, 300);
});

renderFavourites();
