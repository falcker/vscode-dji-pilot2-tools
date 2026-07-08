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
  pickMode: 'move' | null;         // 地図クリック待ち（選択の移動先指定）
  onMapPick: (ll: LonLat) => void; // 地図クリック時、pickMode に応じて処理
  onExport: () => void;

  // --- 選択 waypoint の構造編集（即時） ---
  selectionCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDuplicate: () => void;
  onDelete: () => void;

  // --- 選択の保留中トランスフォーム（重心まわり回転・拡大＋移動）。
  //     ライブプレビューし、Apply でコミット / Reset で破棄 ---
  selRotationDeg: number;
  selScale: number;
  xformActive: boolean;            // 保留中トランスフォームが恒等でない
  onSelRotate: (deg: number) => void;
  onSelScale: (factor: number) => void;
  onNudge: (dEast: number, dNorth: number) => void; // 保留移動をメートルで加算
  onStartMove: () => void;         // 移動先を地図クリックで指定する pick モード
  onApply: () => void;
  onResetXform: () => void;

  // --- フリーハンドドラッグ ---
  onDragStart: (index: number, ll: LonLat) => void;
  onDragMove: (ll: LonLat) => void;
  onDragEnd: () => void;

  // --- ボックス（マーキー）選択ツール ---
  boxSelect: boolean;
  onToggleBox: () => void;
  onSelectMany: (indices: number[], additive: boolean) => void;

  // --- 安全装置: 近接（重なり）waypoint の index ---
  warnings: number[];

  // --- ショートカット表示用（action -> キー一覧） ---
  shortcuts: { action: string; keys: string[] }[];
}

declare global {
  interface Window {
    __INITIAL_DATA__: InitialData;
  }
}
