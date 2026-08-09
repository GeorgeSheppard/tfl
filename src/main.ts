import './style.css';
import { getArrivals, searchStations } from './api';
import { addFavourite, favouriteId, getFavourites, removeFavourite } from './storage';
import { GetTflArrivalsDirection } from './api/generated';
import { lineColor, lineTextColor } from './lines';
import { Arrival, Favourite, Station } from './types';

const favouritesEl = document.querySelector<HTMLDivElement>('#favourites')!;
const addBtn = document.querySelector<HTMLButtonElement>('#add-btn')!;
const dialog = document.querySelector<HTMLDialogElement>('#add-dialog')!;
const cancelBtn = document.querySelector<HTMLButtonElement>('#cancel-add')!;

// Track in-flight requests per favourite to cancel if a new request comes in
const inFlightRequests = new Map<string, AbortController>();

const stationPickerEl = document.querySelector<HTMLDivElement>('#station-picker')!;
const searchInput = document.querySelector<HTMLInputElement>('#station-search')!;
const stationResultsEl = document.querySelector<HTMLDivElement>('#station-results')!;

const routePickerEl = document.querySelector<HTMLDivElement>('#route-picker')!;
const changeStationBtn = document.querySelector<HTMLButtonElement>('#change-station-btn')!;
const selectedStationNameEl = document.querySelector<HTMLSpanElement>('#selected-station-name')!;
const stepBackBtn = document.querySelector<HTMLButtonElement>('#step-back-btn')!;
const stepResultsEl = document.querySelector<HTMLDivElement>('#step-results')!;

function isTrainAtPlatform(location: string): boolean {
  return /\bPlatform\s*\d*\s*$/i.test(location);
}

