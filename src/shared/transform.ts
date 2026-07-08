// フライトパスの幾何変換（平行移動＋回転、将来的にスケール）。
// - プレビュー用に Waypoint[] を変換する transformWaypoints
// - 書き出し用に RawKmz のテキストを外科的に書き換える transformRawKmz
// vscode / node 依存なし。

import { RawKmz } from './kmzDoc';
import { Waypoint } from './parseKmz';

const METERS_PER_DEG = 111320; // 緯度1度あたりのメートル（MapView と同じ近似）

export type LonLat = [number, number];

export interface TransformParams {
  anchor: LonLat;     // 変換の基準点（通常は waypoint 0 = takeOffRefPoint）
  newAnchor: LonLat;  // 基準点の移動先
  rotationDeg: number; // 時計回りの回転角（度）
  scale: number;       // 拡大率（Phase 1 では常に 1）
}

// 角度を [-180, 180) に正規化する（DJI の yaw 範囲）
function normDeg(a: number): number {
  return ((a % 360) + 540) % 360 - 180;
}

export function isIdentity(p: TransformParams): boolean {
  return p.rotationDeg % 360 === 0
    && p.scale === 1
    && p.anchor[0] === p.newAnchor[0]
    && p.anchor[1] === p.newAnchor[1];
}

// 1点 (lon,lat) を変換する。基準点まわりでローカル平面に落とし、
// 時計回り回転＋スケールを適用し、移動先基準点で緯度経度に戻す。
export function transformPoint(lon: number, lat: number, p: TransformParams): LonLat {
  const [alon, alat] = p.anchor;
  const cosA = Math.cos(alat * Math.PI / 180);
  const x = (lon - alon) * cosA * METERS_PER_DEG; // 東方向メートル
  const y = (lat - alat) * METERS_PER_DEG;        // 北方向メートル

  const t = p.rotationDeg * Math.PI / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  // 時計回り回転（compass 方位に +rotationDeg するのと一致）
  const xr = (x * cos + y * sin) * p.scale;
  const yr = (-x * sin + y * cos) * p.scale;

  const [nlon, nlat] = p.newAnchor;
  const cosN = Math.cos(nlat * Math.PI / 180);
  return [
    nlon + xr / (cosN * METERS_PER_DEG),
    nlat + yr / METERS_PER_DEG,
  ];
}

// プレビュー用: 座標を変換し、回転時はカメラ yaw も回す
export function transformWaypoints(wps: Waypoint[], p: TransformParams): Waypoint[] {
  if (isIdentity(p)) { return wps; }
  const rot = p.rotationDeg % 360 !== 0;
  return wps.map(w => {
    const [lon, lat] = transformPoint(w.lon, w.lat, p);
    let camera = w.camera;
    if (camera && rot && camera.yaw !== null) {
      camera = { ...camera, yaw: normDeg(camera.yaw + p.rotationDeg) };
    }
    return { ...w, lon, lat, camera };
  });
}

// ---- テキスト書き換え（書き出し用） ----

function fmtCoord(n: number): string { return n.toFixed(9); }
function fmtAngle(n: number): string { return (Math.round(n * 1000) / 1000).toString(); }

// <coordinates> lon,lat[,alt] </coordinates>（前後の空白/改行は保持）
function rewriteCoordinates(text: string, p: TransformParams): string {
  return text.replace(
    /(<coordinates>)(\s*)([-\d.eE+]+),([-\d.eE+]+)((?:,[-\d.eE+]+)?)(\s*)(<\/coordinates>)/g,
    (_m, open, ws1, lonS, latS, altPart, ws2, close) => {
      const [nlon, nlat] = transformPoint(parseFloat(lonS), parseFloat(latS), p);
      return `${open}${ws1}${fmtCoord(nlon)},${fmtCoord(nlat)}${altPart}${ws2}${close}`;
    },
  );
}

// <wpml:takeOffRefPoint> lat,lon,alt </...>（緯度経度が逆順であることに注意）
function rewriteTakeOffRefPoint(text: string, p: TransformParams): string {
  return text.replace(
    /(<wpml:takeOffRefPoint>)([^<]*)(<\/wpml:takeOffRefPoint>)/g,
    (m, open, body, close) => {
      const parts = body.split(',');
      if (parts.length < 2) { return m; }
      const lat = parseFloat(parts[0]), lon = parseFloat(parts[1]);
      const [nlon, nlat] = transformPoint(lon, lat, p);
      const rest = parts.slice(2).join(',');
      return `${open}${fmtCoord(nlat)},${fmtCoord(nlon)}${rest ? ',' + rest : ''}${close}`;
    },
  );
}

// <wpml:waypointPoiPoint> lon,lat,alt </...>（0,0 は「POI なし」なので変換しない）
function rewritePoiPoint(text: string, p: TransformParams): string {
  return text.replace(
    /(<wpml:waypointPoiPoint>)([^<]*)(<\/wpml:waypointPoiPoint>)/g,
    (m, open, body, close) => {
      const parts = body.split(',');
      if (parts.length < 2) { return m; }
      const lon = parseFloat(parts[0]), lat = parseFloat(parts[1]);
      if (lon === 0 && lat === 0) { return m; }
      const [nlon, nlat] = transformPoint(lon, lat, p);
      const rest = parts.slice(2).join(',');
      return `${open}${fmtCoord(nlon)},${fmtCoord(nlat)}${rest ? ',' + rest : ''}${close}`;
    },
  );
}

// orientedShoot アクション内の絶対方位 (gimbalYawRotateAngle / aircraftHeading) を回転する。
// followWayline の waypointHeadingAngle や gimbalRotate の yaw には触れない。
function rewriteOrientedShootHeadings(text: string, rotationDeg: number): string {
  return text.replace(
    /<wpml:actionActuatorFunc>orientedShoot<\/wpml:actionActuatorFunc>\s*<wpml:actionActuatorFuncParam>[\s\S]*?<\/wpml:actionActuatorFuncParam>/g,
    (block) => block.replace(
      /(<wpml:(?:gimbalYawRotateAngle|aircraftHeading)>)([-\d.eE+]+)(<\/wpml:(?:gimbalYawRotateAngle|aircraftHeading)>)/g,
      (_m, open, v, close) => `${open}${fmtAngle(normDeg(parseFloat(v) + rotationDeg))}${close}`,
    ),
  );
}

function applyToText(text: string, p: TransformParams): string {
  let out = rewriteCoordinates(text, p);
  out = rewritePoiPoint(out, p);
  out = rewriteTakeOffRefPoint(out, p);
  if (p.rotationDeg % 360 !== 0) { out = rewriteOrientedShootHeadings(out, p.rotationDeg); }
  return out;
}

// RawKmz 全体を変換する（template と waylines の両方に同じ変換を適用）
export function transformRawKmz(raw: RawKmz, p: TransformParams): RawKmz {
  if (isIdentity(p)) { return raw; }
  return {
    ...raw,
    templateKml: applyToText(raw.templateKml, p),
    waylinesWpml: raw.waylinesWpml !== null ? applyToText(raw.waylinesWpml, p) : null,
  };
}
