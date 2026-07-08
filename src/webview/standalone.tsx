import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import App from './App';
import { parseKmlWaypoints, Waypoint } from '../shared/parseKmz';
import { RawKmz, kmzEntries } from '../shared/kmzDoc';
import { LonLat, TransformParams, transformRawKmz, transformWaypoints } from '../shared/transform';
import { deleteWaypoints, duplicateWaypoints, metersToDegrees, translateWaypoints } from '../shared/edits';
import { EditingApi, SelectMods } from './types';

interface Loaded {
  waypoints: Waypoint[]; // 元の（未変換の）waypoint
  filename: string;
  hasWpml: boolean;
  raw: RawKmz;
}

// ブラウザ上で KMZ を解凍・解析する（VSCode 拡張ホストの処理と等価）。
// 書き出しに備えて元アーカイブ (RawKmz) をそのまま保持する。
async function loadKmz(file: File): Promise<Loaded> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  let templatePath = '', templateKml = '';
  let waylinesPath: string | null = null, waylinesWpml: string | null = null;
  const others: { path: string; bytes: Uint8Array }[] = [];

  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) { continue; }
    if (name.endsWith('template.kml')) { templatePath = name; templateKml = await entry.async('string'); }
    else if (name.endsWith('waylines.wpml')) { waylinesPath = name; waylinesWpml = await entry.async('string'); }
    else { others.push({ path: name, bytes: await entry.async('uint8array') }); }
  }
  if (!templateKml) {
    throw new Error('template.kml not found. Is this a DJI Pilot 2 / FlightHub 2 mission KMZ?');
  }
  const waypoints = parseKmlWaypoints(templateKml);
  if (waypoints.length === 0) {
    throw new Error('No waypoints found in template.kml.');
  }
  return {
    waypoints,
    filename: file.name,
    hasWpml: waylinesWpml !== null,
    raw: { templatePath, templateKml, waylinesPath, waylinesWpml, others },
  };
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Standalone() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  // 変換（スタンプ）の状態
  const [rotationDeg, setRotationDeg] = useState(0);
  const [newAnchor, setNewAnchor] = useState<LonLat | null>(null);
  const [pickMode, setPickMode] = useState<'anchor' | 'move' | null>(null);

  // 選択状態
  const [selection, setSelection] = useState<number[]>([]);
  const selAnchorRef = useRef<number | null>(null);

  const resetTransform = useCallback(() => {
    setRotationDeg(0);
    setNewAnchor(null);
    setPickMode(null);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const loaded = await loadKmz(file);
      resetTransform();
      setSelection([]);
      selAnchorRef.current = null;
      setData(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [resetTransform]);

  // クリック修飾キーに応じて選択を更新する（単一 / 追加トグル / 範囲）
  const handleSelect = useCallback((index: number, mods: SelectMods) => {
    setSelection((prev) => {
      if (mods.shift && selAnchorRef.current !== null) {
        const a = selAnchorRef.current;
        const lo = Math.min(a, index), hi = Math.max(a, index);
        const range: number[] = [];
        for (let i = lo; i <= hi; i++) { range.push(i); }
        return range;
      }
      selAnchorRef.current = index;
      if (mods.meta) {
        return prev.includes(index) ? prev.filter((x) => x !== index) : [...prev, index];
      }
      return prev.length === 1 && prev[0] === index ? [] : [index];
    });
  }, []);

  const anchor: LonLat | null = data ? [data.waypoints[0].lon, data.waypoints[0].lat] : null;

  const params: TransformParams | null = anchor
    ? { anchor, newAnchor: newAnchor ?? anchor, rotationDeg, scale: 1 }
    : null;

  // プレビュー用に変換後の waypoint を計算（地図・カメラ視線に反映）
  const previewWaypoints = useMemo(
    () => (data && params ? transformWaypoints(data.waypoints, params) : data?.waypoints ?? []),
    [data, params?.newAnchor[0], params?.newAnchor[1], params?.rotationDeg],
  );

  const exportKmz = useCallback(async () => {
    if (!data || !params) { return; }
    const outRaw = transformRawKmz(data.raw, params);
    const zip = new JSZip();
    for (const e of kmzEntries(outRaw)) { zip.file(e.path, e.data); }
    const blob = await zip.generateAsync({ type: 'blob' });
    const base = data.filename.replace(/\.kmz$/i, '');
    triggerDownload(blob, `${base} - stamped.kmz`);
  }, [data, params?.newAnchor[0], params?.newAnchor[1], params?.rotationDeg]);

  // 構造編集を適用: 新しい RawKmz から waypoint を再解析し、スタンプ変換はリセットする
  const applyEdit = useCallback((cur: Loaded, newRaw: RawKmz, newSelection: number[]) => {
    const waypoints = parseKmlWaypoints(newRaw.templateKml);
    resetTransform();
    setData({ ...cur, raw: newRaw, waypoints, hasWpml: newRaw.waylinesWpml !== null });
    setSelection(newSelection);
  }, [resetTransform]);

  if (data && anchor) {
    const onDuplicate = () => {
      if (!selection.length) { return; }
      const { raw: nr, newIndices } = duplicateWaypoints(data.raw, new Set(selection));
      applyEdit(data, nr, newIndices);
    };
    const onDelete = () => {
      if (!selection.length) { return; }
      applyEdit(data, deleteWaypoints(data.raw, new Set(selection)), []);
    };
    const onNudge = (dEast: number, dNorth: number) => {
      if (!selection.length) { return; }
      const { dLon, dLat } = metersToDegrees(dEast, dNorth, data.waypoints[selection[0]].lat);
      applyEdit(data, translateWaypoints(data.raw, new Set(selection), dLon, dLat), selection);
    };
    const moveSelectionTo = (ll: LonLat) => {
      if (!selection.length) { return; }
      let sx = 0, sy = 0;
      for (const i of selection) { sx += data.waypoints[i].lon; sy += data.waypoints[i].lat; }
      const cx = sx / selection.length, cy = sy / selection.length;
      applyEdit(data, translateWaypoints(data.raw, new Set(selection), ll[0] - cx, ll[1] - cy), selection);
    };

    const editing: EditingApi = {
      anchor,
      newAnchor,
      rotationDeg,
      moved: newAnchor !== null || rotationDeg % 360 !== 0,
      pickMode,
      onPickAnchor: () => setPickMode('anchor'),
      onRotationChange: setRotationDeg,
      onReset: resetTransform,
      onExport: () => { void exportKmz(); },
      onMapPick: (ll) => {
        if (pickMode === 'anchor') { setNewAnchor(ll); setPickMode(null); }
        else if (pickMode === 'move') { moveSelectionTo(ll); setPickMode(null); }
      },
      selectionCount: selection.length,
      onDuplicate,
      onDelete,
      onStartMove: () => { if (selection.length) { setPickMode('move'); } },
      onNudge,
    };
    return (
      <>
        <App
          waypoints={previewWaypoints}
          filename={data.filename}
          hasWpml={data.hasWpml}
          editing={editing}
          selection={selection}
          onSelect={handleSelect}
        />
        <button className="reset-btn" onClick={() => setData(null)}>← Open another KMZ</button>
      </>
    );
  }

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) { void handleFile(f); }
      }}
    >
      <input
        id="file-input"
        type="file"
        accept=".kmz"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.currentTarget.files && e.currentTarget.files[0];
          if (f) { void handleFile(f); }
        }}
      />
      <label htmlFor="file-input" className="drop-card">
        <div className="drop-icon">🛰️</div>
        <div className="drop-title">{busy ? 'Loading…' : (<>Drop a DJI <b>.kmz</b> here</>)}</div>
        <div className="drop-sub">or click to browse — DJI Pilot 2 &amp; FlightHub 2 supported</div>
        {error && <div className="drop-error">{error}</div>}
      </label>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Standalone />);
