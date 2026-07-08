import React, { useState } from 'react';
import { EditingApi } from '../types';

interface Props {
  editing: EditingApi;
}

const panel: React.CSSProperties = {
  position: 'absolute', top: 8, left: 8, zIndex: 10, width: 214,
  background: '#252526e6', border: '1px solid #3c3c3c', borderRadius: 6,
  padding: '10px 12px', color: '#ccc', font: "12px -apple-system, 'Segoe UI', sans-serif",
};
const h = { margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#e8e8e8' } as React.CSSProperties;
const label = { display: 'block', margin: '8px 0 2px', color: '#9aa', fontSize: 11 } as React.CSSProperties;
const btn: React.CSSProperties = {
  padding: '5px 8px', fontSize: 11, cursor: 'pointer',
  background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 3,
};
const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };
const hr: React.CSSProperties = { border: 0, borderTop: '1px solid #3c3c3c', margin: '10px 0' };

function fmt(ll: [number, number] | null): string {
  return ll ? `${ll[1].toFixed(6)}, ${ll[0].toFixed(6)}` : '—';
}

export default function TransformPanel({ editing }: Props) {
  const { rotationDeg, newAnchor, pickMode, moved, selectionCount } = editing;
  const [step, setStep] = useState(5);
  const disabled = { opacity: 0.5, cursor: 'default' } as React.CSSProperties;
  const has = selectionCount > 0;

  return (
    <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
      {/* --- Selection editing --- */}
      <h3 style={h}>Selection: {selectionCount || 'none'}</h3>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 6 }}>
        Click waypoints/rows · Shift = range · Ctrl/⌘ = add
      </div>
      <div style={{ ...row, marginBottom: 6 }}>
        <button style={{ ...btn, flex: 1, ...(has ? {} : disabled) }} onClick={editing.onDuplicate} disabled={!has}>⧉ Duplicate</button>
        <button style={{ ...btn, flex: 1, ...(has ? {} : disabled) }} onClick={editing.onDelete} disabled={!has}>🗑 Delete</button>
      </div>
      <button
        style={{ ...btn, width: '100%', ...(has ? {} : disabled), background: pickMode === 'move' ? '#0061a4' : '#333', borderColor: pickMode === 'move' ? '#0061a4' : '#555', color: pickMode === 'move' ? '#fff' : '#ddd' }}
        onClick={editing.onStartMove} disabled={!has}
      >
        {pickMode === 'move' ? '📍 Click the map…' : '✥ Move selection to…'}
      </button>
      <div style={{ ...row, marginTop: 6, justifyContent: 'center' }}>
        <button style={{ ...btn, ...(has ? {} : disabled) }} disabled={!has} onClick={() => editing.onNudge(0, step)}>↑N</button>
        <button style={{ ...btn, ...(has ? {} : disabled) }} disabled={!has} onClick={() => editing.onNudge(0, -step)}>↓S</button>
        <button style={{ ...btn, ...(has ? {} : disabled) }} disabled={!has} onClick={() => editing.onNudge(-step, 0)}>←W</button>
        <button style={{ ...btn, ...(has ? {} : disabled) }} disabled={!has} onClick={() => editing.onNudge(step, 0)}>→E</button>
        <input type="number" min={1} value={step} title="nudge step (m)"
          style={{ width: 42, background: '#1e1e1e', color: '#ddd', border: '1px solid #555', borderRadius: 3, padding: '2px 4px', fontSize: 11 }}
          onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) { setStep(v); } }} />
      </div>

      <hr style={hr} />

      {/* --- Stamp / move whole path --- */}
      <h3 style={h}>Stamp whole path</h3>
      <span style={label}>New location (lat, lon)</span>
      <div style={{ fontFamily: 'monospace', fontSize: 11, color: newAnchor ? '#e8e8e8' : '#777', marginBottom: 4 }}>{fmt(newAnchor)}</div>
      <button
        style={{ ...btn, width: '100%', background: pickMode === 'anchor' ? '#0061a4' : '#333', borderColor: pickMode === 'anchor' ? '#0061a4' : '#555', color: pickMode === 'anchor' ? '#fff' : '#ddd' }}
        onClick={editing.onPickAnchor}
      >
        {pickMode === 'anchor' ? '📍 Click the map…' : '📍 Set new location'}
      </button>

      <span style={label}>Rotation: {rotationDeg.toFixed(0)}°</span>
      <div style={row}>
        <input type="range" min={-180} max={180} step={1} value={rotationDeg} style={{ flex: 1 }}
          onChange={(e) => editing.onRotationChange(Number((e.target as HTMLInputElement).value))} />
        <input type="number" min={-180} max={180} step={1} value={rotationDeg}
          style={{ width: 54, background: '#1e1e1e', color: '#ddd', border: '1px solid #555', borderRadius: 3, padding: '2px 4px', fontSize: 11 }}
          onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) { editing.onRotationChange(v); } }} />
      </div>

      <div style={{ ...row, marginTop: 10 }}>
        <button style={{ ...btn, flex: 1, ...(moved ? {} : disabled) }} onClick={editing.onReset} disabled={!moved}>Reset</button>
        <button style={{ ...btn, flex: 2, background: '#0e7a0d', borderColor: '#0e7a0d', color: '#fff' }} onClick={editing.onExport}>⬇ Export KMZ</button>
      </div>
    </div>
  );
}
