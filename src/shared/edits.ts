// waypoint の構造編集（複製 / 削除 / 移動）。RawKmz のテキストを
// ブロックモデルで書き換え、template.kml と waylines.wpml を同期させる。
// vscode / node 依存なし（crypto.randomUUID はブラウザ・Node 双方で利用可）。

import { RawKmz, WpmlBlocks, blockIndex, joinPlacemarks, splitPlacemarks } from './kmzDoc';
import { parseKmlWaypoints } from './parseKmz';

const METERS_PER_DEG = 111320;

function uuid(): string {
  return (globalThis.crypto as Crypto).randomUUID();
}
function hex32(): string {
  return (uuid() + uuid()).replace(/-/g, '').slice(0, 32);
}

// 選択ブロック群に含まれる一意 ID（actionUUID / orientedFilePath /
// orientedFileSuffix の hex トークン）について、旧値→新値の対応表を作る。
// template と waylines は同一 waypoint で同じ ID を共有するため、両ファイルに
// 同じ対応表を適用することでファイル間の整合性を保つ。
function buildIdMap(selectedBlocks: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const collect = (pattern: RegExp, gen: () => string) => {
    for (const blk of selectedBlocks) {
      const re = new RegExp(pattern.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(blk)) !== null) {
        if (!map.has(m[1])) { map.set(m[1], gen()); }
      }
    }
  };
  collect(/<wpml:actionUUID>([^<]+)<\/wpml:actionUUID>/, uuid);
  collect(/<wpml:orientedFilePath>([^<]+)<\/wpml:orientedFilePath>/, uuid);
  collect(/<wpml:orientedFileSuffix>[^<]*?([0-9a-f]{32})[^<]*<\/wpml:orientedFileSuffix>/, hex32);
  return map;
}

// 対応表に従って旧 ID をすべて新 ID に置換する（文字列リテラル置換）
function applyIdMap(block: string, map: Map<string, string>): string {
  let b = block;
  for (const [oldV, newV] of map) { b = b.split(oldV).join(newV); }
  return b;
}

// wpml:index と、それを参照する actionGroupStart/EndIndex を位置に合わせて振り直す
function reindexBlocks(blocks: string[]): string[] {
  return blocks.map((b, i) => b
    .replace(/<wpml:index>\d+<\/wpml:index>/, `<wpml:index>${i}</wpml:index>`)
    .replace(/<wpml:actionGroupStartIndex>\d+<\/wpml:actionGroupStartIndex>/g, `<wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>`)
    .replace(/<wpml:actionGroupEndIndex>\d+<\/wpml:actionGroupEndIndex>/g, `<wpml:actionGroupEndIndex>${i}</wpml:actionGroupEndIndex>`));
}

// ファイル全体で actionGroupId を出現順に振り直し、一意性を担保する
function renumberActionGroupIds(text: string): string {
  let n = 0;
  return text.replace(/<wpml:actionGroupId>\d+<\/wpml:actionGroupId>/g, () => `<wpml:actionGroupId>${n++}</wpml:actionGroupId>`);
}

function num(text: string, tag: string): number | null {
  const m = new RegExp(`<wpml:${tag}>\\s*(-?[\\d.]+)\\s*</wpml:${tag}>`).exec(text);
  return m ? parseFloat(m[1]) : null;
}

// waylines の総距離・所要時間を再計算する（幾何/構造が変わったとき）。
// 直線区間の 3D 距離の総和。所要時間は距離/速度の概算（FlightHub 取り込み時に再計算される）。
function recomputeDistanceDuration(waylines: string): string {
  const wps = parseKmlWaypoints(waylines);
  let dist = 0;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i];
    const cosLat = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    const dE = (b.lon - a.lon) * cosLat * METERS_PER_DEG;
    const dN = (b.lat - a.lat) * METERS_PER_DEG;
    const dZ = (b.alt - a.alt);
    dist += Math.sqrt(dE * dE + dN * dN + dZ * dZ);
  }
  const speed = num(waylines, 'autoFlightSpeed') ?? num(waylines, 'globalTransitionalSpeed') ?? 10;
  const dur = speed > 0 ? dist / speed : 0;
  return waylines
    .replace(/<wpml:distance>[^<]*<\/wpml:distance>/, `<wpml:distance>${dist}</wpml:distance>`)
    .replace(/<wpml:duration>[^<]*<\/wpml:duration>/, `<wpml:duration>${dur}</wpml:duration>`);
}

// 選択ブロックの座標を (dLon,dLat) だけずらす（POI は非ゼロ時のみ）
function shiftCoordsInBlock(block: string, dLon: number, dLat: number): string {
  let b = block.replace(
    /(<coordinates>)(\s*)([-\d.eE+]+),([-\d.eE+]+)((?:,[-\d.eE+]+)?)(\s*)(<\/coordinates>)/g,
    (_m, o, w1, lonS, latS, alt, w2, c) => `${o}${w1}${(parseFloat(lonS) + dLon).toFixed(9)},${(parseFloat(latS) + dLat).toFixed(9)}${alt}${w2}${c}`,
  );
  b = b.replace(
    /(<wpml:waypointPoiPoint>)([^<]*)(<\/wpml:waypointPoiPoint>)/g,
    (m, o, body, c) => {
      const p = body.split(',');
      if (p.length < 2) { return m; }
      const lon = parseFloat(p[0]), lat = parseFloat(p[1]);
      if (lon === 0 && lat === 0) { return m; }
      const rest = p.slice(2).join(',');
      return `${o}${(lon + dLon).toFixed(9)},${(lat + dLat).toFixed(9)}${rest ? ',' + rest : ''}${c}`;
    },
  );
  return b;
}

