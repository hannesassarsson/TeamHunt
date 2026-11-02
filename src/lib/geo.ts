import area from "@turf/area";
import length from "@turf/length";
import bbox from "@turf/bbox";
import centroid from "@turf/centroid";
import distance from "@turf/distance";
import type { MapFeature, MapFeatureKind, HuntingArea, Camera, Observation } from "./types";

export const MAX_IMPORT_FEATURES = 2000;

export type Basemap = { id: string; label: string; tiles: string[]; attribution: string; maxzoom: number };

/**
 * Base layers. The defaults use free community tile services that are fine for development
 * and small teams; for production traffic configure your own provider via VITE_TILES_* env vars
 * (e.g. MapTiler or Lantmäteriet/Kartverket/MML national maps with an API key).
 */
export const BASEMAPS: Basemap[] = [
  {
    id: "standard",
    label: "Standard",
    tiles: [import.meta.env.VITE_TILES_STANDARD || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors",
    maxzoom: 19,
  },
  {
    id: "satellite",
    label: "Satellite",
    tiles: [import.meta.env.VITE_TILES_SATELLITE || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    maxzoom: 19,
  },
  {
    id: "terrain",
    label: "Terrain",
    tiles: [import.meta.env.VITE_TILES_TERRAIN || "https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors",
    maxzoom: 17,
  },
];

export const FEATURE_KINDS: Record<MapFeatureKind, { label: string; geometry: "Point" | "Line" | "Polygon"; color: string }> = {
  stand: { label: "Hunting stand", geometry: "Point", color: "#d9a55b" },
  feeding_station: { label: "Feeding station", geometry: "Point", color: "#8bc34a" },
  salt_lick: { label: "Salt lick", geometry: "Point", color: "#e0e0e0" },
  marker: { label: "Marker", geometry: "Point", color: "#e0715d" },
  parking: { label: "Parking", geometry: "Point", color: "#7fb0d4" },
  path: { label: "Path", geometry: "Line", color: "#f2c94c" },
  drag_route: { label: "Tracking / drag route", geometry: "Line", color: "#ff7a45" },
  zone: { label: "Zone", geometry: "Polygon", color: "#7fb3a0" },
};

export function kindsForGeometry(type: string): MapFeatureKind[] {
  const g = type.includes("Polygon") ? "Polygon" : type.includes("LineString") ? "Line" : "Point";
  return (Object.keys(FEATURE_KINDS) as MapFeatureKind[]).filter((k) => FEATURE_KINDS[k].geometry === g);
}

export function measure(geometry: GeoJSON.Geometry): { lengthM?: number; areaM2?: number } {
  const f = { type: "Feature" as const, geometry, properties: {} };
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") return { lengthM: length(f, { units: "kilometers" }) * 1000 };
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    return { areaM2: area(f), lengthM: length(f, { units: "kilometers" }) * 1000 };
  }
  return {};
}

export function distanceM(a: [number, number], b: [number, number]): number {
  return distance(a, b, { units: "kilometers" }) * 1000;
}

export function geometryCenter(g: GeoJSON.Geometry): [number, number] {
  if (g.type === "Point") return g.coordinates as [number, number];
  return centroid({ type: "Feature", geometry: g, properties: {} }).geometry.coordinates as [number, number];
}

export function boundsOf(fc: GeoJSON.FeatureCollection): [number, number, number, number] | null {
  if (!fc.features.length) return null;
  return bbox(fc) as [number, number, number, number];
}

const POSITION_OK = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

function positionsValid(coords: unknown, depth: number): boolean {
  if (depth === 0) return POSITION_OK(coords);
  return Array.isArray(coords) && coords.length > 0 && coords.every((c) => positionsValid(c, depth - 1));
}

const DEPTH: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };

/** Validate an arbitrary geometry is supported WGS84 GeoJSON. */
export function validateGeometry(g: unknown): g is GeoJSON.Geometry {
  if (!g || typeof g !== "object") return false;
  const t = (g as { type?: string }).type;
  if (!t || !(t in DEPTH) || t === "MultiPoint") return false;
  const coords = (g as { coordinates?: unknown }).coordinates;
  if (!positionsValid(coords, DEPTH[t])) return false;
  if (t === "LineString" && (coords as unknown[]).length < 2) return false;
  if (t === "Polygon" && (coords as unknown[][]).some((ring) => ring.length < 4)) return false;
  return true;
}

export interface ImportCandidate {
  name: string;
  kind: MapFeatureKind;
  geometry: GeoJSON.Geometry;
  notes: string | null;
  properties: Record<string, unknown>;
}

export interface ImportResult {
  candidates: ImportCandidate[];
  skipped: { index: number; reason: string }[];
}

const KIND_HINTS: [RegExp, MapFeatureKind][] = [
  [/torn|pass|stand|stol|hochsitz/i, "stand"],
  [/åtel|foder|feed|bait/i, "feeding_station"],
  [/salt/i, "salt_lick"],
  [/parker|parking/i, "parking"],
  [/drev|eftersök|drag|track/i, "drag_route"],
];

/** Parse user-supplied GeoJSON (FeatureCollection, Feature or bare Geometry) into importable features. */
export function parseGeoJsonImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const d = data as { type?: string; features?: unknown[]; crs?: { properties?: { name?: string } } };
  const crs = d.crs?.properties?.name;
  if (crs && !/4326|CRS84/i.test(crs)) throw new Error(`Unsupported coordinate system ${crs}. Export as WGS84 (EPSG:4326).`);
  const features: unknown[] =
    d.type === "FeatureCollection" ? d.features ?? [] : d.type === "Feature" ? [data] : [{ type: "Feature", geometry: data, properties: {} }];
  if (features.length > MAX_IMPORT_FEATURES) throw new Error(`Too many features (${features.length}). Maximum is ${MAX_IMPORT_FEATURES}.`);

  const result: ImportResult = { candidates: [], skipped: [] };
  features.forEach((raw, index) => {
    const f = raw as { geometry?: unknown; properties?: Record<string, unknown> | null };
    if (!validateGeometry(f?.geometry)) {
      result.skipped.push({ index, reason: "Unsupported or invalid geometry" });
      return;
    }
    const props = f.properties ?? {};
    const name = String(props.name ?? props.Name ?? props.title ?? props.namn ?? "").trim().slice(0, 80) || `Imported ${index + 1}`;
    const declared = props.kind as string | undefined;
    const allowed = kindsForGeometry(f.geometry.type);
    const hinted = KIND_HINTS.find(([re, k]) => re.test(name) && allowed.includes(k))?.[1];
    const fallback: MapFeatureKind = allowed.includes("marker") ? "marker" : allowed[0];
    const kind = declared && allowed.includes(declared as MapFeatureKind) ? (declared as MapFeatureKind) : hinted ?? fallback;
    const notes = typeof (props.notes ?? props.description) === "string" ? String(props.notes ?? props.description).slice(0, 2000) : null;
    const keep: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (["name", "Name", "title", "kind", "notes", "description"].includes(k)) continue;
      if (v == null || ["string", "number", "boolean"].includes(typeof v)) keep[k] = v;
    }
    result.candidates.push({ name, kind, geometry: f.geometry as GeoJSON.Geometry, notes, properties: keep });
  });
  return result;
}

