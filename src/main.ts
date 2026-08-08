import './style.css';
import { getArrivals, getBranches, searchStations } from './api';
import { addFavourite, favouriteId, getFavourites, removeFavourite } from './storage';
import { GetTflArrivalsDirection } from './api/generated';
import { lineColor, lineTextColor } from './lines';
import { Arrival, Branch, Favourite, Station } from './types';

const favouritesEl = document.querySelector<HTMLDivElement>('#favourites')!;
const addBtn = document.querySelector<HTMLButtonElement>('#add-btn')!;
const dialog = document.querySelector<HTMLDialogElement>('#add-dialog')!;
const cancelBtn = document.querySelector<HTMLButtonElement>('#cancel-add')!;

const stationPickerEl = document.querySelector<HTMLDivElement>('#station-picker')!;
const searchInput = document.querySelector<HTMLInputElement>('#station-search')!;
const stationResultsEl = document.querySelector<HTMLDivElement>('#station-results')!;

const routePickerEl = document.querySelector<HTMLDivElement>('#route-picker')!;
const changeStationBtn = document.querySelector<HTMLButtonElement>('#change-station-btn')!;
const selectedStationNameEl = document.querySelector<HTMLSpanElement>('#selected-station-name')!;
const destinationSearchInput = document.querySelector<HTMLInputElement>('#destination-search')!;
const destinationResultsEl = document.querySelector<HTMLDivElement>('#destination-results')!;
const stepBackBtn = document.querySelector<HTMLButtonElement>('#step-back-btn')!;
const stepResultsEl = document.querySelector<HTMLDivElement>('#step-results')!;

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

