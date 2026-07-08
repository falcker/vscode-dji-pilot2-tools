# PLAN: Reusable flight-path editing & "stamp" for DJI FlightHub 2 missions

> Source of truth for the editing feature. Kept up to date as work lands.
> Status: **Phase 1 implemented** (standalone stamp & transform). Phases 2–3 pending.

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
2. **Select / move / copy** (Phase 2): range-select waypoints, drag or nudge
   them, duplicate or delete a segment, and export — all on the same engine.
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

### Phase 2 (planned)
Selection-set refactor in `App.tsx`; multi-select in `WaypointTable.tsx`; freehand
drag in `MapView.tsx` (`@deck.gl/editable-layers@^9.2.11` or hand-rolled);
`src/shared/edits.ts` (duplicate/delete/move with ID regen + reindex + distance/
duration recompute in `src/shared/serializeKmz.ts`).

### Phase 3 (optional)
Extension write-back (`CustomEditorProvider` + message passing + `showSaveDialog`);
uniform scale with height/gimbal review.

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