/** Export everything the team has mapped as one FeatureCollection (WGS84). */
export function buildExport(input: { areas: HuntingArea[]; features: MapFeature[]; cameras: Camera[]; observations?: Observation[] }): GeoJSON.FeatureCollection {
  const fc: GeoJSON.Feature[] = [];
  for (const a of input.areas) fc.push({ type: "Feature", geometry: a.geometry, properties: { layer: "hunting_area", id: a.id, name: a.name, description: a.description, color: a.color } });
  for (const f of input.features) fc.push({ type: "Feature", geometry: f.geometry, properties: { ...f.properties, layer: "feature", id: f.id, kind: f.kind, name: f.name, notes: f.notes } });
  for (const c of input.cameras) if (c.lat != null && c.lon != null) fc.push({ type: "Feature", geometry: { type: "Point", coordinates: [c.lon, c.lat] }, properties: { layer: "camera", id: c.id, name: c.name, model: c.model } });
  for (const o of input.observations ?? []) if (o.lat != null && o.lon != null) fc.push({ type: "Feature", geometry: { type: "Point", coordinates: [o.lon, o.lat] }, properties: { layer: "observation", id: o.id, species: o.species_code, kind: o.kind, count: o.count, observed_at: o.observed_at } });
  return { type: "FeatureCollection", features: fc };
}
