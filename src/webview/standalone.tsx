import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import App from './App';
import { parseKmlWaypoints, Waypoint } from '../shared/parseKmz';

interface Loaded {
  waypoints: Waypoint[];
  filename: string;
  hasWpml: boolean;
}

// ブラウザ上で KMZ を解凍・解析する（VSCode 拡張ホストの処理と等価）
async function loadKmz(file: File): Promise<Loaded> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  let kml: string | null = null;
  let hasWpml = false;
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith('template.kml')) { kml = await zip.files[name].async('string'); }
    else if (name.endsWith('waylines.wpml')) { hasWpml = true; }
  }
  if (!kml) {
    throw new Error('template.kml not found. Is this a DJI Pilot 2 / FlightHub 2 mission KMZ?');
  }
  const waypoints = parseKmlWaypoints(kml);
  if (waypoints.length === 0) {
    throw new Error('No waypoints found in template.kml.');
  }
  return { waypoints, filename: file.name, hasWpml };
}

function Standalone() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      setData(await loadKmz(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  if (data) {
    return (
      <>
        <App waypoints={data.waypoints} filename={data.filename} hasWpml={data.hasWpml} />
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
