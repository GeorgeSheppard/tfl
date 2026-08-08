import {
  GetTflArrivalsDirection,
  GetTflBranchesDirection,
  getTflArrivals,
  getTflBranches,
  getTflStations,
} from './api/generated';
import { Arrival, Branch, Station } from './types';

export async function searchStations(query: string): Promise<Station[]> {
  const { stations } = await getTflStations({ query });
  return stations;
}

export async function getArrivals(
  stopPointId: string,
  options: {
    lineId?: string;
    direction?: GetTflArrivalsDirection;
    destinationName?: string[];
    limit?: number;
  } = {}
): Promise<Arrival[]> {
  const { arrivals } = await getTflArrivals({ stopPointId, ...options });
  return arrivals;
}

export async function getBranches(
  stopPointId: string,
  lineId: string,
  direction: GetTflBranchesDirection
): Promise<Branch[]> {
  const { branches } = await getTflBranches({ stopPointId, lineId, direction });
  return branches;
}
