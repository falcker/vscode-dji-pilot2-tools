import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import * as DeckGL from 'deck.gl';
import { EditingApi, Waypoint } from '../types';
import TransformPanel from './TransformPanel';

type BasemapKey = 'seamless' | 'std' | 'osm';

const BASEMAPS: Record<BasemapKey, { tiles: string[]; attribution: string }> = {
  seamless: { tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'], attribution: '© 国土地理院' },
  std:      { tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],          attribution: '© 国土地理院' },
  osm:      { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],                    attribution: '© OpenStreetMap contributors' },
};

function makeStyle(key: BasemapKey) {
  const bm = BASEMAPS[key];
  return {
    version: 8,
    sources: { basemap: { type: 'raster', tiles: bm.tiles, tileSize: 256, attribution: bm.attribution } },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}

function getWpColor(i: number, total: number): [number, number, number] {
  if (i === 0) { return [0, 204, 68]; }
  if (i === total - 1) { return [255, 68, 68]; }
  return [0, 170, 255];
}

const METERS_PER_DEG_LAT = 111320;

// 北基準・時計回りの方位角（度, 0-360）を 2 点間で求める
function bearingDeg(fromLon: number, fromLat: number, toLon: number, toLat: number): number {
  const cosLat = Math.cos(((fromLat + toLat) / 2) * Math.PI / 180);
  const dEast = (toLon - fromLon) * cosLat;
  const dNorth = toLat - fromLat;
  const az = Math.atan2(dEast, dNorth) * 180 / Math.PI;
  return (az + 360) % 360;
}

interface CameraTarget {
  source: [number, number, number];
  target: [number, number, number];
}

// 選択された waypoint のカメラ視線を地面（z=0）まで伸ばした始点・着地点を求める
function computeCameraTarget(waypoints: Waypoint[], i: number, sourceZ: number): CameraTarget | null {
  const w = waypoints[i];
  const cam = w.camera;
  if (!cam) { return null; }

  const depression = -cam.pitch;         // 水平からの見下ろし角（度）
  if (depression <= 1) { return null; }  // ほぼ水平だと地面に当たらない

  // 機体方位（followWayline 前提: 進行方向）。yaw が北基準なら不要だが aircraft 基準用に算出
  let heading: number;
  if (i < waypoints.length - 1) { heading = bearingDeg(w.lon, w.lat, waypoints[i + 1].lon, waypoints[i + 1].lat); }
  else if (i > 0) { heading = bearingDeg(waypoints[i - 1].lon, waypoints[i - 1].lat, w.lon, w.lat); }
  else { heading = 0; }

  let azimuth: number;
  if (cam.yawEnabled && cam.yaw !== null && cam.yawBase === 'north') { azimuth = cam.yaw; }
  else if (cam.yawEnabled && cam.yaw !== null && cam.yawBase === 'aircraft') { azimuth = heading + cam.yaw; }
  else { azimuth = heading; }
  azimuth = ((azimuth % 360) + 360) % 360;

  // 水平距離 = 高度 / tan(見下ろし角)。浅い角度で無限に伸びないよう上限を設ける
  const depRad = depression * Math.PI / 180;
  let horiz = w.alt / Math.tan(depRad);
  const MAX_HORIZ = Math.max(w.alt * 6, 30);
  if (!Number.isFinite(horiz) || horiz > MAX_HORIZ) { horiz = MAX_HORIZ; }
  if (horiz < 0) { horiz = 0; }

  const azRad = azimuth * Math.PI / 180;
  const dNorth = horiz * Math.cos(azRad);
  const dEast = horiz * Math.sin(azRad);
  const cosLat = Math.cos(w.lat * Math.PI / 180);
  const targetLon = w.lon + dEast / (METERS_PER_DEG_LAT * cosLat);
  const targetLat = w.lat + dNorth / METERS_PER_DEG_LAT;

  return {
    source: [w.lon, w.lat, sourceZ],
    target: [targetLon, targetLat, 0],
  };
}

interface Props {
  waypoints: Waypoint[];
  selection: number[];
  onSelect: (index: number, mods: { shift: boolean; meta: boolean }) => void;
  editing?: EditingApi;
}

export default function MapView({ waypoints, selection, onSelect, editing }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const is3DRef = useRef(true);
  const selectionRef = useRef<number[]>([]);
  const showAllCamerasRef = useRef(false);
  const editingRef = useRef<EditingApi | undefined>(editing);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const dragActiveRef = useRef(false);
  const [is3D, setIs3D] = useState(true);
  const [showAllCameras, setShowAllCameras] = useState(false);
  const [basemap, setBasemap] = useState<BasemapKey>('seamless');

  function buildCameraLayers(is3D: boolean): any[] {
    const selSet = new Set(selectionRef.current);
    const makeTarget = (si: number) => computeCameraTarget(waypoints, si, is3D ? waypoints[si].alt : 0);
    const layers: any[] = [];

    // 「全カメラ表示」ON のとき、選択中以外の全 waypoint を淡色で描画する
    if (showAllCamerasRef.current) {
      const others: CameraTarget[] = [];
      for (let si = 0; si < waypoints.length; si++) {
        if (selSet.has(waypoints[si].index)) { continue; }
        const ct = makeTarget(si);
        if (ct) { others.push(ct); }
      }
      if (others.length > 0) {
        layers.push(
          new DeckGL.LineLayer({
            id: 'camera-ray-all',
            data: others,
            getSourcePosition: (d: CameraTarget) => d.source,
            getTargetPosition: (d: CameraTarget) => d.target,
            getColor: [255, 170, 0, 120],
            getWidth: 1.5,
            widthMinPixels: 1,
          }),
          new DeckGL.ScatterplotLayer({
            id: 'camera-target-all',
            data: others,
            getPosition: (d: CameraTarget) => d.target,
            getFillColor: [255, 170, 0, 150],
            getLineColor: [0, 0, 0, 150],
            stroked: true,
            getLineWidth: 1,
            lineWidthMinPixels: 1,
            getRadius: 2.5,
            radiusMinPixels: 3,
          }),
        );
      }
    }

    // 選択中の waypoint は「全カメラ表示」の状態に関わらず常に強調して描画する
    const selTargets: CameraTarget[] = [];
    for (let si = 0; si < waypoints.length; si++) {
      if (!selSet.has(waypoints[si].index)) { continue; }
      const ct = makeTarget(si);
      if (ct) { selTargets.push(ct); }
    }
    if (selTargets.length > 0) {
      layers.push(
        new DeckGL.LineLayer({
          id: 'camera-ray',
          data: selTargets,
          getSourcePosition: (d: CameraTarget) => d.source,
          getTargetPosition: (d: CameraTarget) => d.target,
          getColor: [255, 170, 0, 255],
          getWidth: 3,
          widthMinPixels: 2,
        }),
        new DeckGL.ScatterplotLayer({
          id: 'camera-target',
          data: selTargets,
          getPosition: (d: CameraTarget) => d.target,
          getFillColor: [255, 170, 0],
          getLineColor: [0, 0, 0],
          stroked: true,
          getLineWidth: 1,
          lineWidthMinPixels: 1,
          getRadius: 3,
          radiusMinPixels: 5,
        }),
      );
    }

    return layers;
  }

  function buildLayers(is3D: boolean) {
    const getZ = (w: Waypoint) => is3D ? w.alt : 0;
    const selSet = new Set(selectionRef.current);
    const wpData = waypoints.map((w, i) => ({ ...w, color: getWpColor(i, waypoints.length), sel: selSet.has(w.index) }));

    return [
      ...buildCameraLayers(is3D),
      new DeckGL.PathLayer({
        id: 'ground-path',
        data: [{ path: waypoints.map(w => [w.lon, w.lat, 0]) }],
        getPath: (d: any) => d.path,
        getColor: [0, 170, 255, 60],
        getWidth: 2,
        widthMinPixels: 1,
      }),
      new DeckGL.LineLayer({
        id: 'drop-lines',
        data: is3D ? waypoints : [],
        getSourcePosition: (w: Waypoint) => [w.lon, w.lat, 0],
        getTargetPosition: (w: Waypoint) => [w.lon, w.lat, w.alt],
        getColor: [200, 200, 200, 120],
        getWidth: 1,
        widthMinPixels: 1,
      }),
      new DeckGL.PathLayer({
        id: 'flight-path',
        data: [{ path: waypoints.map(w => [w.lon, w.lat, getZ(w)]) }],
        getPath: (d: any) => d.path,
        getColor: [0, 170, 255],
        getWidth: 3,
        widthMinPixels: 2,
      }),
      new DeckGL.ScatterplotLayer({
        id: 'waypoints',
        data: wpData,
        getPosition: (w: any) => [w.lon, w.lat, getZ(w)],
        getFillColor: (w: any) => (w.sel ? [255, 235, 59] : w.color),
        getLineColor: (w: any) => (w.sel ? [255, 90, 0] : [255, 255, 255]),
        stroked: true,
        getLineWidth: (w: any) => (w.sel ? 3 : 2),
        lineWidthMinPixels: 1,
        getRadius: (w: any) => (w.sel ? 6 : 4),
        radiusMinPixels: 4,
        updateTriggers: { getFillColor: selectionRef.current, getLineColor: selectionRef.current, getRadius: selectionRef.current },
        pickable: true,
        onClick: ({ object, event }: any) => {
          if (!object) { return; }
          const src = event?.srcEvent ?? {};
          onSelectRef.current(object.index, { shift: !!src.shiftKey, meta: !!(src.ctrlKey || src.metaKey) });
        },
        onHover: ({ object }: any) => {
          if (mapRef.current) { mapRef.current.getCanvas().style.cursor = object ? 'pointer' : ''; }
        },
      }),
      new DeckGL.TextLayer({
        id: 'arrows',
        data: (() => {
          const arr = [];
          for (let i = 0; i < waypoints.length - 1; i++) {
            const a = waypoints[i], b = waypoints[i + 1];
            const midLat = (a.lat + b.lat) / 2;
            const cosLat = Math.cos(midLat * Math.PI / 180);
            const angleDeg = Math.atan2(b.lat - a.lat, (b.lon - a.lon) * cosLat) * (180 / Math.PI);
            arr.push({ pos: [(a.lon + b.lon) / 2, midLat, (getZ(a) + getZ(b)) / 2], angleDeg });
          }
          return arr;
        })(),
        getPosition: (d: any) => d.pos,
        getText: () => '▶',
        getAngle: (d: any) => d.angleDeg,
        getSize: 11,
        getColor: [0, 200, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontSettings: { sdf: true },
        outlineWidth: 2,
        outlineColor: [0, 0, 0, 150],
      }),
      new DeckGL.TextLayer({
        id: 'labels',
        data: waypoints,
        getPosition: (w: Waypoint) => [w.lon, w.lat, getZ(w) + (is3D ? 8 : 2)],
        getText: (w: Waypoint, { index }: { index: number }) =>
          index === 0 ? 'Start' : index === waypoints.length - 1 ? `End(${w.index})` : String(w.index),
        getSize: 13,
        getColor: [255, 255, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        fontWeight: 'bold',
        fontSettings: { sdf: true },
        outlineWidth: 3,
        outlineColor: [0, 0, 0, 200],
      }),
    ];
  }

  useEffect(() => {
    const center = waypoints[Math.floor(waypoints.length / 2)];
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: makeStyle('seamless'),
      center: [center.lon, center.lat],
      zoom: 15,
      pitch: 0,
      bearing: 0,
    });
    mapRef.current = map;

    // ピックモード中の地図クリックを editing に渡す（アンカー指定 / 選択移動）
    map.on('click', (e: any) => {
      const ed = editingRef.current;
      if (ed && ed.pickMode) {
        ed.onMapPick([e.lngLat.lng, e.lngLat.lat]);
      }
    });

    map.on('load', () => {
      // 初期ロードは最小限のレイヤーで 2D のみ
      // 3D レイヤーは後から追加
      const minimalLayers = [
        new DeckGL.PathLayer({
          id: 'ground-path',
          data: [{ path: waypoints.map(w => [w.lon, w.lat, 0]) }],
          getPath: (d: any) => d.path,
          getColor: [0, 170, 255, 60],
          getWidth: 2,
          widthMinPixels: 1,
        }),
        new DeckGL.ScatterplotLayer({
          id: 'waypoints',
          data: waypoints.map((w, i) => ({ ...w, color: getWpColor(i, waypoints.length) })),
          getPosition: (w: any) => [w.lon, w.lat, 0],
          getFillColor: (w: any) => w.color,
          getLineColor: [255, 255, 255],
          stroked: true,
          getLineWidth: 2,
          lineWidthMinPixels: 1,
          getRadius: 4,
          radiusMinPixels: 4,
          pickable: true,
          onClick: ({ object, event }: any) => {
            if (!object) { return; }
            const src = event?.srcEvent ?? {};
            onSelectRef.current(object.index, { shift: !!src.shiftKey, meta: !!(src.ctrlKey || src.metaKey) });
          },
          onHover: ({ object }: any) => {
            if (mapRef.current) { mapRef.current.getCanvas().style.cursor = object ? 'pointer' : ''; }
          },
        }),
      ];

      const llOf = (info: any): [number, number] => {
        if (info.coordinate) { return [info.coordinate[0], info.coordinate[1]]; }
        const p = map.unproject([info.x, info.y]);
        return [p.lng, p.lat];
      };
      const overlay = new MapboxOverlay({
        layers: minimalLayers,
        // フリーハンドドラッグ: waypoint 上でドラッグ開始したら地図パンを止めて選択を移動
        onDragStart: (info: any) => {
          const ed = editingRef.current;
          if (ed && info.layer?.id === 'waypoints' && info.object) {
            dragActiveRef.current = true;
            map.dragPan.disable();
            ed.onDragStart(info.object.index, llOf(info));
          }
        },
        onDrag: (info: any) => {
          if (!dragActiveRef.current) { return; }
          editingRef.current?.onDragMove(llOf(info));
        },
        onDragEnd: () => {
          if (!dragActiveRef.current) { return; }
          dragActiveRef.current = false;
          map.dragPan.enable();
          editingRef.current?.onDragEnd();
        },
      });
      overlayRef.current = overlay;
      map.addControl(overlay);
      map.addControl(new maplibregl.NavigationControl());

      const coords = waypoints.map(w => [w.lon, w.lat]);
      const bounds = coords.reduce(
        (b: any, c: any) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 40 });

      // 3D レイヤーを 500ms 後に遅延ロード
      setTimeout(() => {
        overlayRef.current?.setProps({ layers: buildLayers(is3DRef.current) });
        if (is3DRef.current) {
          map.easeTo({ pitch: 60, bearing: -20, duration: 800 });
        }
      }, 500);
    });

    return () => map.remove();
  }, []);

  // 選択が変わったらハイライト・カメラ視線レイヤーを描き直す
  useEffect(() => {
    selectionRef.current = selection;
    overlayRef.current?.setProps({ layers: buildLayers(is3DRef.current) });
  }, [selection]);

  // editing の最新値を ref に反映し、ピックモード中はカーソルを変える
  useEffect(() => {
    editingRef.current = editing;
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = editing?.pickMode ? 'crosshair' : '';
    }
  }, [editing]);

  // プレビュー座標（waypoints）が変わったらレイヤーを描き直す
  useEffect(() => {
    overlayRef.current?.setProps({ layers: buildLayers(is3DRef.current) });
  }, [waypoints]);

  const toggle3D = () => {
    const next = !is3DRef.current;
    is3DRef.current = next;
    setIs3D(next);
    mapRef.current?.easeTo({ pitch: next ? 60 : 0, bearing: next ? -20 : 0, duration: 500 });
    overlayRef.current?.setProps({ layers: buildLayers(next) });
  };

  const toggleCameras = () => {
    const next = !showAllCamerasRef.current;
    showAllCamerasRef.current = next;
    setShowAllCameras(next);
    overlayRef.current?.setProps({ layers: buildLayers(is3DRef.current) });
  };

  const switchBasemap = (key: BasemapKey) => {
    setBasemap(key);
    mapRef.current?.setStyle(makeStyle(key));
    mapRef.current?.once('style.load', () => {
      overlayRef.current?.setProps({ layers: buildLayers(is3DRef.current) });
    });
  };

  const BASEMAP_LABELS: Record<BasemapKey, string> = {
    seamless: '地理院 航空写真',
    std: '地理院 標準地図',
    osm: 'OpenStreetMap',
  };

  return (
    <div id="map-wrap">
      <div ref={containerRef} id="map" />
      {editing && <TransformPanel editing={editing} />}
      <div id="basemap-switcher">
        {(Object.keys(BASEMAPS) as BasemapKey[]).map(key => (
          <button
            key={key}
            data-key={key}
            className={basemap === key ? 'active' : undefined}
            onClick={() => switchBasemap(key)}
          >
            {BASEMAP_LABELS[key]}
          </button>
        ))}
        <div className="separator" />
        <button id="btn-3d" className={is3D ? 'active' : undefined} onClick={toggle3D}>
          3D 表示 {is3D ? 'ON' : 'OFF'}
        </button>
        <button id="btn-cameras" className={showAllCameras ? 'active' : undefined} onClick={toggleCameras}>
          📷 All angles {showAllCameras ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
