export type { CameraParam, Waypoint } from '../shared/parseKmz';
import type { Waypoint } from '../shared/parseKmz';
import type { LonLat } from '../shared/transform';

export interface InitialData {
  waypoints: Waypoint[];
  filename: string;
  hasWpml: boolean;
}

// クリック時の修飾キー（範囲選択・追加選択の判定に使う）
export interface SelectMods {
  shift: boolean;
  meta: boolean; // Ctrl または Cmd
}

// スタンドアロン編集 UI 用の API（拡張の読み取り専用ビューでは undefined）
export interface EditingApi {
  // --- スタンプ（パス全体の移動・回転） ---
  anchor: LonLat;             // 変換の基準点（waypoint 0）
  newAnchor: LonLat | null;   // 移動先（未設定なら null = 未移動）
  rotationDeg: number;
  moved: boolean;             // 変換が恒等でないか（Export の見た目切替用）
  pickMode: 'anchor' | 'move' | null; // 地図クリック待ち（アンカー指定 / 選択移動）
  onPickAnchor: () => void;
  onRotationChange: (deg: number) => void;
  onReset: () => void;
  onExport: () => void;
  onMapPick: (ll: LonLat) => void; // 地図がクリックされたときに pickMode に応じて処理

  // --- 選択 waypoint の構造編集 ---
  selectionCount: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onStartMove: () => void;         // 選択を地図クリック先へ移動する pick モードに入る
  onNudge: (dEast: number, dNorth: number) => void; // 選択を数値でずらす（メートル）
}

declare global {
  interface Window {
    __INITIAL_DATA__: InitialData;
  }
}
