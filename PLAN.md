# PLAN: Reusable flight-path editing & "stamp" for DJI FlightHub 2 missions

> Source of truth for the editing feature. Kept up to date as work lands.
> Status: **Phases 1–3 implemented** (standalone). Selection is the single model:
> select-all + transform = the whole-path "stamp". Extension write-back still pending.

## Context

Authoring a FlightHub 2 inspection mission for a single storage tank currently
takes ~**8 hours**: dozens of waypoints, each with per-shot gimbal pitch/yaw for
oblique facade captures plus nadir roof grids (see the real files —
`[F-61-Roof]`, `Plan-1-Seal`, `Plan-3-RoofBunds`). Most tanks share the **same
scan pattern**; the work is almost entirely repetition at a new location.

This project already *reads* these KMZ files (VSCode extension + standalone web
viewer, with a 3D map, waypoint table, and camera look-at rays). The next step is
to make it *edit and reproduce* them, so a proven scan can be **re-anchored onto
a new tank in seconds** instead of rebuilt by hand. That is the core automation
win.

## Goals

1. **Stamp & transform** (Phase 1 — done): open an existing mission, re-anchor its
   whole path to a new tank (translate + rotate), preview it, and export a
   **valid** new KMZ. Scale is designed-for but deferred.
2. **Select / move / copy** (Phase 2 — done): range/multi-select waypoints,
   duplicate or delete a segment, and move the selection (nudge by metres or
   click-to-place), keeping both files valid. (Freehand per-waypoint drag
   deferred to Phase 3.)
3. Preserve **full file fidelity** — the exported KMZ must import cleanly into
   FlightHub 2.

## Non-goals (for now)

