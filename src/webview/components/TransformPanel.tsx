import React from 'react';
import { EditingApi } from '../types';

interface Props {
  editing: EditingApi;
}

const panel: React.CSSProperties = {
  position: 'absolute', top: 8, left: 8, zIndex: 10, width: 210,
  background: '#252526e6', border: '1px solid #3c3c3c', borderRadius: 6,
  padding: '10px 12px', color: '#ccc', font: "12px -apple-system, 'Segoe UI', sans-serif",
};
const h = { margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: '#e8e8e8' } as React.CSSProperties;
const label = { display: 'block', margin: '8px 0 2px', color: '#9aa', fontSize: 11 } as React.CSSProperties;
const btn: React.CSSProperties = {
  width: '100%', padding: '5px 8px', fontSize: 11, cursor: 'pointer',
  background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 3,
};
const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };

function fmt(ll: [number, number] | null): string {
  return ll ? `${ll[1].toFixed(6)}, ${ll[0].toFixed(6)}` : '—';
}

export default function TransformPanel({ editing }: Props) {
  const { rotationDeg, newAnchor, picking, moved } = editing;
  return (
    <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
      <h3 style={h}>Stamp / Move path</h3>

      <span style={label}>New location (lat, lon)</span>
      <div style={{ ...row, marginBottom: 4 }}>
        <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 11, color: newAnchor ? '#e8e8e8' : '#777' }}>
          {fmt(newAnchor)}
        </span>
      </div>
      <button
        style={{ ...btn, background: picking ? '#0061a4' : '#333', borderColor: picking ? '#0061a4' : '#555', color: picking ? '#fff' : '#ddd' }}
        onClick={editing.onPickAnchor}
      >
        {picking ? '📍 Click the map…' : '📍 Set new location'}
      </button>

      <span style={label}>Rotation: {rotationDeg.toFixed(0)}°</span>
      <div style={row}>
        <input
          type="range" min={-180} max={180} step={1} value={rotationDeg}
          style={{ flex: 1 }}
          onChange={(e) => editing.onRotationChange(Number((e.target as HTMLInputElement).value))}
        />
        <input
          type="number" min={-180} max={180} step={1} value={rotationDeg}
          style={{ width: 54, background: '#1e1e1e', color: '#ddd', border: '1px solid #555', borderRadius: 3, padding: '2px 4px', fontSize: 11 }}
          onChange={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v)) { editing.onRotationChange(v); }
          }}
        />
      </div>

      <span style={label}>Scale</span>
      <input type="text" value="1.00 (coming soon)" disabled
        style={{ width: '100%', background: '#1e1e1e', color: '#666', border: '1px solid #444', borderRadius: 3, padding: '2px 4px', fontSize: 11 }} />

      <div style={{ ...row, marginTop: 10 }}>
        <button style={{ ...btn, flex: 1, opacity: moved ? 1 : 0.6 }} onClick={editing.onReset} disabled={!moved}>
          Reset
        </button>
        <button style={{ ...btn, flex: 2, background: '#0e7a0d', borderColor: '#0e7a0d', color: '#fff' }} onClick={editing.onExport}>
          ⬇ Export KMZ
        </button>
      </div>
    </div>
  );
}
