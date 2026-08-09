import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Favourite, Station, Arrival } from '../../src/types';
import { flushAsync, mockFetchResponses, mountAppShell } from './test-utils';

const FAVOURITES_KEY = 'tfl.favourites';

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
  it('renders the saved card with its line/direction and next arrivals', async () => {
    const favourite: Favourite = {
      id: '940GZZLUVIC:victoria:inbound',
      stopPointId: '940GZZLUVIC',
      stopName: 'Victoria Underground Station',
      lineId: 'victoria',
      lineName: 'Victoria',
      direction: 'inbound',
      directionLabel: 'Northbound',
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
    expect(card!.querySelector('.subtitle')!.textContent).toContain('Northbound');
    expect(card!.querySelector('.arrival-destination')!.textContent).toBe('Walthamstow Central');
    expect(card!.querySelector('.arrival-time')!.textContent).toBe('2 min');
  });
});

describe('adding a station from a blank slate', () => {
  it('shows direction options after picking a station and adds it to favourites', async () => {
    const station: Station = {
      id: '940GZZLUOXC',
      name: 'Oxford Circus Underground Station',
      lines: [
        {
          lineId: 'victoria',
          lineName: 'Victoria',
          direction: 'inbound',
          towards: ['Walthamstow Central Underground Station'],
          compass: 'Northbound',
        },
        {
          lineId: 'victoria',
          lineName: 'Victoria',
          direction: 'outbound',
          towards: ['Brixton Underground Station'],
          compass: 'Southbound',
        },
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
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300); // search is debounced

    const stationResult = document.querySelector<HTMLButtonElement>('#station-results .result-btn');
    expect(stationResult).not.toBeNull();
    stationResult!.click();

    // Regression check: this station has one line with two directions, so selecting it should
    // go straight to the direction step and those options must still be there afterwards —
    // they were previously rendered then immediately wiped.
    const directionButtons = document.querySelectorAll<HTMLButtonElement>('#step-results .result-btn');
    expect(directionButtons.length).toBe(2);
    expect(directionButtons[0].textContent).toContain('Northbound');
    expect(directionButtons[1].textContent).toContain('Southbound');

    directionButtons[0].click();
    await flushAsync();

    const dialog = document.querySelector<HTMLDialogElement>('#add-dialog')!;
    expect(dialog.open).toBe(false);

    const card = document.querySelector('#favourites .card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('h2')!.textContent).toBe('Oxford Circus Underground Station');
    expect(card!.querySelector('.subtitle')!.textContent).toContain('Northbound');
  });
});
