import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import App from './App';
import { parseKmlWaypoints, Waypoint } from '../shared/parseKmz';
import { RawKmz, kmzEntries } from '../shared/kmzDoc';
import { LonLat, SelXform, isSelIdentity, transformSelectedWaypoints } from '../shared/transform';
import { deleteWaypoints, duplicateWaypoints, metersToDegrees, nearCoincidentWaypoints, transformSelection } from '../shared/edits';
import { bindingSummary, eventCombo, parseBindings } from './shortcuts';
import { EditingApi, SelectMods } from './types';

const ROTATE_STEP = 5;    // ショートカット回転量（度）
const SCALE_STEP = 0.05;  // ショートカット拡大量
const NUDGE_STEP = 5;     // ショートカット移動量（メートル）

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

interface Loaded {
  waypoints: Waypoint[]; // 元の（未変換の）waypoint
  filename: string;
  hasWpml: boolean;
  raw: RawKmz;
}

// ブラウザ上で KMZ を解凍・解析する（VSCode 拡張ホストの処理と等価）。
// 書き出しに備えて元アーカイブ (RawKmz) をそのまま保持する。
async function loadKmz(file: File): Promise<Loaded> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  let templatePath = '', templateKml = '';
  let waylinesPath: string | null = null, waylinesWpml: string | null = null;
  const others: { path: string; bytes: Uint8Array }[] = [];

  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) { continue; }
    if (name.endsWith('template.kml')) { templatePath = name; templateKml = await entry.async('string'); }
    else if (name.endsWith('waylines.wpml')) { waylinesPath = name; waylinesWpml = await entry.async('string'); }
    else { others.push({ path: name, bytes: await entry.async('uint8array') }); }
  }
  if (!templateKml) {
    throw new Error('template.kml not found. Is this a DJI Pilot 2 / FlightHub 2 mission KMZ?');
  }
  const waypoints = parseKmlWaypoints(templateKml);
  if (waypoints.length === 0) {
    throw new Error('No waypoints found in template.kml.');
  }
  return {
    waypoints,
    filename: file.name,
    hasWpml: waylinesWpml !== null,
    raw: { templatePath, templateKml, waylinesPath, waylinesWpml, others },
  };
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Standalone() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  // 選択状態
  const [selection, setSelection] = useState<number[]>([]);
  const selAnchorRef = useRef<number | null>(null);

  // 選択の保留中トランスフォーム（重心まわり回転・拡大＋移動）
  const [selRotationDeg, setSelRotationDeg] = useState(0);
  const [selScale, setSelScale] = useState(1);
  const [pendMove, setPendMove] = useState<LonLat>([0, 0]);
  const [pickMode, setPickMode] = useState<'move' | null>(null);
  const dragStartRef = useRef<LonLat | null>(null);

  // ボックス選択ツール
  const [boxSelect, setBoxSelect] = useState(false);

  // ショートカット: 別ファイル keybindings.json を読み込み、変更をホットリロード
  const bindingsRef = useRef<Map<string, string>>(new Map());
  const actionsRef = useRef<Record<string, () => void>>({});
  const viewActionsRef = useRef<{ toggle3D?: () => void; toggleCameras?: () => void; cycleBasemap?: () => void }>({});
  const [shortcuts, setShortcuts] = useState<{ action: string; keys: string[] }[]>([]);

  useEffect(() => {
    let alive = true;
    let last = '';
    const load = async () => {
      try {
        const text = await (await fetch('./keybindings.json', { cache: 'no-store' })).text();
        if (!alive || text === last) { return; }
        last = text;
        const json = JSON.parse(text);
        bindingsRef.current = parseBindings(json);
        setShortcuts(bindingSummary(json));
      } catch { /* ファイルが無い/不正なら無視（既定は無割当） */ }
    };
    void load();
    const id = setInterval(() => void load(), 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = bindingsRef.current.get(eventCombo(e));
      if (!action) { return; }
      // 入力欄にフォーカスがあっても apply / clear は通す（スライダー操作直後の Enter 対策）。
      // それ以外のショートカットは入力中は無効にする。
      const typing = isTypingTarget(e.target);
      if (typing && action !== 'apply' && action !== 'clearSelection') { return; }
      if (typing) { (e.target as HTMLElement).blur?.(); }
      const fn = actionsRef.current[action];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const resetXform = useCallback(() => {
    setSelRotationDeg(0);
    setSelScale(1);
    setPendMove([0, 0]);
    setPickMode(null);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const loaded = await loadKmz(file);
      resetXform();
      setSelection([]);
      selAnchorRef.current = null;
      setData(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [resetXform]);

  // クリック修飾キーに応じて選択を更新する（単一 / 追加トグル / 範囲）
  const handleSelect = useCallback((index: number, mods: SelectMods) => {
    resetXform();
    setSelection((prev) => {
      if (mods.shift && selAnchorRef.current !== null) {
        const a = selAnchorRef.current;
        const lo = Math.min(a, index), hi = Math.max(a, index);
        const range: number[] = [];
        for (let i = lo; i <= hi; i++) { range.push(i); }
        return range;
      }
      selAnchorRef.current = index;
      if (mods.meta) {
        return prev.includes(index) ? prev.filter((x) => x !== index) : [...prev, index];
      }
      return prev.length === 1 && prev[0] === index ? [] : [index];
    });
  }, [resetXform]);

  const selXform: SelXform = { rotationDeg: selRotationDeg, scale: selScale, dLon: pendMove[0], dLat: pendMove[1] };

  // プレビュー: 選択だけを保留トランスフォームで変換して表示
  const previewWaypoints = useMemo(
    () => (data ? transformSelectedWaypoints(data.waypoints, new Set(selection), selXform) : []),
    [data, selection, selRotationDeg, selScale, pendMove[0], pendMove[1]],
  );

  // 安全装置: 近接（重なり）waypoint
  const warnings = useMemo(() => (data ? nearCoincidentWaypoints(data.raw) : []), [data]);

  // 編集を適用: 新しい RawKmz から再解析し、保留トランスフォームをリセット
  const applyEdit = useCallback((cur: Loaded, newRaw: RawKmz, newSelection: number[]) => {
    const waypoints = parseKmlWaypoints(newRaw.templateKml);
    resetXform();
    setData({ ...cur, raw: newRaw, waypoints, hasWpml: newRaw.waylinesWpml !== null });
    setSelection(newSelection);
  }, [resetXform]);

  if (data) {
    const selCentroid = (): LonLat => {
      let sx = 0, sy = 0;
      for (const i of selection) { const w = data.waypoints.find(x => x.index === i)!; sx += w.lon; sy += w.lat; }
      return [sx / selection.length, sy / selection.length];
    };
    const commitXform = (x: SelXform) => {
      if (!selection.length || isSelIdentity(x)) { return; }
      applyEdit(data, transformSelection(data.raw, new Set(selection), x), selection);
    };

    const editing: EditingApi = {
      pickMode,
      onMapPick: (ll) => {
        if (pickMode === 'move' && selection.length) {
          const c = selCentroid();
          setPendMove([ll[0] - c[0], ll[1] - c[1]]);
        }
        setPickMode(null);
      },
      onExport: () => {
        const outRaw = (selection.length && !isSelIdentity(selXform))
          ? transformSelection(data.raw, new Set(selection), selXform)
          : data.raw;
        const zip = new JSZip();
        for (const e of kmzEntries(outRaw)) { zip.file(e.path, e.data); }
        void zip.generateAsync({ type: 'blob' }).then((blob) => {
          triggerDownload(blob, `${data.filename.replace(/\.kmz$/i, '')} - edited.kmz`);
        });
      },
      selectionCount: selection.length,
      onSelectAll: () => { resetXform(); setSelection(data.waypoints.map(w => w.index)); },
      onClearSelection: () => { resetXform(); setSelection([]); },
      onDuplicate: () => {
        if (!selection.length) { return; }
        const { raw: nr, newIndices } = duplicateWaypoints(data.raw, new Set(selection));
        applyEdit(data, nr, newIndices);
      },
      onDelete: () => {
        if (!selection.length) { return; }
        applyEdit(data, deleteWaypoints(data.raw, new Set(selection)), []);
      },
      selRotationDeg,
      selScale,
      xformActive: !isSelIdentity(selXform),
      onSelRotate: setSelRotationDeg,
      onSelScale: setSelScale,
      onNudge: (dEast, dNorth) => {
        if (!selection.length) { return; }
        const { dLon, dLat } = metersToDegrees(dEast, dNorth, selCentroid()[1]);
        setPendMove(([x, y]) => [x + dLon, y + dLat]);
      },
      onStartMove: () => { if (selection.length) { setPickMode('move'); } },
      onApply: () => commitXform(selXform),
      onResetXform: resetXform,
      onDragStart: (index, ll) => {
        if (!selection.includes(index)) { setSelection([index]); selAnchorRef.current = index; }
        dragStartRef.current = ll;
      },
      onDragMove: (ll) => {
        const s = dragStartRef.current;
        if (s) { setPendMove([ll[0] - s[0], ll[1] - s[1]]); }
      },
      onDragEnd: () => {
        const s = dragStartRef.current;
        dragStartRef.current = null;
        if (s) { commitXform(selXform); }
      },
      boxSelect,
      onToggleBox: () => setBoxSelect((v) => !v),
      onSelectMany: (indices, additive) => {
        resetXform();
        setSelection((prev) => (additive ? Array.from(new Set([...prev, ...indices])) : indices));
        selAnchorRef.current = indices.length ? indices[indices.length - 1] : null;
      },
      warnings,
      shortcuts,
      viewActions: viewActionsRef,
    };

    // keydown ハンドラが参照するアクション割当（毎レンダー最新化）
    actionsRef.current = {
      duplicate: editing.onDuplicate,
      delete: editing.onDelete,
      selectAll: editing.onSelectAll,
      clearSelection: editing.onClearSelection,
      apply: editing.onApply,
      resetTransform: editing.onResetXform,
      nudgeNorth: () => editing.onNudge(0, NUDGE_STEP),
      nudgeSouth: () => editing.onNudge(0, -NUDGE_STEP),
      nudgeWest: () => editing.onNudge(-NUDGE_STEP, 0),
      nudgeEast: () => editing.onNudge(NUDGE_STEP, 0),
      rotateLeft: () => setSelRotationDeg((v) => v - ROTATE_STEP),
      rotateRight: () => setSelRotationDeg((v) => v + ROTATE_STEP),
      scaleUp: () => setSelScale((v) => Math.round((v + SCALE_STEP) * 100) / 100),
      scaleDown: () => setSelScale((v) => Math.max(0.05, Math.round((v - SCALE_STEP) * 100) / 100)),
      moveMode: editing.onStartMove,
      boxSelect: editing.onToggleBox,
      export: editing.onExport,
      toggle3d: () => viewActionsRef.current.toggle3D?.(),
      toggleCameras: () => viewActionsRef.current.toggleCameras?.(),
      cycleBasemap: () => viewActionsRef.current.cycleBasemap?.(),
    };
    return (
      <>
        <App
          waypoints={previewWaypoints}
          filename={data.filename}
          hasWpml={data.hasWpml}
          editing={editing}
          selection={selection}
          onSelect={handleSelect}
        />
        <button className="reset-btn" onClick={() => setData(null)}>← Open another KMZ</button>
      </>
    );
  }

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) { void handleFile(f); }
      }}
    >
      <input
        id="file-input"
        type="file"
        accept=".kmz"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.currentTarget.files && e.currentTarget.files[0];
          if (f) { void handleFile(f); }
        }}
      />
      <label htmlFor="file-input" className="drop-card">
        <div className="drop-icon">🛰️</div>
        <div className="drop-title">{busy ? 'Loading…' : (<>Drop a DJI <b>.kmz</b> here</>)}</div>
        <div className="drop-sub">or click to browse — DJI Pilot 2 &amp; FlightHub 2 supported</div>
        {error && <div className="drop-error">{error}</div>}
      </label>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Standalone />);
