import React, { useState } from 'react';
import { EditingApi, Waypoint } from './types';
import Header from './components/Header';
import MapView from './components/MapView';
import WaypointTable from './components/WaypointTable';

interface Props {
  waypoints: Waypoint[];
  filename: string;
  hasWpml: boolean;
  editing?: EditingApi; // スタンドアロンの編集 UI（拡張では未指定）
}

export default function App({ waypoints, filename, hasWpml, editing }: Props) {
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  return (
    <>
      <Header filename={filename} count={waypoints.length} hasWpml={hasWpml} />
      <MapView waypoints={waypoints} selectedIndex={highlightedIndex} onWaypointClick={setHighlightedIndex} editing={editing} />
      <WaypointTable waypoints={waypoints} highlightedIndex={highlightedIndex} onRowClick={setHighlightedIndex} />
    </>
  );
}
