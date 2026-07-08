import React, { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import App from './App';
import { parseKmlWaypoints, Waypoint } from '../shared/parseKmz';
import { RawKmz, kmzEntries } from '../shared/kmzDoc';
import { LonLat, TransformParams, transformRawKmz, transformWaypoints } from '../shared/transform';
import { EditingApi } from './types';

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
  const [picking, setPicking] = useState(false);

  const resetTransform = useCallback(() => {
    setRotationDeg(0);
    setNewAnchor(null);
    setPicking(false);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const loaded = await loadKmz(file);
      resetTransform();
      setData(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [resetTransform]);

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

  if (data && anchor) {
    const editing: EditingApi = {
      anchor,
      newAnchor,
      rotationDeg,
      picking,
      moved: newAnchor !== null || rotationDeg % 360 !== 0,
      onPickAnchor: () => setPicking(true),
      onNewAnchor: (ll) => { setNewAnchor(ll); setPicking(false); },
      onRotationChange: setRotationDeg,
      onReset: resetTransform,
      onExport: () => { void exportKmz(); },
    };
    return (
      <>
        <App waypoints={previewWaypoints} filename={data.filename} hasWpml={data.hasWpml} editing={editing} />
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