// takeOffRefPoint（lat,lon,alt）を (dLon,dLat) だけずらす
function shiftTakeOff(text: string, dLon: number, dLat: number): string {
  return text.replace(/(<wpml:takeOffRefPoint>)([^<]*)(<\/wpml:takeOffRefPoint>)/g, (m, o, body, c) => {
    const p = body.split(',');
    if (p.length < 2) { return m; }
    const lat = parseFloat(p[0]) + dLat, lon = parseFloat(p[1]) + dLon;
    const rest = p.slice(2).join(',');
    return `${o}${lat.toFixed(9)},${lon.toFixed(9)}${rest ? ',' + rest : ''}${c}`;
  });
}

interface EditOpts {
  reindex: boolean;   // wpml:index を振り直す（削除/複製）
  renumber: boolean;  // actionGroupId を振り直す（削除/複製）
  recompute: boolean; // waylines の距離/時間を再計算する
}

function editText(text: string, transformBlocks: (blocks: string[]) => string[], isWaylines: boolean, opts: EditOpts): string {
  const parts: WpmlBlocks = splitPlacemarks(text);
  let blocks = transformBlocks(parts.blocks);
  if (opts.reindex) { blocks = reindexBlocks(blocks); }
  let out = joinPlacemarks({ ...parts, blocks });
  if (opts.renumber) { out = renumberActionGroupIds(out); }
  if (isWaylines && opts.recompute) { out = recomputeDistanceDuration(out); }
  return out;
}

function editRaw(raw: RawKmz, transformBlocks: (blocks: string[]) => string[], opts: EditOpts): RawKmz {
  return {
    ...raw,
    templateKml: editText(raw.templateKml, transformBlocks, false, opts),
    waylinesWpml: raw.waylinesWpml !== null ? editText(raw.waylinesWpml, transformBlocks, true, opts) : null,
  };
}

// 選択 waypoint を削除する（残りを 0..n-1 に振り直す）
export function deleteWaypoints(raw: RawKmz, indices: Set<number>): RawKmz {
  return editRaw(raw, (blocks) => blocks.filter(b => !indices.has(blockIndex(b))), { reindex: true, renumber: true, recompute: true });
}

// 選択 waypoint を複製し、選択範囲の直後に挿入する。ID は再生成する。
// 戻り値: 新しい RawKmz と、複製されたブロックの新しい index 一覧（選択の付け替え用）。
export function duplicateWaypoints(raw: RawKmz, indices: Set<number>): { raw: RawKmz; newIndices: number[] } {
  // 対応表は元 template の選択ブロックから作り、両ファイルに同じものを適用する
  const selectedOriginal = splitPlacemarks(raw.templateKml).blocks.filter(b => indices.has(blockIndex(b)));
  const idMap = buildIdMap(selectedOriginal);
  const dup = (blocks: string[]): string[] => {
    let lastSelPos = -1;
    blocks.forEach((b, i) => { if (indices.has(blockIndex(b))) { lastSelPos = i; } });
    const clones = blocks.filter(b => indices.has(blockIndex(b))).map(b => applyIdMap(b, idMap));
    const result: string[] = [];
    blocks.forEach((b, i) => {
      result.push(b);
      if (i === lastSelPos) { result.push(...clones); }
    });
    return result;
  };
  const out = editRaw(raw, dup, { reindex: true, renumber: true, recompute: true });
  // 複製後の新しい index 範囲を算出（元の選択が k 個なら、最後の選択位置の直後 k 個）
  const orig = splitPlacemarks(raw.templateKml).blocks;
  let lastSelPos = -1;
  orig.forEach((b, i) => { if (indices.has(blockIndex(b))) { lastSelPos = i; } });
  const k = indices.size;
  const newIndices: number[] = [];
  for (let j = 0; j < k; j++) { newIndices.push(lastSelPos + 1 + j); }
  return { raw: out, newIndices };
}

// 選択 waypoint を (dLon,dLat) だけ移動する（構造は不変、距離のみ再計算）
export function translateWaypoints(raw: RawKmz, indices: Set<number>, dLon: number, dLat: number): RawKmz {
  const move = (blocks: string[]): string[] =>
    blocks.map(b => (indices.has(blockIndex(b)) ? shiftCoordsInBlock(b, dLon, dLat) : b));
  let out = editRaw(raw, move, { reindex: false, renumber: false, recompute: true });
  // waypoint 0 を動かす場合は takeOffRefPoint も追従させる
  if (indices.has(0)) {
    out = { ...out, templateKml: shiftTakeOff(out.templateKml, dLon, dLat), waylinesWpml: out.waylinesWpml !== null ? shiftTakeOff(out.waylinesWpml, dLon, dLat) : null };
  }
  return out;
}

// 度→メートル換算のヘルパ（UI からの ΔEast/ΔNorth 指定に使う）
export function metersToDegrees(dEast: number, dNorth: number, atLat: number): { dLon: number; dLat: number } {
  const cosLat = Math.cos(atLat * Math.PI / 180);
  return { dLon: dEast / (METERS_PER_DEG * cosLat), dLat: dNorth / METERS_PER_DEG };
}
