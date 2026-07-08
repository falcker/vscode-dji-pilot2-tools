// KMZ アーカイブを可逆的に保持するための生データモデル。
// パーサ (parseKmz.ts) は表示用の欠損モデルしか返さないため、書き出し時は
// 元の template.kml / waylines.wpml のテキストをそのまま保持して外科的に編集する。
// vscode / node 依存を持たない（拡張・スタンドアロン双方から利用）。

export interface RawKmz {
  templatePath: string;                       // 例: "wpmz/template.kml"
  templateKml: string;
  waylinesPath: string | null;                // 例: "wpmz/waylines.wpml"（無い場合 null）
  waylinesWpml: string | null;
  // template / waylines 以外の全エントリ（res/ など）はそのまま再梱包する
  others: { path: string; bytes: Uint8Array }[];
}

// 再 zip 用に全エントリを列挙する。data は文字列 or バイト列で、
// JSZip.file() にそのまま渡せる。
export function kmzEntries(raw: RawKmz): { path: string; data: string | Uint8Array }[] {
  const entries: { path: string; data: string | Uint8Array }[] = [];
  for (const o of raw.others) { entries.push({ path: o.path, data: o.bytes }); }
  entries.push({ path: raw.templatePath, data: raw.templateKml });
  if (raw.waylinesPath && raw.waylinesWpml !== null) {
    entries.push({ path: raw.waylinesPath, data: raw.waylinesWpml });
  }
  return entries;
}