- No new mission authoring from scratch (that's the sister Streamlit/QGIS tools).
- No scaling of geometry (Phase 3 candidate; see Risks).
- Extension write-back is Phase 3 (standalone first).

---

## Key technical findings (drive the whole design)

- **The `Waypoint` model is lossy** (`src/shared/parseKmz.ts`): keeps only
  `index/lon/lat/alt/camera`, discards all actions, mission config, and
  `waylines.wpml`. We therefore **cannot regenerate a KMZ from the model** — we
  **retain the raw `template.kml` + `waylines.wpml` text and mutate it in place.**
- **Two files stay in sync.** `waylines.wpml` re-enumerates every waypoint and is
  the executable twin of `template.kml`. Every edit is applied to **both**.
- **Coordinate-bearing fields** transformed on a move:
  - per-waypoint `Placemark/Point/<coordinates>` → **lon,lat**
  - `<wpml:takeOffRefPoint>` → **lat,lon,alt** (⚠ opposite order)
  - `<wpml:waypointPoiPoint>` (global + per-waypoint) → lon,lat,alt — **skipped
    when 0,0,0** (means "no POI"; must not be moved).
- **Heading fields rotated on rotation:** inside each `orientedShoot`,
  `<wpml:gimbalYawRotateAngle>` and `<wpml:aircraftHeading>` (absolute,
  north-referenced). `followWayline` headings auto-follow the path, so pure
  translation needs no heading changes, and per-waypoint `waypointHeadingAngle`
  is left alone (it is 0 under followWayline in these files).
- **Isometry insight:** translate + rotate preserve all segment lengths, so
  `wpml:distance` / `wpml:duration` are invariant in Phase 1 — no recompute
  needed. Only scale (Phase 3) or structural edits (Phase 2) change them.
- **Unique IDs to regenerate on duplicate (Phase 2):** `wpml:actionUUID`,
  `wpml:orientedFilePath`, the token in `wpml:orientedFileSuffix`; re-derive
  `wpml:index`, `actionGroupId`, `actionId`, `actionGroupStartIndex/EndIndex`.
- **Reuse:** `jszip` (read+write) both sides; `crypto.randomUUID()`;
  MapView local-meters math; `parseKmz.ts` block iteration; `App.tsx` selection.

---

## Architecture (implemented Phase 1)

Platform-agnostic engine under `src/shared/`, consumed by the standalone app;
zipping stays platform-specific.

- **`src/shared/kmzDoc.ts`** — `RawKmz` (retained archive: `templatePath`/
  `templateKml`, `waylinesPath`/`waylinesWpml`, `others[]` of raw bytes) and
  `kmzEntries(raw)` listing all entries for re-zipping intact. (Block model for
  structural edits arrives in Phase 2.)
- **`src/shared/transform.ts`** — `TransformParams` (anchor, newAnchor,
  rotationDeg, scale), `transformPoint` (equirectangular local meters, clockwise
  rotation, scale hook), `isIdentity`, `transformWaypoints` (preview: positions +
  rotate `camera.yaw`), and `transformRawKmz` (surgical text rewrite of all
  coordinate/heading fields in both files; identity is a no-op).
- **`src/webview/components/TransformPanel.tsx`** — map overlay: set new anchor
  (click map), rotation slider/number, scale (disabled), Reset, Export KMZ.
- **`src/webview/standalone.tsx`** — retains `RawKmz`; holds transform state;
  computes preview waypoints; `exportKmz()` = `transformRawKmz` → JSZip blob →
  browser download.
- **`src/webview/App.tsx` / `MapView.tsx`** — forward an optional `editing` API to
  MapView; MapView renders the panel, handles anchor-pick map clicks, shows a new-
  anchor marker, and rebuilds layers when the (preview) waypoints change.

### Phase 2 (implemented)
- **`src/shared/kmzDoc.ts`** — block model (`splitPlacemarks`/`joinPlacemarks`/
  `blockIndex`) that round-trips byte-identically and preserves indentation.
- **`src/shared/edits.ts`** — `deleteWaypoints`, `duplicateWaypoints`,
  `translateWaypoints` on both files: reindex `wpml:index` + action-group index
  refs, renumber `actionGroupId` for uniqueness, regenerate `actionUUID`/
  `orientedFilePath`/`orientedFileSuffix` token via a **shared old→new ID map so
  template and waylines stay consistent**, recompute `distance`/`duration`, and
  **clamp curve-turn `waypointTurnDampingDist`** to fit new adjacent segments
  (FlightHub rejects "turning distance too long" when an edit brings a
  `coordinateTurn` waypoint close to a neighbour; stop-mode waypoints are left
  alone since FlightHub tolerates their default damping).
- **Selection** lifted into `standalone.tsx` (controlled; `App.tsx` keeps an
  uncontrolled fallback for the extension viewer). `WaypointTable`/`MapView`
  support single / Shift-range / Ctrl-⌘-add; selected waypoints are highlighted
  and their camera rays shown. Panel (in `TransformPanel.tsx`) offers Duplicate,
  Delete, Move-to (click map) and N/S/E/W nudge by metres.
- Structural edits mutate the working `RawKmz`, re-parse waypoints, and reset the
  stamp transform; the Phase-1 stamp still overlays at export time.

### Phase 3 (implemented)
Selection transforms about the selection **centroid**, unified into one pending
model (`SelXform = {rotationDeg, scale, dLon, dLat}`) with live preview + Apply:
- **`transformSelection`** (`edits.ts`) rotates/scales the selected blocks about
  their centroid (pure translation delegates to the exact `translateWaypoints`),
  reusing `transformText` from `transform.ts`; rotates `orientedShoot` headings;
  syncs `takeOffRefPoint` when wp0 is in the selection; clamps turn-damping +
  recomputes distance.
- **`transformSelectedWaypoints`** (`transform.ts`) does the same for the live
  `Waypoint[]` preview.
- UI (`TransformPanel`): Select-all/Clear, Duplicate/Delete, **Rotate** slider,
  **Scale** slider, **Move center to…** (click map) + N/S/E/W nudge, Apply/Reset,
  Export. Freehand **drag** of selected waypoints via deck.gl drag callbacks
  (same pick pipeline as click-select) feeding the pending translate.
- **Safeguard**: `nearCoincidentWaypoints` flags adjacent waypoints < 0.1 m
  (e.g. a duplicate not yet moved); shown as a red banner before export.

Whole-path re-anchor ("stamp") is now just **Select all → Move/Rotate → Apply**.

**Box-select tool**: a marquee overlay (`MapView`) selects every waypoint whose
projected pixel falls inside a dragged rectangle (`onSelectMany`).

**Keyboard shortcuts** (standalone): `src/webview/shortcuts.ts` maps a normalized
key combo → action; bindings live in a separately-editable `web/keybindings.json`
(with `web/keybindings.schema.json` for editor validation), copied to `dist/web`
and **re-fetched every 2 s so edits hot-reload**. Defaults are gaming/editor-style
(WASD/arrows = nudge, Q/E = rotate, +/- = scale, Ctrl+D = duplicate, Del = delete,
Ctrl+A = select all, Esc = clear, Enter = apply, G = move, B = box select,
Ctrl+S = export, 3 = 3D, C = cameras, M = basemap). The panel lists the live
bindings. `apply` (Enter) and `clearSelection` (Esc) also fire while a slider or
number field is focused, so Enter commits right after adjusting a slider.

### Still pending
- **Extension write-back** (`CustomEditorProvider` + webview message passing +
  `showSaveDialog`) — editing remains standalone-only.
- Freehand drag verified by analogy to click-select (same deck event pipeline);
  worth a manual mouse confirmation.

---

## Roadmap — planned (NOT yet implemented)

Design sketches for upcoming work. Nothing below is built yet.

### 1. Undo/redo history stack
The working document is already a single immutable-ish value in `standalone.tsx`
(`data.raw: RawKmz` + `selection`), and every structural/transform edit swaps it
through one function (`applyEdit`). That makes undo cheap.

- Keep `past: Snapshot[]` and `future: Snapshot[]` where
  `Snapshot = { raw: RawKmz, selection: number[] }`. Snapshots are light — only
  the two WPML strings differ between edits; the `others[]` image bytes are shared
  by reference, so no copying of the ~40 MB `res/` payload.
- `applyEdit` pushes the previous snapshot onto `past` and clears `future`;
  **undo** pops `past` → current → `future`; **redo** the reverse. Cap depth
  (e.g. 50) to bound memory.
- Pending previews (`SelXform`) are *not* history entries — only committed edits
  are. Undo first discards any pending transform (`resetXform`), then steps state.
- Bindings: `Ctrl+Z` = undo, `Ctrl+Y` / `Ctrl+Shift+Z` = redo. **Conflict:**
  `Ctrl+Z` is currently `resetTransform` — rebind reset to the Reset button /
  `Esc`-adjacent key, or drop its default. Add Undo/Redo buttons + disabled states
  in `TransformPanel`.
- Touches: `standalone.tsx` only (state + two actions + bindings); no engine change.

### 2. Scale the camera location (altitude/standoff) for a group
Today `transformSelection` scale only scales horizontal position (lon/lat) about
the centroid; heights are untouched. Add an **opt-in "scale height too"** so the
whole camera geometry scales uniformly (bigger tank → orbit pushed out *and* up,
preserving gimbal pitch and roughly the GSD).

- Extend `SelXform` with a `scaleZ` (or a `scaleHeight: boolean` reusing `scale`).
- In `edits.ts`, when scaling, also rewrite the selected blocks' height tags about
  a reference height: `wpml:height` + `wpml:ellipsoidHeight` (template) and
  `wpml:executeHeight` (waylines). Reference = min height of the selection (scale
  standoff above the deck) — decide per UX.
- `transform.ts` preview must scale `Waypoint.alt` for the selected set too.
- Recompute `distance`/`duration` (already triggered) and re-run turn-damping
  clamp. Heights are `relativeToStartPoint`, so scaling is a pure multiply; no
  datum concerns. UI: a small "scale altitude with position" checkbox by the scale
  slider.

### 3. Shift to add / remove from a selection
Current modifiers: Shift = range, Ctrl/⌘ = add-toggle. Change so **Shift = add /
remove (toggle)** a waypoint on click, matching common 3D-tool convention.

- `handleSelect` in `standalone.tsx` (and the uncontrolled fallback in `App.tsx`):
  make `shift` the toggle modifier (add if absent, remove if present). Move
  range-select to `Ctrl/⌘+Shift+click` (anchor→click), or keep range on a separate
  gesture. Box-select already adds with Shift — keep consistent.
- Pure UI/state change; no engine impact. Update the panel hint text and README.

### 4. 3D model incorporation (context mesh)
Render the actual structure/site (tank, plant) as a 3D model so waypoints and
camera rays can be placed against real geometry, not just the basemap.

- Load a local **glTF/GLB** (drag-in) via deck.gl `ScenegraphLayer`
  (`@deck.gl/mesh-layers` + `@loaders.gl/gltf`), or an **OGC 3D Tiles** tileset via
  `Tile3DLayer` (`@deck.gl/geo-layers` + `@loaders.gl/3d-tiles`) for large scans.
- **Georeferencing is the hard part:** the model needs an anchor (lon/lat/alt),
  heading, and scale to sit correctly under the waypoints. Provide a small
  "place model" panel (reuse the click-anchor + rotation + scale UX) and persist
  the transform alongside the session (not in the KMZ).
- Render beneath the waypoint/flight-path layers in `MapView.buildLayers`. Watch
  performance (draw calls, memory) and depth vs. the 2.5-D waypoint markers.
- New deps + bundle-size increase; keep it lazy-loaded / behind a toggle.

### 5. Orthophoto overlay
Drape a georeferenced orthophoto over the map for alignment (place a scan on the
actual imagery of a new tank).

- Simplest: user provides an image + geographic bounds `[W,S,E,N]` → deck
  `BitmapLayer` under the waypoints. Better: read bounds from a **GeoTIFF** via
  `geotiff.js` (COG-friendly), or consume a pre-tiled **XYZ/TMS** set as a maplibre
  raster source (add to `makeStyle`).
- Add an opacity control and a toggle; render below flight-path, above basemap.
- Reprojection: assume the ortho is web-mercator/WGS84; warn otherwise. Large
  GeoTIFFs need tiling/downsampling — document the size ceiling.

### 6. Heightmap / DEM incorporation
Replace the current **flat-ground (z=0) assumption** for camera-ray ground targets
with real terrain, and enable true 3D ground.

- Two uses: (a) **visual** — enable maplibre-gl 3D terrain (`setTerrain` with a
  `raster-dem` / terrain-RGB source) so the scene has real relief; (b) **compute**
  — sample elevation at each waypoint lon/lat (from terrain-RGB tiles or a provided
  **GeoTIFF DEM** via `geotiff.js`) so `computeCameraTarget` intersects true ground
  and AGL/height validation is meaningful.
- Feeds the existing camera look-at feature (see "flat-ground assumption"
  limitation) and would let us flag waypoints below terrain or with wrong AGL.
- Source options: a hosted terrain-RGB tileset (needs network) or a local DEM file
  (offline). Keep the flat-ground path as fallback when no DEM is loaded.

**Cross-cutting note (items 4–6):** these are *context/georeferencing* layers, not
KMZ edits — none of them change the exported mission. They share one need: a
robust **georeference/place transform** (anchor lon/lat/alt + heading + scale),
which the existing click-anchor + rotate + scale UX can be generalized to provide.

## Verification

- **Identity round-trip:** transform 0° / same anchor, export → byte-identical
  entries → re-opens identically.
- **Translate:** re-anchor → path shifts, segment lengths unchanged.
- **Rotate:** rotate → path and camera rays rotate consistently (rays as oracle).
- **Integrity check:** index continuity, unique IDs, template↔waylines parity.
- **Preview MCP:** serve `dist/web`, drop a KMZ, set anchor, export, re-load blob.
- **Acceptance (user):** import an exported KMZ into FlightHub 2.

## Risks / open questions

- **Rotation of headings** — confirm a rotated export flies correctly in FlightHub 2.
- **`orientedFileSuffix` labels** on duplicate (keep label, regen token?) — Phase 2.
- **Scale + relative heights/gimbal** — Phase 3.
- **Extension writability** — larger lift, deferred.
