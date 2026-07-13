#!/usr/bin/env node
/**
 * extract_tanks.ts
 * -----------------
 * Extract per-tank attributes from two workbooks and merge them into one
 * record per asset.
 *
 * 1) AttributeValues.xlsx  — "long"/attribute format: one row per
 *    (tank, attribute). Each value is stored in whichever type-column fits
 *    it: Text | Boolean | Decimal | Integer | Date | Option.
 *      -> Diameter, Height, Roof type
 *
 * 2) Organization.xlsx     — one row per asset. Column Y "Asset Title" is the
 *    join key, Z "Asset Longitude", AA "Asset Latitude".
 *      -> Geolocation (center point)
 *
 * Join: AttributeValues "Asset Name" (col B) == Organization "Asset Title" (col Y)
 *
 * For every tank this script pulls:
 *   1. Geolocation (center point) { latitude, longitude }  from Organization
 *   2. Diameter (metres)
 *   3. Height   (metres; source stores mm, so it is divided by 1000)
 *   4. Roof type (EFT / dome / cone)
 *
 * Usage:
 *   npm install xlsx
 *   npm install -D typescript ts-node @types/node
 *   npx ts-node extract_tanks.ts [AttributeValues.xlsx] [Organization.xlsx] [--csv]
 *   # or compile:  npx tsc extract_tanks.ts && node extract_tanks.js
 *
 * Output: JSON to stdout (or CSV with --csv), one record per tank.
 */

import * as XLSX from "xlsx";
import * as path from "path";

// --- Types -----------------------------------------------------------------
type Cell = string | number | boolean | null | undefined;
type Row = Record<string, Cell>;

interface GeoPoint {
  latitude: number | null;
  longitude: number | null;
}

interface TankRecord {
  tank: string;
  geolocation: GeoPoint | null;
  diameter: number | string | null;
  height: number | string | null;
  roofType: number | string | boolean | null;
}

type FieldName = "diameter" | "height" | "roofType";

// --- CLI args --------------------------------------------------------------
const rawArgs: string[] = process.argv.slice(2);
const args: string[] = rawArgs.filter((a) => !a.startsWith("--"));
const AS_CSV: boolean = process.argv.includes("--csv");
const ATTR_FILE: string = args[0] || "AttributeValues.xlsx";
const ORG_FILE: string = args[1] || "Organization.xlsx";

// --- AttributeValues column headers (row 1) --------------------------------
const COL = {
  tank: "Asset Name",
  chapter: "Asset Template Chapter",
  attribute: "Asset Attribute",
  text: "Asset Attribute Value Text",
  boolean: "Asset Attribute Value Boolean",
  decimal: "Asset Attribute Value Decimal",
  integer: "Asset Attribute Value Integer",
  date: "Asset Attribute Value Date",
  option: "Asset Attribute Option",
} as const;

// --- Organization column headers -------------------------------------------
const ORG = {
  asset: "Asset Title", // col Y  — join key
  longitude: "Asset Longitude", // col Z
  latitude: "Asset Latitude", // col AA
} as const;

// --- Attribute -> field mapping (case-insensitive, trailing "." ignored) ---
const FIELDS: Record<FieldName, { match: string[] }> = {
  diameter: { match: ["diameter"] },
  height: { match: ["height"] },
  roofType: { match: ["roof type"] },
};

// --- Helpers ---------------------------------------------------------------
const norm = (s: Cell): string =>
  String(s == null ? "" : s).trim().replace(/\.+$/, "").toLowerCase();

const isBlank = (x: Cell): boolean =>
  x === undefined || x === null || String(x).trim() === "";

function resolveValue(row: Row): Cell {
  if (!isBlank(row[COL.text])) return row[COL.text];
  if (!isBlank(row[COL.option])) return row[COL.option];
  const dec = Number(row[COL.decimal]);
  if (!Number.isNaN(dec) && dec !== 0) return dec;
  const int = Number(row[COL.integer]);
  if (!Number.isNaN(int) && int !== 0) return int;
  const b = row[COL.boolean];
  if (b === true || b === false || b === "true" || b === "false")
    return b === true || b === "true";
  if (!isBlank(row[COL.date])) return row[COL.date];
  return null;
}

function fieldFor(attrName: Cell): FieldName | null {
  const a = norm(attrName);
  for (const key of Object.keys(FIELDS) as FieldName[]) {
    if (FIELDS[key].match.some((m) => a === norm(m) || a.includes(norm(m))))
      return key;
  }
  return null;
}

function readSheet(file: string): Row[] {
  const wb = XLSX.readFile(path.resolve(file));
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], {
    defval: "",
  });
}

// --- 1) Attributes from AttributeValues.xlsx -------------------------------
const tanks = new Map<string, TankRecord>();
for (const row of readSheet(ATTR_FILE)) {
  const tank = row[COL.tank];
  if (isBlank(tank)) continue;
  const tankName = String(tank);

  if (!tanks.has(tankName)) {
    tanks.set(tankName, {
      tank: tankName,
      geolocation: null,
      diameter: null,
      height: null,
      roofType: null,
    });
  }
  const rec = tanks.get(tankName)!;

  const field = fieldFor(row[COL.attribute]);
  if (field && rec[field] == null) {
    let val = resolveValue(row);
    // Normalize to metres. Source stores diameter in metres but height in
    // millimetres, so height is divided by 1000.
    if (field === "height" && typeof val === "number") val = val / 1000;
    (rec as Record<FieldName, Cell>)[field] = val;
  }
}

// --- 2) Coordinates from Organization.xlsx (joined on tank name) -----------
const coords = new Map<string, GeoPoint>();
for (const row of readSheet(ORG_FILE)) {
  const key = row[ORG.asset];
  if (isBlank(key)) continue;
  const lat = Number(row[ORG.latitude]);
  const lon = Number(row[ORG.longitude]);
  coords.set(String(key).trim(), {
    latitude: Number.isNaN(lat) ? null : lat,
    longitude: Number.isNaN(lon) ? null : lon,
  });
}
for (const rec of tanks.values()) {
  const c = coords.get(rec.tank.trim());
  // Treat a 0/0 placeholder as "no coordinate".
  if (c && !(c.latitude === 0 && c.longitude === 0)) rec.geolocation = c;
}

const result: TankRecord[] = [...tanks.values()];

// --- Output ----------------------------------------------------------------
if (AS_CSV) {
  const headers = [
    "tank",
    "latitude",
    "longitude",
    "diameter",
    "height",
    "roofType",
  ] as const;
  const esc = (v: Cell): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  console.log(headers.join(","));
  for (const r of result) {
    const row: Record<(typeof headers)[number], Cell> = {
      tank: r.tank,
      latitude: r.geolocation ? r.geolocation.latitude : "",
      longitude: r.geolocation ? r.geolocation.longitude : "",
      diameter: r.diameter,
      height: r.height,
      roofType: r.roofType,
    };
    console.log(headers.map((h) => esc(row[h])).join(","));
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}