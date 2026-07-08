import React, { useState } from 'react';
import { EditingApi } from '../types';

interface Props {
  editing: EditingApi;
}

const panel: React.CSSProperties = {
  position: 'absolute', top: 8, left: 8, zIndex: 10, width: 224,
  background: '#252526e6', border: '1px solid #3c3c3c', borderRadius: 6,
  padding: '10px 12px', color: '#ccc', font: "12px -apple-system, 'Segoe UI', sans-serif",
  maxHeight: 'calc(100% - 16px)', overflowY: 'auto',
};
const h = { margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#e8e8e8' } as React.CSSProperties;
const label = { display: 'block', margin: '8px 0 2px', color: '#9aa', fontSize: 11 } as React.CSSProperties;
const btn: React.CSSProperties = { padding: '5px 8px', fontSize: 11, cursor: 'pointer', background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 3 };
const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };
const hr: React.CSSProperties = { border: 0, borderTop: '1px solid #3c3c3c', margin: '10px 0' };
const numIn: React.CSSProperties = { width: 54, background: '#1e1e1e', color: '#ddd', border: '1px solid #555', borderRadius: 3, padding: '2px 4px', fontSize: 11 };

export default function TransformPanel({ editing }: Props) {
  const { selectionCount, selRotationDeg, selScale, xformActive, pickMode, warnings, boxSelect, shortcuts } = editing;
  const [step, setStep] = useState(5);
  const has = selectionCount > 0;
  const dim = (on: boolean): React.CSSProperties => (on ? {} : { opacity: 0.5, cursor: 'default' });

  return (
    <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
      {warnings.length > 0 && (
        <div style={{ marginBottom: 8, padding: '6px 8px', background: '#4a1e1e', border: '1px solid #7a3a3a', borderRadius: 4, fontSize: 10, color: '#ffb0b0' }}>
          ⚠ {warnings.length} overlapping waypoint(s): #{warnings.join(', #')}. Move a duplicated segment before exporting.
        </div>
      )}

      <h3 style={h}>Selection: {selectionCount || 'none'}</h3>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 6 }}>Click points/rows · Shift = range · Ctrl/⌘ = add · drag to move</div>
      <div style={{ ...row, marginBottom: 6 }}>
        <button style={{ ...btn, flex: 1 }} onClick={editing.onSelectAll}>Select all</button>
        <button style={{ ...btn, flex: 1, ...dim(has) }} disabled={!has} onClick={editing.onClearSelection}>Clear</button>
      </div>
      <div style={{ ...row, marginBottom: 6 }}>
        <button style={{ ...btn, flex: 1, ...dim(has) }} disabled={!has} onClick={editing.onDuplicate}>⧉ Duplicate</button>
        <button style={{ ...btn, flex: 1, ...dim(has) }} disabled={!has} onClick={editing.onDelete}>🗑 Delete</button>
      </div>
      <button
        style={{ ...btn, width: '100%', background: boxSelect ? '#0061a4' : '#333', borderColor: boxSelect ? '#0061a4' : '#555', color: boxSelect ? '#fff' : '#ddd' }}
        onClick={editing.onToggleBox}
      >
        {boxSelect ? '▣ Box select: ON (drag map)' : '▢ Box select tool'}
      </button>

      <hr style={hr} />

      <h3 style={h}>Transform selection</h3>

      <span style={label}>Rotate: {selRotationDeg.toFixed(0)}° (around center)</span>
      <div style={row}>
        <input type="range" min={-180} max={180} step={1} value={selRotationDeg} disabled={!has} style={{ flex: 1 }}
          onChange={(e) => editing.onSelRotate(Number((e.target as HTMLInputElement).value))} />
        <input type="number" min={-180} max={180} step={1} value={selRotationDeg} disabled={!has} style={numIn}
          onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) { editing.onSelRotate(v); } }} />
      </div>

      <span style={label}>Scale: {selScale.toFixed(2)}× (from center)</span>
      <div style={row}>
        <input type="range" min={0.2} max={3} step={0.05} value={selScale} disabled={!has} style={{ flex: 1 }}
          onChange={(e) => editing.onSelScale(Number((e.target as HTMLInputElement).value))} />
        <input type="number" min={0.05} step={0.05} value={selScale} disabled={!has} style={numIn}
          onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) { editing.onSelScale(v); } }} />
      </div>

      <span style={label}>Move</span>
      <button style={{ ...btn, width: '100%', ...dim(has), background: pickMode === 'move' ? '#0061a4' : '#333', borderColor: pickMode === 'move' ? '#0061a4' : '#555', color: pickMode === 'move' ? '#fff' : '#ddd' }}
        disabled={!has} onClick={editing.onStartMove}>
        {pickMode === 'move' ? '📍 Click the map…' : '✥ Move center to…'}
      </button>
      <div style={{ ...row, marginTop: 6, justifyContent: 'center' }}>
        <button style={{ ...btn, ...dim(has) }} disabled={!has} onClick={() => editing.onNudge(0, step)}>↑N</button>
        <button style={{ ...btn, ...dim(has) }} disabled={!has} onClick={() => editing.onNudge(0, -step)}>↓S</button>
        <button style={{ ...btn, ...dim(has) }} disabled={!has} onClick={() => editing.onNudge(-step, 0)}>←W</button>
        <button style={{ ...btn, ...dim(has) }} disabled={!has} onClick={() => editing.onNudge(step, 0)}>→E</button>
        <input type="number" min={1} value={step} title="nudge step (m)" style={numIn}
          onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) { setStep(v); } }} />
      </div>

      <div style={{ ...row, marginTop: 10 }}>
        <button style={{ ...btn, flex: 1, ...dim(xformActive) }} disabled={!xformActive} onClick={editing.onResetXform}>Reset</button>
        <button style={{ ...btn, flex: 1, ...dim(xformActive), background: xformActive ? '#0061a4' : '#333', borderColor: xformActive ? '#0061a4' : '#555', color: xformActive ? '#fff' : '#999' }}
          disabled={!xformActive} onClick={editing.onApply}>✓ Apply</button>
      </div>

      <hr style={hr} />
      <button style={{ ...btn, width: '100%', background: '#0e7a0d', borderColor: '#0e7a0d', color: '#fff' }} onClick={editing.onExport}>⬇ Export KMZ</button>

      {shortcuts.length > 0 && (
        <details style={{ marginTop: 8, fontSize: 10, color: '#9aa' }}>
          <summary style={{ cursor: 'pointer', color: '#bbb' }}>⌨ Shortcuts ({shortcuts.length})</summary>
          <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 8px' }}>
            {shortcuts.map((s) => (
              <React.Fragment key={s.action}>
                <span>{s.action}</span>
                <span style={{ fontFamily: 'monospace', color: '#ddd' }}>{s.keys.join(' / ')}</span>
              </React.Fragment>
            ))}
          </div>
          <div style={{ marginTop: 4, color: '#777' }}>Edit <code>keybindings.json</code> — reloads automatically.</div>
        </details>
      )}
    </div>
  );
}
