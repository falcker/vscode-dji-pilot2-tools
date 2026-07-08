import React, { useEffect, useRef } from 'react';
import { SelectMods, Waypoint } from '../types';

interface Props {
  waypoints: Waypoint[];
  selection: number[];
  onSelect: (index: number, mods: SelectMods) => void;
}

export default function WaypointTable({ waypoints, selection, onSelect }: Props) {
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const selSet = new Set(selection);
  const last = selection.length ? selection[selection.length - 1] : null;

  useEffect(() => {
    if (last == null) { return; }
    rowRefs.current.get(last)?.scrollIntoView({ block: 'nearest' });
  }, [last]);

  return (
    <div id="table-container">
      <table>
        <thead>
          <tr><th>#</th><th>Latitude</th><th>Longitude</th><th>Altitude (m)</th></tr>
        </thead>
        <tbody>
          {waypoints.map(w => (
            <tr
              key={w.index}
              ref={el => { if (el) { rowRefs.current.set(w.index, el); } }}
              className={selSet.has(w.index) ? 'highlight' : undefined}
              onClick={(e) => onSelect(w.index, { shift: e.shiftKey, meta: e.ctrlKey || e.metaKey })}
              style={{ cursor: 'pointer' }}
            >
              <td>{w.index}</td>
              <td>{w.lat.toFixed(7)}</td>
              <td>{w.lon.toFixed(7)}</td>
              <td>{w.alt.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
