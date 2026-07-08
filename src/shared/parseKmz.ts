// DJI Pilot 2 / FlightHub 2 の KMZ(WPML) を解析する共有ロジック。
// VSCode 拡張とスタンドアロン Web の双方から利用するため、vscode / node 依存を持たない。

export interface CameraParam {
  pitch: number;                        // gimbal pitch in degrees (negative = looking down)
  yaw: number | null;                   // gimbal yaw angle in degrees, as authored
  yawBase: 'north' | 'aircraft' | null; // reference frame for `yaw`
  yawEnabled: boolean;                  // whether gimbal yaw is explicitly controlled
}

export interface Waypoint {
  index: number;
  lon: number;
  lat: number;
  alt: number;
  camera?: CameraParam;
}

// `<Placemark>` ブロックから wpml の数値要素を取り出す（見つからなければ null）
export function extractWpmlNumber(block: string, tag: string): number | null {
  const m = new RegExp(`<wpml:${tag}>\\s*(-?[\\d.]+)\\s*</wpml:${tag}>`).exec(block);
  if (!m) { return null; }
  const value = parseFloat(m[1]);
  return Number.isFinite(value) ? value : null;
}

// 指定した actuator func を持つ `<wpml:action>` ブロックの中身を取り出す
export function findActionBlock(block: string, func: string): string | null {
  const re = /<wpml:action>([\s\S]*?)<\/wpml:action>/g;
  const funcRe = new RegExp(`<wpml:actionActuatorFunc>\\s*${func}\\s*</wpml:actionActuatorFunc>`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (funcRe.test(m[1])) { return m[1]; }
  }
  return null;
}

// waypoint のカメラ向きを抽出する。撮影姿勢を持つ orientedShoot を最優先し、
// 無ければ gimbalRotate アクションから取得する。どちらも無ければ undefined
export function extractCamera(block: string): CameraParam | undefined {
  const oriented = findActionBlock(block, 'orientedShoot');
  if (oriented) {
    const pitch = extractWpmlNumber(oriented, 'gimbalPitchRotateAngle');
    if (pitch !== null) {
      // orientedShoot の yaw は北基準の絶対方位。aircraftHeading が最も確実
      const yaw = extractWpmlNumber(oriented, 'aircraftHeading') ?? extractWpmlNumber(oriented, 'gimbalYawRotateAngle');
      return { pitch, yaw, yawBase: 'north', yawEnabled: yaw !== null };
    }
  }

  const gimbal = findActionBlock(block, 'gimbalRotate');
  if (gimbal) {
    const pitch = extractWpmlNumber(gimbal, 'gimbalPitchRotateAngle');
    if (pitch !== null) {
      const yawEnabled = extractWpmlNumber(gimbal, 'gimbalYawRotateEnable') === 1;
      const yawBaseMatch = /<wpml:gimbalHeadingYawBase>\s*(\w+)\s*<\/wpml:gimbalHeadingYawBase>/.exec(gimbal);
      const yawBase = yawBaseMatch && (yawBaseMatch[1] === 'north' || yawBaseMatch[1] === 'aircraft')
        ? (yawBaseMatch[1] as 'north' | 'aircraft')
        : null;
      return {
        pitch,
        yaw: yawEnabled ? extractWpmlNumber(gimbal, 'gimbalYawRotateAngle') : null,
        yawBase,
        yawEnabled,
      };
    }
  }

  return undefined;
}

// KML の内容から waypoint を抽出する
export function parseKmlWaypoints(kml: string): Waypoint[] {
  const waypoints: Waypoint[] = [];
  // waypointとなる `<Placemark>` を抽出し、座標と index を取り出す
  const placemarkRegex = /<Placemark[\s\S]*?<\/Placemark>/g;
  const coordRegex = /<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/;
  const indexRegex = /<(?:wpml:)?index>(\d+)<\/(?:wpml:)?index>/;

  let match: RegExpExecArray | null;
  let autoIndex = 1;

  while ((match = placemarkRegex.exec(kml)) !== null) {
    const block = match[0];
    const coordMatch = coordRegex.exec(block);
    if (!coordMatch) { continue; }

    const firstCoord = coordMatch[1].trim().split(/\s+/)[0];
    const parts = firstCoord.split(',');
    if (parts.length < 2) { continue; }

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) { continue; }

    // 高度の扱いは export 元で異なる:
    // - DJI Pilot 2: `<coordinates>` が lon,lat,alt の 3 値を持つことがある
    // - FlightHub 2 / WPML 標準: `<coordinates>` は lon,lat の 2 値で、高度は
    //   `<wpml:executeHeight>` / `<wpml:height>` / `<wpml:ellipsoidHeight>` に格納される
    const altFromCoord = parts.length >= 3 ? parseFloat(parts[2]) : NaN;
    const alt = Number.isFinite(altFromCoord)
      ? altFromCoord
      : (extractWpmlNumber(block, 'executeHeight')
        ?? extractWpmlNumber(block, 'height')
        ?? extractWpmlNumber(block, 'ellipsoidHeight')
        ?? 0);

    const indexMatch = indexRegex.exec(block);
    const index = indexMatch ? parseInt(indexMatch[1]) : autoIndex;
    autoIndex++;

    // カメラの向き（撮影姿勢）を抽出。存在する場合のみ camera を付与する
    const camera = extractCamera(block);

    waypoints.push({ index, lon, lat, alt, camera });
  }

  // `<Placemark>` を見つけた順に一旦 `waypoints` に追加するが、waypoint の論理的な順序（`wpml:index`）が保証されないため、
  // indexでsortして正しい順序に並び替える。これにより、`wpml:index` が存在しない場合でも、ファイル内の順序で waypoint を表示できる
  waypoints.sort((a, b) => a.index - b.index);
  return waypoints;
}
