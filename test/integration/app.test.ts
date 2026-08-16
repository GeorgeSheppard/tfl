import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Favourite, Station, Arrival } from '../../src/types';
import { flushAsync, mockFetchResponses, mountAppShell } from './test-utils';

const FAVOURITES_KEY = 'tfl.favourites';
const STATIONS_KEY = 'tfl.stations';

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  mountAppShell();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('a station already selected', () => {
  it('renders the saved card with its line and next arrivals', async () => {
    const favourite: Favourite = {
      id: '940GZZLUVIC:victoria',
      stopPointId: '940GZZLUVIC',
      stopName: 'Victoria Underground Station',
      lineId: 'victoria',
      lineName: 'Victoria',
    };
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([favourite]));

    const arrivals: Arrival[] = [
      {
        lineId: 'victoria',
        lineName: 'Victoria',
        platformName: 'Northbound - Platform 1',
        direction: 'inbound',
        destinationName: 'Walthamstow Central Underground Station',
        timeToStationSeconds: 90,
        expectedArrival: new Date().toISOString(),
        currentLocation: 'At Pimlico',
      },
    ];
    mockFetchResponses({ '/tfl/arrivals': { arrivals } });

    await import('../../src/main');
    await flushAsync();

    const card = document.querySelector('#favourites .card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('h2')!.textContent).toBe('Victoria Underground Station');
    expect(card!.querySelector('.subtitle')!.textContent).toContain('Victoria');
    expect(card!.querySelector('.arrival-destination')!.textContent).toBe('Walthamstow Central');
    expect(card!.querySelector('.arrival-time')!.textContent).toBe('2 min');
  });
});

describe('arrivals grouped by direction', () => {
  it('groups destinations under the platform direction printed at the station, not just by destination', async () => {
    // Earl's Court, Piccadilly line: two branches share the westbound platform (Heathrow via
    // both terminal loops, plus Rayners Lane/Uxbridge), and eastbound trains all continue to
    // Cockfosters. A rider knows "Westbound"/"Eastbound" — not every branch destination.
    const favourite: Favourite = {
      id: '940GZZLUECT:piccadilly',
      stopPointId: '940GZZLUECT',
      stopName: "Earl's Court Underground Station",
      lineId: 'piccadilly',
      lineName: 'Piccadilly',
    };
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([favourite]));

    const arrivals: Arrival[] = [
      {
        lineId: 'piccadilly',
        lineName: 'Piccadilly',
        platformName: 'Westbound - Platform 6',
        direction: 'inbound',
        destinationName: 'Heathrow Terminal 5 Underground Station',
        timeToStationSeconds: 60,
        expectedArrival: new Date().toISOString(),
        currentLocation: 'Approaching Earl’s Court',
      },
      {
        lineId: 'piccadilly',
        lineName: 'Piccadilly',
        platformName: 'Westbound - Platform 6',
        direction: 'inbound',
        destinationName: 'Rayners Lane Underground Station',
        timeToStationSeconds: 180,
        expectedArrival: new Date().toISOString(),
        currentLocation: 'Between South Kensington and Gloucester Road',
      },
      {
        lineId: 'piccadilly',
        lineName: 'Piccadilly',
        platformName: 'Eastbound - Platform 5',
        direction: 'outbound',
        destinationName: 'Cockfosters Underground Station',
        timeToStationSeconds: 180,
        expectedArrival: new Date().toISOString(),
        currentLocation: 'Left Barons Court',
      },
    ];
    mockFetchResponses({ '/tfl/arrivals': { arrivals } });

    await import('../../src/main');
    await flushAsync();

    const card = document.querySelector('#favourites .card')!;
    const directionHeaders = card.querySelectorAll('.direction-header');
    expect([...directionHeaders].map((el) => el.textContent)).toEqual(['Westbound', 'Eastbound']);

    const [westbound, eastbound] = card.querySelectorAll('.direction-group');
    expect(
      [...westbound.querySelectorAll('.arrival-destination')].map((el) => el.textContent)
    ).toEqual(['Heathrow Terminal 5', 'Rayners Lane']);
    expect(
      [...eastbound.querySelectorAll('.arrival-destination')].map((el) => el.textContent)
    ).toEqual(['Cockfosters']);
  });
});