function lineBadgeHtml(lineId: string, lineName: string): string {
  return `<span class="line-badge" style="--line-color: ${lineColor(lineId)}; --line-text-color: ${lineTextColor(lineId)}">${lineName}</span>`;
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

// --- Add-station dialog -----------------------------------------------------------------------

interface RouteOption {
  lineId: string;
  lineName: string;
  direction: GetTflArrivalsDirection;
  directionLabel: string;
  representative: Arrival;
}

let currentStation: Station | undefined;
let routeOptions: RouteOption[] = [];
// Keyed by `${lineId}:${direction}` — populated on demand as lines are drilled into or the
// destination search needs to check across all of them. The backend also caches the underlying
// TfL topology call, so re-fetching here is cheap even if the cache gets cleared per dialog open.
const branchesCache = new Map<string, Branch[]>();

let searchDebounce: number | undefined;
let destinationSearchDebounce: number | undefined;

function openAddDialog(): void {
  searchInput.value = '';
  stationResultsEl.innerHTML = '';
  currentStation = undefined;
  routeOptions = [];
  branchesCache.clear();
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

  destinationSearchInput.value = '';
  destinationResultsEl.innerHTML = '';
  showStepResults();
  stepResultsEl.innerHTML = `<p class="loading">Loading lines…</p>`;
  hideStepBack();
  branchesCache.clear();

  try {
    const arrivals = await getArrivals(station.id, { limit: 50 });
    const byLineDirection = new Map<string, RouteOption>();
    for (const arrival of arrivals) {
      const key = `${arrival.lineId}:${arrival.direction}`;
      if (!byLineDirection.has(key)) {
        byLineDirection.set(key, {
          lineId: arrival.lineId,
          lineName: arrival.lineName,
          direction: arrival.direction as GetTflArrivalsDirection,
          directionLabel: directionLabelFor(arrival),
          representative: arrival,
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
      // Nothing to pick between — skip straight to the direction/branch step.
      await showDirections(routeOptions[0].lineId, undefined);
    } else {
      showLines();
    }
  } catch {
    stepResultsEl.innerHTML = `<p class="error">Couldn't load lines for this station</p>`;
  }
}

let stepBackVisible = false;

function showStepBack(label: string, onClick: () => void): void {
  stepBackBtn.textContent = label;
  stepBackBtn.onclick = onClick;
  stepBackVisible = true;
  stepBackBtn.classList.remove('hidden');
}

function hideStepBack(): void {
  stepBackBtn.onclick = null;
  stepBackVisible = false;
  stepBackBtn.classList.add('hidden');
}

// Restores the step container after the destination search (which hides it) is cleared —
// showStepBack()/hideStepBack() remain the source of truth for whether the back button itself
// should be visible.
function showStepResults(): void {
  stepResultsEl.classList.remove('hidden');
  stepBackBtn.classList.toggle('hidden', !stepBackVisible);
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
async function showDirections(lineId: string, onBack: (() => void) | undefined): Promise<void> {
  const lineOptions = routeOptions.filter((o) => o.lineId === lineId);
  if (lineOptions.length === 0) return;

  if (lineOptions.length === 1) {
    // Only one direction actually running at this station for this line — skip straight to
    // the branch step.
    await resolveBranches(lineOptions[0], onBack);
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
    btn.addEventListener('click', () => resolveBranches(option, () => showDirections(lineId, onBack)));
    stepResultsEl.appendChild(btn);
  }
}

async function getBranchesFor(lineId: string, direction: GetTflArrivalsDirection): Promise<Branch[]> {
  const key = `${lineId}:${direction}`;
  const cached = branchesCache.get(key);
  if (cached) return cached;

  const branches = await getBranches(currentStation!.id, lineId, direction);
  branchesCache.set(key, branches);
  return branches;
}

// onBack is undefined exactly when this is the very first (and only) thing to show — a station
// with one line and one direction and, below, more than one branch.
async function resolveBranches(
  option: RouteOption,
  onBack: (() => void) | undefined
): Promise<void> {
  if (!currentStation) return;
  const station = currentStation;

  stepResultsEl.innerHTML = `<p class="loading">Loading branches…</p>`;
  if (onBack) showStepBack('← Back', onBack);
  else hideStepBack();

  let branches: Branch[] = [];
  try {
    branches = await getBranchesFor(option.lineId, option.direction);
  } catch {
    // Fall through with no branches — treated the same as "no real branching", below.
  }

  if (branches.length <= 1) {
    // Nothing to choose between — add directly. Use the one branch's specific destinations if
    // we found one (keeps short-turning trains covered), otherwise fall back to unfiltered.
    const branch = branches[0];
    addFavouriteAndClose(station, option, branch?.destinations, branch?.label);
    return;
  }

  const lineBadge = lineBadgeHtml(option.lineId, option.lineName);
  const elements: HTMLElement[] = [
    createRouteButton(
      station,
      option,
      undefined,
      undefined,
      `${lineBadge} ${option.directionLabel} · Any destination`,
      true
    ),
  ];
  for (const branch of branches) {
    elements.push(
      createRouteButton(
        station,
        option,
        branch.destinations,
        branch.label,
        `${lineBadge} ${option.directionLabel} · ${cleanBranchLabel(branch.label)}`,
        false
      )
    );
  }

  stepResultsEl.innerHTML = '';
  for (const el of elements) stepResultsEl.appendChild(el);
}

async function handleDestinationSearch(): Promise<void> {
  const rawQuery = destinationSearchInput.value.trim();
  const query = rawQuery.toLowerCase();

  if (query.length < 2) {
    destinationResultsEl.innerHTML = '';
    showStepResults();
    return;
  }

  stepBackBtn.classList.add('hidden');
  stepResultsEl.classList.add('hidden');
  destinationResultsEl.innerHTML = `<p class="loading">Searching…</p>`;

  try {
    await Promise.all(routeOptions.map((o) => getBranchesFor(o.lineId, o.direction)));

    const matches: HTMLElement[] = [];
    for (const option of routeOptions) {
      if (!currentStation) continue;
      const branches = branchesCache.get(`${option.lineId}:${option.direction}`) ?? [];
      const lineBadge = lineBadgeHtml(option.lineId, option.lineName);

      for (const branch of branches) {
        const isMatch = branch.destinations.some((destination) =>
          cleanDestinationLabel(destination).toLowerCase().includes(query)
        );
        if (!isMatch) continue;

        matches.push(
          createRouteButton(
            currentStation,
            option,
            branch.destinations,
            branch.label,
            `${lineBadge} ${option.directionLabel} · ${cleanBranchLabel(branch.label)}`,
            false
          )
        );
      }
    }

    destinationResultsEl.innerHTML = '';
    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = `No direct trains found for "${rawQuery}"`;
      destinationResultsEl.appendChild(empty);
      return;
    }
    for (const match of matches) destinationResultsEl.appendChild(match);
  } catch {
    destinationResultsEl.innerHTML = `<p class="error">Search failed, try again</p>`;
  }
}

function buildFavourite(
  station: Station,
  option: RouteOption,
  destinations: string[] | undefined,
  branchLabel: string | undefined
): Favourite {
  return {
    id: favouriteId(station.id, option.lineId, option.direction, branchLabel),
    stopPointId: station.id,
    stopName: station.name,
    lineId: option.lineId,
    lineName: option.lineName,
    direction: option.direction,
    directionLabel: option.directionLabel,
    destinations,
    label: branchLabel,
  };
}

function addFavouriteAndClose(
  station: Station,
  option: RouteOption,
  destinations: string[] | undefined,
  branchLabel: string | undefined
): void {
  addFavourite(buildFavourite(station, option, destinations, branchLabel));
  dialog.close();
  renderFavourites();
}

function createRouteButton(
  station: Station,
  option: RouteOption,
  destinations: string[] | undefined,
  branchLabel: string | undefined,
  buttonHtml: string,
  dashed: boolean
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = dashed ? 'result-btn result-btn--any' : 'result-btn';
  btn.style.setProperty('--line-color', lineColor(option.lineId));
  btn.innerHTML = buttonHtml;
  btn.addEventListener('click', () => addFavouriteAndClose(station, option, destinations, branchLabel));
  return btn;
}

addBtn.addEventListener('click', openAddDialog);
cancelBtn.addEventListener('click', () => dialog.close());
changeStationBtn.addEventListener('click', backToStationPicker);

searchInput.addEventListener('input', () => {
  window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(handleStationSearch, 300);
});

destinationSearchInput.addEventListener('input', () => {
  window.clearTimeout(destinationSearchDebounce);
  destinationSearchDebounce = window.setTimeout(handleDestinationSearch, 300);
});

renderFavourites();
