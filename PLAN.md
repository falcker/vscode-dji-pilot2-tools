# PLAN: Reusable flight-path editing & "stamp" for DJI FlightHub 2 missions

> Source of truth for the editing feature. Kept up to date as work lands.
> Status: **Phases 1 & 2 implemented** (standalone stamp/transform + select/move/copy).
> Phase 3 (extension write-back, scale, freehand drag) pending.

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
  template and waylines stay consistent**, recompute `distance`/`duration`.
- **Selection** lifted into `standalone.tsx` (controlled; `App.tsx` keeps an
  uncontrolled fallback for the extension viewer). `WaypointTable`/`MapView`
  support single / Shift-range / Ctrl-⌘-add; selected waypoints are highlighted
  and their camera rays shown. Panel (in `TransformPanel.tsx`) offers Duplicate,
  Delete, Move-to (click map) and N/S/E/W nudge by metres.
- Structural edits mutate the working `RawKmz`, re-parse waypoints, and reset the
  stamp transform; the Phase-1 stamp still overlays at export time.

### Phase 3 (optional / pending)
- **Freehand per-waypoint drag** (`@deck.gl/editable-layers@^9.2.11` or
  hand-rolled, coordinating with maplibre pan).
- **Uniform scale** about the anchor (with height/gimbal review).
- **Extension write-back** (`CustomEditorProvider` + webview message passing +
  `showSaveDialog`).

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
