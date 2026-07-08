export type { CameraParam, Waypoint } from '../shared/parseKmz';
import type { Waypoint } from '../shared/parseKmz';

export interface InitialData {
  waypoints: Waypoint[];
  filename: string;
  hasWpml: boolean;
}

declare global {
  interface Window {
    __INITIAL_DATA__: InitialData;
  }
}