describe('adding a station from a blank slate', () => {
  it('subscribes directly when the station has only one line', async () => {
    const station: Station = {
      id: '940GZZLUVIC',
      name: 'Victoria Underground Station',
      lines: [{ lineId: 'victoria', lineName: 'Victoria' }],
    };
    mockFetchResponses({
      '/tfl/stations': { stations: [station] },
      '/tfl/arrivals': { arrivals: [] },
    });

    await import('../../src/main');
    await flushAsync();

    document.querySelector<HTMLButtonElement>('#add-btn')!.click();

    const searchInput = document.querySelector<HTMLInputElement>('#station-search')!;
    searchInput.value = 'Victoria';
    searchInput.dispatchEvent(new Event('input', { bubbles: true })); // filtered client-side, no debounce

    const stationResult = document.querySelector<HTMLButtonElement>('#station-results .result-btn');
    expect(stationResult).not.toBeNull();
    stationResult!.click();
    await flushAsync();

    // Only one line — no line-picking step, added straight away.
    const dialog = document.querySelector<HTMLDialogElement>('#add-dialog')!;
    expect(dialog.open).toBe(false);

    const card = document.querySelector('#favourites .card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('h2')!.textContent).toBe('Victoria Underground Station');
    expect(card!.querySelector('.subtitle')!.textContent).toContain('Victoria');
  });

  it('shows line options when the station is served by more than one line', async () => {
    const station: Station = {
      id: '940GZZLUOXC',
      name: 'Oxford Circus Underground Station',
      lines: [
        { lineId: 'victoria', lineName: 'Victoria' },
        { lineId: 'bakerloo', lineName: 'Bakerloo' },
      ],
    };
    mockFetchResponses({
      '/tfl/stations': { stations: [station] },
      '/tfl/arrivals': { arrivals: [] },
    });

    await import('../../src/main');
    await flushAsync();

    document.querySelector<HTMLButtonElement>('#add-btn')!.click();

    const searchInput = document.querySelector<HTMLInputElement>('#station-search')!;
    searchInput.value = 'Oxford';
    searchInput.dispatchEvent(new Event('input', { bubbles: true })); // filtered client-side, no debounce

    const stationResult = document.querySelector<HTMLButtonElement>('#station-results .result-btn');
    expect(stationResult).not.toBeNull();
    stationResult!.click();

    const lineButtons = document.querySelectorAll<HTMLButtonElement>('#step-results .result-btn');
    expect(lineButtons.length).toBe(2);
    expect(lineButtons[0].textContent).toContain('Victoria');
    expect(lineButtons[1].textContent).toContain('Bakerloo');

    lineButtons[0].click();
    await flushAsync();

    const dialog = document.querySelector<HTMLDialogElement>('#add-dialog')!;
    expect(dialog.open).toBe(false);

    const card = document.querySelector('#favourites .card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('h2')!.textContent).toBe('Oxford Circus Underground Station');
    expect(card!.querySelector('.subtitle')!.textContent).toContain('Victoria');
  });
});

describe('station search when the network is unavailable', () => {
  it('falls back to the cached station list instead of failing', async () => {
    const cachedStation: Station = {
      id: '940GZZLUVIC',
      name: 'Victoria Underground Station',
      lines: [{ lineId: 'victoria', lineName: 'Victoria' }],
    };
    localStorage.setItem(STATIONS_KEY, JSON.stringify([cachedStation]));

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/tfl/stations')) throw new Error('network unavailable');
        if (url.includes('/tfl/arrivals')) {
          return { ok: true, json: async () => ({ arrivals: [] }) } as Response;
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      })
    );

    await import('../../src/main');
    await flushAsync();

    document.querySelector<HTMLButtonElement>('#add-btn')!.click();

    const searchInput = document.querySelector<HTMLInputElement>('#station-search')!;
    searchInput.value = 'Victoria';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    const stationResult = document.querySelector<HTMLButtonElement>('#station-results .result-btn');
    expect(stationResult).not.toBeNull();
    expect(stationResult!.textContent).toBe('Victoria Underground Station');
  });

  it('shows a distinct message when nothing has ever been cached', async () => {
    mockFetchResponses({ '/tfl/stations': { stations: [] } });

    await import('../../src/main');
    await flushAsync();

    document.querySelector<HTMLButtonElement>('#add-btn')!.click();

    const searchInput = document.querySelector<HTMLInputElement>('#station-search')!;
    searchInput.value = 'Victoria';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('#station-results .empty')!.textContent).toContain(
      'not loaded yet'
    );
  });
});
