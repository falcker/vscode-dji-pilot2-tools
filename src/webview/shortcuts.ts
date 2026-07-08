// キーボードショートカットの解析・照合。keybindings.json（別ファイル）を読み込み、
// KeyboardEvent を正規化した文字列（例 "ctrl+d", "shift+arrowup", "w"）で照合する。

const MOD_ORDER = ['ctrl', 'meta', 'alt', 'shift'] as const;

// 修飾キーを一定順に並べたキー文字列を作る
function combo(mods: { ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }, key: string): string {
  const parts: string[] = [];
  for (const m of MOD_ORDER) { if (mods[m]) { parts.push(m); } }
  parts.push(key);
  return parts.join('+');
}

// KeyboardEvent を正規化した combo 文字列にする
export function eventCombo(e: KeyboardEvent): string {
  let key = e.key.toLowerCase();
  if (key === ' ') { key = 'space'; }
  return combo({ ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey }, key);
}

// "Ctrl+D" のような設定文字列を正規化する（修飾子の順序をそろえる）
function normalizeBindingKey(s: string): string {
  const parts = s.split('+').map(p => p.trim().toLowerCase()).filter(Boolean);
  const mods = { ctrl: false, meta: false, alt: false, shift: false };
  let key = '';
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') { mods.ctrl = true; }
    else if (p === 'meta' || p === 'cmd' || p === 'command') { mods.meta = true; }
    else if (p === 'alt' || p === 'option') { mods.alt = true; }
    else if (p === 'shift') { mods.shift = true; }
    else { key = p; }
  }
  return combo(mods, key);
}

// keybindings.json の内容から「combo文字列 -> action名」の対応表を作る
export function parseBindings(json: any): Map<string, string> {
  const map = new Map<string, string>();
  const bindings = json && typeof json === 'object' ? json.bindings : null;
  if (!bindings || typeof bindings !== 'object') { return map; }
  for (const action of Object.keys(bindings)) {
    const raw = bindings[action];
    const keys: string[] = Array.isArray(raw) ? raw : [raw];
    for (const k of keys) {
      if (typeof k === 'string' && k.trim()) { map.set(normalizeBindingKey(k), action); }
    }
  }
  return map;
}

// 表示用: action -> キー一覧
export function bindingSummary(json: any): { action: string; keys: string[] }[] {
  const bindings = json && typeof json === 'object' ? json.bindings : null;
  if (!bindings || typeof bindings !== 'object') { return []; }
  return Object.keys(bindings).map(action => ({
    action,
    keys: (Array.isArray(bindings[action]) ? bindings[action] : [bindings[action]]).filter((k: any) => typeof k === 'string'),
  }));
}
