import React, { useRef, useState } from 'react';
import { EditingApi, SelectMods, Waypoint } from './types';
import Header from './components/Header';
import MapView from './components/MapView';
import WaypointTable from './components/WaypointTable';

interface Props {
  waypoints: Waypoint[];
  filename: string;
  hasWpml: boolean;
  editing?: EditingApi;                                  // スタンドアロンの編集 UI（拡張では未指定）
  selection?: number[];                                  // 制御された選択（スタンドアロン）
  onSelect?: (index: number, mods: SelectMods) => void;  // 同上
}

export default function App({ waypoints, filename, hasWpml, editing, selection, onSelect }: Props) {
  // 拡張（読み取り専用）では選択を内部で管理する。スタンドアロンでは props で制御する。
  const [internalSel, setInternalSel] = useState<number[]>([]);
  const anchorRef = useRef<number | null>(null);

  const selected = selection ?? internalSel;

  const handleSelect = (index: number, mods: SelectMods) => {
    if (onSelect) { onSelect(index, mods); return; }
    setInternalSel((prev) => {
      if (mods.shift && anchorRef.current !== null) {
        const a = anchorRef.current, lo = Math.min(a, index), hi = Math.max(a, index);
        const range: number[] = [];
        for (let i = lo; i <= hi; i++) { range.push(i); }
        return range;
      }
      anchorRef.current = index;
      if (mods.meta) { return prev.includes(index) ? prev.filter((x) => x !== index) : [...prev, index]; }
      return prev.length === 1 && prev[0] === index ? [] : [index];
    });
  };

  return (
    <>
      <Header filename={filename} count={waypoints.length} hasWpml={hasWpml} />
      <MapView waypoints={waypoints} selection={selected} onSelect={handleSelect} editing={editing} />
      <WaypointTable waypoints={waypoints} selection={selected} onSelect={handleSelect} />
    </>
  );
}
