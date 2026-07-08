export type { CameraParam, Waypoint } from '../shared/parseKmz';
import type { Waypoint } from '../shared/parseKmz';
import type { LonLat } from '../shared/transform';

export interface InitialData {
  waypoints: Waypoint[];
  filename: string;
  hasWpml: boolean;
}

// スタンドアロン編集 UI 用の API（拡張の読み取り専用ビューでは undefined）
export interface EditingApi {
  anchor: LonLat;             // 変換の基準点（waypoint 0）
  newAnchor: LonLat | null;   // 移動先（未設定なら null = 未移動）
  rotationDeg: number;
  picking: boolean;           // 地図クリックで移動先を取得中か
  moved: boolean;             // 変換が恒等でないか（Export の見た目切替用）
  onPickAnchor: () => void;
  onNewAnchor: (ll: LonLat) => void;
  onRotationChange: (deg: number) => void;
  onReset: () => void;
  onExport: () => void;
}

declare global {
  interface Window {
    __INITIAL_DATA__: InitialData;
  }
}