function formatEta(seconds: number, location?: string): string {
  // If train is at platform, show "Now" regardless of timeToStationSeconds
  if (location && isTrainAtPlatform(location)) return 'Now';
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
// Station") — display-only cleanup, the raw value is still what's grouped on.
function cleanDestinationLabel(destinationName: string): string {
  const suffix = DESTINATION_SUFFIXES.find((s) => destinationName.endsWith(s));
  return suffix ? destinationName.slice(0, -suffix.length) : destinationName;
}

// TfL's currentLocation sometimes appends a platform reference (e.g. "At Edgware Road Platform
// 2") — strip it since the platform number isn't useful, just where the train physically is.
// "At Platform" alone has no station name to keep, so leave it as-is rather than reducing it to
// just "At".
function cleanCurrentLocation(location: string): string {
  const match = location.match(/^(.*?)\s+Platform\s*\d*\s*$/i);
  if (!match) return location;
  const stripped = match[1].trim();
  return stripped.toLowerCase() === 'at' || stripped === '' ? location : stripped;
}

const COMPASS_DIRECTIONS = ['Northbound', 'Southbound', 'Eastbound', 'Westbound'];

function directionLabelFor(arrival: Arrival): string {
  const compass = COMPASS_DIRECTIONS.find((d) => arrival.platformName.includes(d));
  return compass ?? `towards ${cleanDestinationLabel(arrival.destinationName)}`;
}

function lineBadgeHtml(lineId: string, lineName: string): string {
  return `<span class="line-badge" style="--line-color: ${lineColor(lineId)}; --line-text-color: ${lineTextColor(lineId)}">${lineName}</span>`;
}

// Auto-refresh interval ID
let autoRefreshInterval: number | undefined;

function startAutoRefresh(): void {
  // Clear any existing interval
  if (autoRefreshInterval) {
    window.clearInterval(autoRefreshInterval);
  }

  // Auto-refresh all favourites every 15 seconds
  autoRefreshInterval = window.setInterval(() => {
    const favourites = getFavourites();
    for (const favourite of favourites) {
      const card = document.querySelector<HTMLElement>(`[data-id="${favourite.id}"]`);
      if (card) {
        loadArrivalsForCard(card, favourite);
      }
    }
  }, 15000);
}

function renderFavourites(): void {
  const favourites = getFavourites();
  favouritesEl.innerHTML = '';

  if (favourites.length === 0) {
    favouritesEl.innerHTML = `<p class="empty">No stations yet. Tap "+ Add" to add your first one.</p>`;
    // Stop auto-refresh if no favourites
    if (autoRefreshInterval) {
      window.clearInterval(autoRefreshInterval);
      autoRefreshInterval = undefined;
    }
    return;
  }

  for (const favourite of favourites) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = favourite.id;
    card.dataset.loaded = 'false';
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

  // Start auto-refresh when there are favourites
  startAutoRefresh();
}

// Enough arrivals to see every destination currently running on this line/direction, not just
// the next couple — grouping below picks the soonest per destination out of this window.
const ARRIVALS_WINDOW = 20;

interface ArrivalGroup {
  destinationName: string;
  arrivals: Arrival[];
}

// Groups arrivals by destination — e.g. if trains to Richmond are 1/3/5 minutes away and one to
// Wimbledon is 7, Richmond and Wimbledon are shown as two rows. Only the destination is worth
// grouping by: once a train's already past this station and heading your way, the specific stop
// it's currently sitting at doesn't matter beyond the very next one.
function groupArrivalsByDestination(arrivals: Arrival[]): ArrivalGroup[] {
  const byDestination = new Map<string, Arrival[]>();
  for (const arrival of arrivals) {
    const group = byDestination.get(arrival.destinationName);
    if (group) group.push(arrival);
    else byDestination.set(arrival.destinationName, [arrival]);
  }

  return [...byDestination.entries()]
    .map(([destinationName, group]) => ({
      destinationName,
      arrivals: group.sort((a, b) => a.timeToStationSeconds - b.timeToStationSeconds),
    }))
    .sort((a, b) => a.arrivals[0].timeToStationSeconds - b.arrivals[0].timeToStationSeconds);
}

// e.g. [Due, 300, 1140] -> "Due, 5, 19 min" — one shared "min" suffix instead of repeating it.
function formatEtaList(arrivals: Arrival[]): string {
  const labels = arrivals.map((a) => formatEta(a.timeToStationSeconds, a.currentLocation));
  return labels.map((label, i) => (i === labels.length - 1 ? label : label.replace(' min', ''))).join(', ');
}

function renderArrivalGroup(group: ArrivalGroup): string {
  const [next] = group.arrivals;
  return `
    <div class="arrival-group">
      <div class="arrival">
        <div class="arrival-main">
          <span class="arrival-destination">${cleanDestinationLabel(group.destinationName)}</span>
          <span class="arrival-time">${formatEtaList(group.arrivals)}</span>
        </div>
        <span class="arrival-location">${cleanCurrentLocation(next.currentLocation)}</span>
      </div>
    </div>
  `;
}

async function loadArrivalsForCard(card: HTMLElement, favourite: Favourite): Promise<void> {
  const timesEl = card.querySelector<HTMLDivElement>('.times')!;
  const refreshBtn = card.querySelector<HTMLButtonElement>('.refresh-btn')!;

  // Cancel any previous in-flight request for this favourite
  const previousController = inFlightRequests.get(favourite.id);
  if (previousController) {
    previousController.abort();
  }

  // Create a new AbortController for this request
  const controller = new AbortController();
  inFlightRequests.set(favourite.id, controller);

  // Only show loading state if this is the first load
  const isFirstLoad = card.dataset.loaded === 'false';
  if (isFirstLoad) {
    timesEl.innerHTML = `<span class="loading">Loading…</span>`;
  }

  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');

  try {
    const arrivals = await getArrivals(favourite.stopPointId, {
      lineId: favourite.lineId,
      direction: favourite.direction,
      limit: ARRIVALS_WINDOW,
      signal: controller.signal,
    });

    if (arrivals.length === 0) {
      timesEl.innerHTML = `<span class="no-arrivals">No arrivals</span>`;
      card.dataset.loaded = 'true';
      return;
    }

    const groups = groupArrivalsByDestination(arrivals);
    timesEl.innerHTML = groups.map((group) => renderArrivalGroup(group)).join('');
    card.dataset.loaded = 'true';
  } catch (error) {
    // Don't show error if request was aborted (user triggered a new request)
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    timesEl.innerHTML = `<span class="error">Couldn't load times</span>`;
    card.dataset.loaded = 'true';
  } finally {
    // Clean up the controller if it's the current one
    if (inFlightRequests.get(favourite.id) === controller) {
      inFlightRequests.delete(favourite.id);
    }
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('spinning');
  }
}

// --- Add-station dialog -----------------------------------------------------------------------

interface RouteOption {
  lineId: string;
  lineName: string;
  direction: GetTflArrivalsDirection;
  directionLabel: string;
}

let currentStation: Station | undefined;
let routeOptions: RouteOption[] = [];

let searchDebounce: number | undefined;

function openAddDialog(): void {
  searchInput.value = '';
  stationResultsEl.innerHTML = '';
  currentStation = undefined;
  routeOptions = [];
  stationPickerEl.classList.remove('hidden');
  routePickerEl.classList.add('hidden');
  dialog.showModal();
  searchInput.focus();
}

function backToStationPicker(): void {
  routePickerEl.classList.add('hidden');
  stationPickerEl.classList.remove('hidden');
  searchInput.focus();
}

async function handleStationSearch(): Promise<void> {
  const query = searchInput.value.trim();
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
  currentStation = station;
  selectedStationNameEl.textContent = station.name;
  stationPickerEl.classList.add('hidden');
  routePickerEl.classList.remove('hidden');

  stepResultsEl.innerHTML = `<p class="loading">Loading lines…</p>`;
  hideStepBack();

  try {
    // High limit here — this is a live snapshot used only to discover which lines/directions
    // are currently running at this station, not the arrivals themselves.
    // Use 200 to handle busy stations with many lines/directions (e.g. Victoria, King's Cross).
    const arrivals = await getArrivals(station.id, { limit: 200 });
    const byLineDirection = new Map<string, RouteOption>();
    for (const arrival of arrivals) {
      const key = `${arrival.lineId}:${arrival.direction}`;
      if (!byLineDirection.has(key)) {
        byLineDirection.set(key, {
          lineId: arrival.lineId,
          lineName: arrival.lineName,
          direction: arrival.direction as GetTflArrivalsDirection,
          directionLabel: directionLabelFor(arrival),
        });
      }
    }
    routeOptions = [...byLineDirection.values()];

    if (routeOptions.length === 0) {
      stepResultsEl.innerHTML = `<p class="empty">No live arrivals right now, try again later</p>`;
      return;
    }

    const distinctLineIds = new Set(routeOptions.map((o) => o.lineId));
    if (distinctLineIds.size === 1) {
      // Nothing to pick between — skip straight to the direction step.
      showDirections(routeOptions[0].lineId, undefined);
    } else {
      showLines();
    }
  } catch (error) {
    stepResultsEl.innerHTML = `<p class="error">Couldn't load lines for this station</p>`;
  }
}

function showStepBack(label: string, onClick: () => void): void {
  stepBackBtn.textContent = label;
  stepBackBtn.onclick = onClick;
  stepBackBtn.classList.remove('hidden');
}

function hideStepBack(): void {
  stepBackBtn.onclick = null;
  stepBackBtn.classList.add('hidden');
}

function showLines(): void {
  hideStepBack();
  stepResultsEl.innerHTML = '';

  const seenLines = new Map<string, RouteOption>();
  for (const option of routeOptions) {
    if (!seenLines.has(option.lineId)) seenLines.set(option.lineId, option);
  }

  for (const option of seenLines.values()) {
    const btn = document.createElement('button');
    btn.className = 'result-btn';
    btn.style.setProperty('--line-color', lineColor(option.lineId));
    btn.innerHTML = lineBadgeHtml(option.lineId, option.lineName);
    btn.addEventListener('click', () => showDirections(option.lineId, showLines));
    stepResultsEl.appendChild(btn);
  }
}

// onBack is undefined when there was nothing to pick before this step (single line overall) —
// in that case there's nowhere meaningful to go back to except the station search.
function showDirections(lineId: string, onBack: (() => void) | undefined): void {
  if (!currentStation) return;
  const station = currentStation;

  const lineOptions = routeOptions.filter((o) => o.lineId === lineId);
  if (lineOptions.length === 0) return;

  if (lineOptions.length === 1) {
    // Only one direction actually running at this station for this line — nothing left to
    // choose, add it directly.
    addFavouriteAndClose(station, lineOptions[0]);
    return;
  }

  if (onBack) showStepBack('← All lines', onBack);
  else hideStepBack();

  stepResultsEl.innerHTML = '';
  for (const option of lineOptions) {
    const lineBadge = lineBadgeHtml(option.lineId, option.lineName);
    const btn = document.createElement('button');
    btn.className = 'result-btn';
    btn.style.setProperty('--line-color', lineColor(option.lineId));
    btn.innerHTML = `${lineBadge} ${option.directionLabel}`;
    btn.addEventListener('click', () => addFavouriteAndClose(station, option));
    stepResultsEl.appendChild(btn);
  }
}

function buildFavourite(station: Station, option: RouteOption): Favourite {
  return {
    id: favouriteId(station.id, option.lineId, option.direction),
    stopPointId: station.id,
    stopName: station.name,
    lineId: option.lineId,
    lineName: option.lineName,
    direction: option.direction,
    directionLabel: option.directionLabel,
  };
}

function addFavouriteAndClose(station: Station, option: RouteOption): void {
  addFavourite(buildFavourite(station, option));
  dialog.close();
  renderFavourites();
}

addBtn.addEventListener('click', openAddDialog);
cancelBtn.addEventListener('click', () => dialog.close());
changeStationBtn.addEventListener('click', backToStationPicker);

searchInput.addEventListener('input', () => {
  window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(handleStationSearch, 300);
});

renderFavourites();
