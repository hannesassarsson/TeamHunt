import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Crosshair, Download, Hexagon, Layers, MapPin, Pencil, Ruler, Search, Spline, Trash2, Undo2, Upload, X, Check, Camera as CameraIcon, Info,
} from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { useAreas, useCameras, useMapFeatures, useAction, cameraStatus } from "@/lib/hooks";
import { BASEMAPS, FEATURE_KINDS, buildExport, kindsForGeometry, measure, parseGeoJsonImport, boundsOf, type ImportResult } from "@/lib/geo";
import type { Camera, HuntingArea, MapFeature, MapFeatureKind, Observation, Harvest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { Segmented, Badge } from "@/components/ui/misc";
import { SpeciesName } from "@/components/species";
import { cn, downloadFile, fmt, getStored, setStored, startOfDayDaysAgo } from "@/lib/utils";
import { getSpecies } from "@shared/domain/species.ts";

type Mode = "select" | "point" | "line" | "polygon" | "measure" | "place-camera";
type LayerKey = "areas" | "zones" | "lines" | "points" | "cameras" | "observations" | "harvests";
type Selected =
  | { type: "area"; item: HuntingArea }
  | { type: "feature"; item: MapFeature }
  | { type: "camera"; item: Camera }
  | { type: "observation"; item: Observation }
  | { type: "harvest"; item: Harvest };

const LAYER_LABELS: Record<LayerKey, string> = {
  areas: "Hunting areas", zones: "Zones", lines: "Paths & routes", points: "Stands & markers", cameras: "Cameras", observations: "Observations", harvests: "Harvests",
};
const CATEGORY_COLOR: Record<string, string> = { ungulate: "#d9a55b", large_carnivore: "#e0715d", small_carnivore: "#b48ead", small_game: "#7fb0d4", bird: "#8bc34a", other: "#9aa5ae", non_animal: "#9aa5ae" };
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const DEFAULT_VIEW = { center: [15.5, 62.5] as [number, number], zoom: 4.3 };

function rasterStyle(basemapId: string): maplibregl.StyleSpecification {
  const b = BASEMAPS.find((x) => x.id === basemapId) ?? BASEMAPS[0];
  return {
    version: 8,
    sources: { base: { type: "raster", tiles: b.tiles, tileSize: 256, attribution: b.attribution, maxzoom: b.maxzoom } },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

export default function MapPage() {
  const { org, can } = useOrg();
  const { userId } = useAuth();
  const [params, setParams] = useSearchParams();
  const areas = useAreas();
  const features = useMapFeatures();
  const cameras = useCameras();
  const [obsDays, setObsDays] = useState<number>(() => getStored("nh-map-obs-days", 30));
  const observations = useQuery({
    queryKey: ["observations", org?.id, "map", obsDays],
    enabled: !!org,
    queryFn: async () => {
      let q = supabase.from("observations").select("*").eq("org_id", org!.id).not("lat", "is", null).order("observed_at", { ascending: false }).limit(2000);
      if (obsDays > 0) q = q.gte("observed_at", startOfDayDaysAgo(obsDays).toISOString());
      return unwrap(await q) as Observation[];
    },
  });
  const harvests = useQuery({
    queryKey: ["harvests", org?.id, "map", obsDays],
    enabled: !!org,
    queryFn: async () => {
      let q = supabase.from("harvests").select("*").eq("org_id", org!.id).not("lat", "is", null).limit(1000);
      if (obsDays > 0) q = q.gte("harvested_at", startOfDayDaysAgo(obsDays).toISOString());
      return unwrap(await q) as Harvest[];
    },
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<string>(() => getStored("nh-basemap", "satellite"));
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>(() => getStored("nh-layers", { areas: true, zones: true, lines: true, points: true, cameras: true, observations: true, harvests: true }));
  const [panel, setPanel] = useState<"layers" | "search" | null>(null);
  const [mode, setMode] = useState<Mode>("select");
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const fitted = useRef(false);
  const placeCameraId = params.get("placeCamera");

  // ------------------------------------------------------------------ data -> GeoJSON
  const data = useMemo(() => {
    const fs = features.data ?? [];
    const toF = (f: MapFeature): GeoJSON.Feature => ({ type: "Feature", id: undefined, geometry: f.geometry, properties: { id: f.id, kind: f.kind, name: f.name, color: FEATURE_KINDS[f.kind].color } });
    return {
      areas: { type: "FeatureCollection", features: (areas.data ?? []).map((a) => ({ type: "Feature", geometry: a.geometry, properties: { id: a.id, name: a.name, color: a.color } })) } as GeoJSON.FeatureCollection,
      zones: { type: "FeatureCollection", features: fs.filter((f) => f.kind === "zone").map(toF) } as GeoJSON.FeatureCollection,
      lines: { type: "FeatureCollection", features: fs.filter((f) => f.kind === "path" || f.kind === "drag_route").map(toF) } as GeoJSON.FeatureCollection,
      points: { type: "FeatureCollection", features: fs.filter((f) => f.geometry.type === "Point").map(toF) } as GeoJSON.FeatureCollection,
      cameras: {
        type: "FeatureCollection",
        features: (cameras.data ?? []).filter((c) => c.lat != null && c.lon != null).map((c) => ({
          type: "Feature", geometry: { type: "Point", coordinates: [c.lon!, c.lat!] },
          properties: { id: c.id, name: c.name, status: cameraStatus(c) },
        })),
      } as GeoJSON.FeatureCollection,
      observations: {
        type: "FeatureCollection",
        features: (observations.data ?? []).map((o) => ({
          type: "Feature", geometry: { type: "Point", coordinates: [o.lon!, o.lat!] },
          properties: { id: o.id, color: CATEGORY_COLOR[getSpecies(o.species_code)?.category ?? "other"] },
        })),
      } as GeoJSON.FeatureCollection,
      harvests: {
        type: "FeatureCollection",
        features: (harvests.data ?? []).map((h) => ({ type: "Feature", geometry: { type: "Point", coordinates: [h.lon!, h.lat!] }, properties: { id: h.id } })),
      } as GeoJSON.FeatureCollection,
    };
  }, [areas.data, features.data, cameras.data, observations.data, harvests.data]);

  const draftGeometry = useMemo((): GeoJSON.Geometry | null => {
    if (!draft.length) return null;
    const geomType = mode === "measure" ? (draft.length > 2 ? "line" : "line") : mode;
    if (geomType === "point") return { type: "Point", coordinates: draft[0] };
    if (geomType === "polygon" && draft.length >= 3) return { type: "Polygon", coordinates: [[...draft, draft[0]]] };
    if (draft.length >= 2) return { type: "LineString", coordinates: draft };
    return { type: "Point", coordinates: draft[0] };
  }, [draft, mode]);

  // ------------------------------------------------------------------ map init
  useEffect(() => {
    if (!containerRef.current) return;
    const saved = getStored<{ center: [number, number]; zoom: number } | null>("nh-map-view", null);
    const map = new maplibregl.Map({ container: containerRef.current, style: rasterStyle(basemap), center: saved?.center ?? DEFAULT_VIEW.center, zoom: saved?.zoom ?? DEFAULT_VIEW.zoom, attributionControl: { compact: true } });
    if (saved) fitted.current = true;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("moveend", () => setStored("nh-map-view", { center: map.getCenter().toArray(), zoom: map.getZoom() }));
    map.on("mousemove", (e) => setCursor([e.lngLat.lng, e.lngLat.lat]));
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; setReady(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installLayers = useCallback((map: maplibregl.Map) => {
    const add = (id: string, fc: GeoJSON.FeatureCollection) => { if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: fc }); };
    add("areas", EMPTY_FC); add("zones", EMPTY_FC); add("lines", EMPTY_FC); add("points", EMPTY_FC);
    add("cameras", EMPTY_FC); add("observations", EMPTY_FC); add("harvests", EMPTY_FC); add("draft", EMPTY_FC);
    const layer = (l: maplibregl.LayerSpecification) => { if (!map.getLayer(l.id)) map.addLayer(l); };
    layer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 } });
    layer({ id: "areas-line", type: "line", source: "areas", paint: { "line-color": ["get", "color"], "line-width": 2.5 } });
    layer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 } });
    layer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-dasharray": [2, 1] } });
    layer({ id: "lines-line", type: "line", source: "lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-dasharray": ["match", ["get", "kind"], "drag_route", ["literal", [1, 1.5]], ["literal", [1, 0]]] } });
    layer({ id: "observations-circle", type: "circle", source: "observations", paint: { "circle-radius": 5, "circle-color": ["get", "color"], "circle-stroke-color": "#0d1311", "circle-stroke-width": 1, "circle-opacity": 0.9 } });
    layer({ id: "harvests-circle", type: "circle", source: "harvests", paint: { "circle-radius": 7, "circle-color": "#b4412f", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    layer({ id: "points-circle", type: "circle", source: "points", paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#0d1311", "circle-stroke-width": 2 } });
    layer({ id: "cameras-circle", type: "circle", source: "cameras", paint: { "circle-radius": 8, "circle-color": "#0d1311", "circle-stroke-width": 3, "circle-stroke-color": ["match", ["get", "status"], "online", "#6cc08f", "offline", "#e0715d", "#9aa5ae"] } });
    layer({ id: "draft-fill", type: "fill", source: "draft", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#d9a55b", "fill-opacity": 0.2 } });
    layer({ id: "draft-line", type: "line", source: "draft", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#d9a55b", "line-width": 2.5, "line-dasharray": [2, 1] } });
    layer({ id: "draft-vertex", type: "circle", source: "draft", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#d9a55b", "circle-stroke-width": 2 } });
  }, []);

  // Basemap switch: replace style, then re-add overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setStored("nh-basemap", basemap);
    map.setStyle(rasterStyle(basemap));
    map.once("styledata", () => { installLayers(map); setTick((t) => t + 1); });
  }, [basemap, ready, installLayers]);
  const [tick, setTick] = useState(0);

  useEffect(() => { const map = mapRef.current; if (map && ready) { installLayers(map); setTick((t) => t + 1); } }, [ready, installLayers]);

  // Push data into sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [id, fc] of Object.entries(data)) (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
    const vertices: GeoJSON.Feature[] = draft.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
    const draftFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [...(draftGeometry && draftGeometry.type !== "Point" ? [{ type: "Feature" as const, geometry: draftGeometry, properties: {} }] : []), ...vertices] };
    (map.getSource("draft") as GeoJSONSource | undefined)?.setData(draftFc);
  }, [data, draft, draftGeometry, ready, tick]);

  // Visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setStored("nh-layers", visible);
    const groups: Record<LayerKey, string[]> = {
      areas: ["areas-fill", "areas-line"], zones: ["zones-fill", "zones-line"], lines: ["lines-line"], points: ["points-circle"],
      cameras: ["cameras-circle"], observations: ["observations-circle"], harvests: ["harvests-circle"],
    };
    for (const [k, ids] of Object.entries(groups)) for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible[k as LayerKey] ? "visible" : "none");
  }, [visible, ready, tick]);

  // Fit to data once.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fitted.current || areas.isLoading || features.isLoading || cameras.isLoading) return;
    const all: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [...data.areas.features, ...data.points.features, ...data.cameras.features, ...data.lines.features] };
    const b = boundsOf(all);
    if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 15, duration: 0 });
    fitted.current = true;
  }, [ready, data, areas.isLoading, features.isLoading, cameras.isLoading]);

  useEffect(() => {
    if (placeCameraId) { setMode("place-camera"); setSelected(null); }
  }, [placeCameraId]);

  // ------------------------------------------------------------------ interactions
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lookups = useRef({ areas: areas.data, features: features.data, cameras: cameras.data, observations: observations.data, harvests: harvests.data });
  lookups.current = { areas: areas.data, features: features.data, cameras: cameras.data, observations: observations.data, harvests: harvests.data };

  const placeCamera = useAction(async (p: { id: string; lngLat: [number, number] }) =>
    unwrap(await supabase.from("cameras").update({ lon: p.lngLat[0], lat: p.lngLat[1] }).eq("id", p.id).select().single()),
  { success: "Camera location saved", invalidate: [["cameras"]], onSuccess: () => { setMode("select"); setParams({}); } });

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: MapMouseEvent) => {
      const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const m = modeRef.current;
      if (m === "place-camera") { if (placeCameraId) placeCamera.mutate({ id: placeCameraId, lngLat: p }); return; }
      if (m === "point") { setDraft([p]); setSaveOpen(true); return; }
      if (m === "line" || m === "polygon" || m === "measure") { setDraft((d) => [...d, p]); return; }
      const hits = map.queryRenderedFeatures(e.point, { layers: ["cameras-circle", "points-circle", "harvests-circle", "observations-circle", "lines-line", "zones-fill", "areas-fill"].filter((l) => map.getLayer(l)) });
      const hit = hits[0];
      if (!hit) { setSelected(null); return; }
      const id = hit.properties?.id as string;
      const L = lookups.current;
      const src = hit.source;
      if (src === "cameras") { const c = L.cameras?.find((x) => x.id === id); if (c) setSelected({ type: "camera", item: c }); }
      else if (src === "observations") { const o = L.observations?.find((x) => x.id === id); if (o) setSelected({ type: "observation", item: o }); }
      else if (src === "harvests") { const h = L.harvests?.find((x) => x.id === id); if (h) setSelected({ type: "harvest", item: h }); }
      else if (src === "areas") { const a = L.areas?.find((x) => x.id === id); if (a) setSelected({ type: "area", item: a }); }
      else { const f = L.features?.find((x) => x.id === id); if (f) setSelected({ type: "feature", item: f }); }
    };
    const onDbl = (e: MapMouseEvent) => {
      const m = modeRef.current;
      if (m === "line" || m === "polygon") { e.preventDefault(); setSaveOpen(true); }
    };
    const setPointer = () => { map.getCanvas().style.cursor = modeRef.current === "select" ? "pointer" : "crosshair"; };
    const clearPointer = () => { map.getCanvas().style.cursor = modeRef.current === "select" ? "" : "crosshair"; };
    const interactive = ["cameras-circle", "points-circle", "harvests-circle", "observations-circle", "lines-line", "zones-fill", "areas-fill"];
    map.on("click", onClick);
    map.on("dblclick", onDbl);
    for (const l of interactive) { map.on("mouseenter", l, setPointer); map.on("mouseleave", l, clearPointer); }
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDbl);
      for (const l of interactive) { map.off("mouseenter", l, setPointer); map.off("mouseleave", l, clearPointer); }
    };
  }, [ready, placeCameraId, placeCamera]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "select") { map.doubleClickZoom.enable(); map.getCanvas().style.cursor = ""; }
    else { map.doubleClickZoom.disable(); map.getCanvas().style.cursor = "crosshair"; }
    if (mode !== "select") setSelected(null);
  }, [mode]);

  const startMode = (m: Mode) => { setDraft([]); setMode((cur) => (cur === m ? "select" : m)); };
  const cancelDraw = () => { setDraft([]); setMode("select"); if (placeCameraId) setParams({}); };
  const flyTo = (g: GeoJSON.Geometry) => {
    const map = mapRef.current;
    if (!map) return;
    if (g.type === "Point") map.flyTo({ center: g.coordinates as [number, number], zoom: Math.max(map.getZoom(), 15) });
    else { const b = boundsOf({ type: "FeatureCollection", features: [{ type: "Feature", geometry: g, properties: {} }] }); if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 16 }); }
  };

  const liveMeasure = draftGeometry && draftGeometry.type !== "Point" ? measure(draftGeometry) : null;
  const canDraw = can("member");

  // ------------------------------------------------------------------ import/export
  const fileRef = useRef<HTMLInputElement>(null);
  const onImportFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) return toast.error("File is larger than 10 MB");
    try { setImportResult(parseGeoJsonImport(await file.text())); }
    catch (e) { toast.error((e as Error).message); }
  };
  const exportAll = () => {
    const fc = buildExport({ areas: areas.data ?? [], features: features.data ?? [], cameras: cameras.data ?? [], observations: observations.data ?? [] });
    downloadFile(`nordhunt-${org?.name.replace(/\W+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify(fc, null, 2), "application/geo+json");
  };

  return (
    <div className="relative h-full min-h-[480px]">
      <div className="absolute inset-0">
        {/* maplibre sets position:relative on its container, so it needs an explicit size */}
        <div ref={containerRef} className="h-full w-full" aria-label="Map" role="region" />
      </div>

      {/* Toolbar */}
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-64px)] flex-wrap gap-1.5">
        <div className="flex rounded-xl border border-border bg-surface/95 p-1 shadow-lg backdrop-blur">
          <ToolButton active={panel === "layers"} onClick={() => setPanel(panel === "layers" ? null : "layers")} label="Layers"><Layers /></ToolButton>
          <ToolButton active={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")} label="Search"><Search /></ToolButton>
          <ToolButton active={mode === "measure"} onClick={() => startMode("measure")} label="Measure"><Ruler /></ToolButton>
        </div>
        {canDraw && (
          <div className="flex rounded-xl border border-border bg-surface/95 p-1 shadow-lg backdrop-blur">
            <ToolButton active={mode === "point"} onClick={() => startMode("point")} label="Add point (stand, feeding station, marker)"><MapPin /></ToolButton>
            <ToolButton active={mode === "line"} onClick={() => startMode("line")} label="Draw path"><Spline /></ToolButton>
            <ToolButton active={mode === "polygon"} onClick={() => startMode("polygon")} label="Draw area or zone"><Hexagon /></ToolButton>
          </div>
        )}
        <div className="flex rounded-xl border border-border bg-surface/95 p-1 shadow-lg backdrop-blur">
          {canDraw && <ToolButton onClick={() => fileRef.current?.click()} label="Import GeoJSON"><Upload /></ToolButton>}
          <ToolButton onClick={exportAll} label="Export GeoJSON"><Download /></ToolButton>
        </div>
        <input ref={fileRef} type="file" accept=".geojson,.json,application/geo+json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); e.target.value = ""; }} />
      </div>

      {/* Draw status */}
      {mode !== "select" && (
        <div className="absolute inset-x-3 bottom-8 z-10 mx-auto flex max-w-lg flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/95 px-3 py-2 text-sm shadow-xl backdrop-blur sm:bottom-10">
          <Pencil className="size-4 text-accent" />
          <span className="flex-1">
            {mode === "place-camera" ? "Click the map where the camera is mounted" :
              mode === "point" ? "Click the map to place a point" :
              mode === "measure" ? (draft.length < 2 ? "Click to measure distance" : `Distance ${fmt.distance(liveMeasure?.lengthM ?? 0)}`) :
              draft.length === 0 ? `Click to start the ${mode === "line" ? "path" : "area"}` :
              mode === "polygon" && liveMeasure?.areaM2 ? `${fmt.area(liveMeasure.areaM2)} · perimeter ${fmt.distance(liveMeasure.lengthM ?? 0)}` :
              liveMeasure?.lengthM ? `${fmt.distance(liveMeasure.lengthM)} · double-click to finish` : "Keep clicking to add points"}
          </span>
          {draft.length > 0 && mode !== "point" && <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d.slice(0, -1))}><Undo2 /> Undo</Button>}
          {(mode === "line" && draft.length >= 2) || (mode === "polygon" && draft.length >= 3) ? <Button size="sm" onClick={() => setSaveOpen(true)}><Check /> Finish</Button> : null}
          <Button size="sm" variant="outline" onClick={cancelDraw}><X /> {mode === "measure" ? "Close" : "Cancel"}</Button>
        </div>
      )}

      {cursor && <div className="pointer-events-none absolute bottom-1 right-24 z-10 hidden rounded bg-surface/80 px-1.5 py-0.5 text-[10px] text-muted tabular sm:block">{fmt.coord(cursor[1], cursor[0])}</div>}

      {/* Panels */}
      {panel === "layers" && (
        <FloatingPanel title="Layers" onClose={() => setPanel(null)}>
          <Segmented value={basemap} onChange={setBasemap} options={BASEMAPS.map((b) => ({ value: b.id, label: b.label }))} className="mb-4 w-full [&>button]:flex-1" />
          <div className="space-y-2">
            {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
              <Checkbox key={k} label={<span className="flex-1">{LAYER_LABELS[k]} <span className="text-xs text-muted tabular">{data[k].features.length}</span></span>} checked={visible[k]} onChange={(e) => setVisible({ ...visible, [k]: e.target.checked })} />
            ))}
          </div>
          <Field label="Observations & harvests from" className="mt-4">
            <Select value={obsDays} onChange={(e) => { const v = Number(e.target.value); setObsDays(v); setStored("nh-map-obs-days", v); }}>
              <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option><option value={365}>Last 12 months</option><option value={0}>All time</option>
            </Select>
          </Field>
          <p className="mt-4 flex gap-1.5 text-[11px] leading-snug text-muted"><Info className="mt-0.5 size-3.5 shrink-0" />Drawn areas are your team's own planning boundaries. They are not property boundaries and do not imply hunting rights.</p>
        </FloatingPanel>
      )}
      {panel === "search" && <SearchPanel onClose={() => setPanel(null)} areas={areas.data ?? []} features={features.data ?? []} cameras={cameras.data ?? []}
        onPick={(g, sel) => { flyTo(g); setSelected(sel); }} />}

      {selected && <SelectionPanel selected={selected} onClose={() => setSelected(null)} canEditAll={can("admin")} userId={userId} onFly={flyTo} />}

      <SaveDrawingDialog open={saveOpen} onOpenChange={(v) => { setSaveOpen(v); if (!v && mode === "point") setDraft([]); }} geometry={draftGeometry} areas={areas.data ?? []} canCreateArea={can("admin")}
        onSaved={() => { setDraft([]); setMode("select"); setSaveOpen(false); }} />
      <ImportDialog result={importResult} onClose={() => setImportResult(null)} canCreateArea={can("admin")} onDone={(fc) => { setImportResult(null); const b = boundsOf(fc); if (b) mapRef.current?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 15 }); }} />
    </div>
  );
}

function ToolButton({ active, onClick, label, children }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={active}
      className={cn("grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text [&_svg]:size-[18px]", active && "bg-primary text-primary-fg hover:bg-primary hover:text-primary-fg")}>
      {children}
    </button>
  );
}

function FloatingPanel({ title, onClose, children, className }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("absolute inset-x-3 bottom-3 z-20 max-h-[60%] overflow-y-auto rounded-2xl border border-border bg-surface/97 p-4 shadow-2xl backdrop-blur animate-slide-up sm:inset-x-auto sm:bottom-auto sm:left-3 sm:top-16 sm:w-80 sm:max-h-[calc(100%-5rem)]", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display font-semibold">{title}</h2>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2" aria-label="Close"><X className="size-4" /></button>
      </div>
      {children}
    </div>
  );
}

function SearchPanel({ onClose, areas, features, cameras, onPick }: { onClose: () => void; areas: HuntingArea[]; features: MapFeature[]; cameras: Camera[]; onPick: (g: GeoJSON.Geometry, s: Selected) => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("");
  const needle = q.trim().toLowerCase();
  const results = [
    ...areas.map((a) => ({ key: a.id, label: a.name, sub: "Hunting area", g: a.geometry as GeoJSON.Geometry, sel: { type: "area", item: a } as Selected, k: "area" })),
    ...features.map((f) => ({ key: f.id, label: f.name, sub: FEATURE_KINDS[f.kind].label, g: f.geometry, sel: { type: "feature", item: f } as Selected, k: f.kind })),
    ...cameras.filter((c) => c.lat != null).map((c) => ({ key: c.id, label: c.name, sub: "Camera", g: { type: "Point", coordinates: [c.lon!, c.lat!] } as GeoJSON.Geometry, sel: { type: "camera", item: c } as Selected, k: "camera" })),
  ].filter((r) => (!needle || r.label.toLowerCase().includes(needle)) && (!kind || r.k === kind)).slice(0, 100);
  return (
    <FloatingPanel title="Find on map" onClose={onClose}>
      <Input autoFocus placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Select className="mt-2" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">All types</option><option value="area">Hunting areas</option><option value="camera">Cameras</option>
        {Object.entries(FEATURE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </Select>
      <ul className="mt-3 divide-y divide-border">
        {results.map((r) => (
          <li key={r.key}><button className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-primary" onClick={() => onPick(r.g, r.sel)}>
            <span className="truncate font-medium">{r.label}</span><span className="shrink-0 text-xs text-muted">{r.sub}</span>
          </button></li>
        ))}
        {!results.length && <li className="py-6 text-center text-sm text-muted">No matches</li>}
      </ul>
    </FloatingPanel>
  );
}

function SelectionPanel({ selected, onClose, canEditAll, userId, onFly }: { selected: Selected; onClose: () => void; canEditAll: boolean; userId: string | null; onFly: (g: GeoJSON.Geometry) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState<MapFeatureKind>("marker");
  useEffect(() => {
    setEditing(false);
    if (selected.type === "feature") { setName(selected.item.name); setNotes(selected.item.notes ?? ""); setKind(selected.item.kind); }
    if (selected.type === "area") { setName(selected.item.name); setNotes(selected.item.description ?? ""); }
  }, [selected]);

  const update = useAction(async () => {
    if (selected.type === "feature") return unwrap(await supabase.from("map_features").update({ name: name.trim(), notes: notes.trim() || null, kind }).eq("id", selected.item.id).select().single());
    if (selected.type === "area") return unwrap(await supabase.from("hunting_areas").update({ name: name.trim(), description: notes.trim() || null }).eq("id", selected.item.id).select().single());
  }, { success: "Saved", invalidate: [["map_features"], ["areas"]], onSuccess: () => { setEditing(false); onClose(); } });
  const remove = useAction(async () => {
    const table = selected.type === "feature" ? "map_features" : "hunting_areas";
    unwrap(await supabase.from(table).delete().eq("id", selected.item.id).select());
  }, { success: "Deleted", invalidate: [["map_features"], ["areas"]], onSuccess: onClose });

  let title: React.ReactNode = "";
  let body: React.ReactNode = null;
  let geometry: GeoJSON.Geometry | null = null;
  let editable = false;
  if (selected.type === "feature" || selected.type === "area") {
    const isArea = selected.type === "area";
    const item = selected.item;
    geometry = item.geometry;
    editable = isArea ? canEditAll : canEditAll || (selected.type === "feature" && selected.item.created_by === userId);
    const m = measure(item.geometry);
    title = item.name;
    body = (
      <div className="space-y-2 text-sm">
        <Badge tone="primary">{isArea ? "Hunting area" : FEATURE_KINDS[(item as MapFeature).kind].label}</Badge>
        {m.areaM2 != null && <div className="flex justify-between"><span className="text-muted">Area</span><span className="tabular">{fmt.area(m.areaM2)}</span></div>}
        {m.lengthM != null && <div className="flex justify-between"><span className="text-muted">{m.areaM2 != null ? "Perimeter" : "Length"}</span><span className="tabular">{fmt.distance(m.lengthM)}</span></div>}
        {item.geometry.type === "Point" && <div className="flex justify-between"><span className="text-muted">Position</span><span className="tabular">{fmt.coord((item.geometry.coordinates as number[])[1], (item.geometry.coordinates as number[])[0])}</span></div>}
        {(isArea ? (item as HuntingArea).description : (item as MapFeature).notes) && <p className="whitespace-pre-line text-muted">{isArea ? (item as HuntingArea).description : (item as MapFeature).notes}</p>}
        <div className="text-xs text-muted">Added {fmt.date(item.created_at)}</div>
      </div>
    );
  } else if (selected.type === "camera") {
    const c = selected.item;
    geometry = { type: "Point", coordinates: [c.lon!, c.lat!] };
    const st = cameraStatus(c);
    title = c.name;
    body = (
      <div className="space-y-2 text-sm">
        <Badge tone={st === "online" ? "success" : st === "offline" ? "danger" : "neutral"}>{st}</Badge>
        <div className="flex justify-between"><span className="text-muted">Last image</span><span>{fmt.ago(c.last_seen_at)}</span></div>
        {c.last_battery_pct != null && <div className="flex justify-between"><span className="text-muted">Battery</span><span>{c.last_battery_pct}%</span></div>}
        <Link to={`/cameras/${c.id}`} className="inline-flex items-center gap-1 font-medium text-primary"><CameraIcon className="size-4" /> Open camera</Link>
      </div>
    );
  } else if (selected.type === "observation") {
    const o = selected.item;
    geometry = { type: "Point", coordinates: [o.lon!, o.lat!] };
    title = <SpeciesName code={o.species_code} />;
    body = (
      <div className="space-y-2 text-sm">
        <Badge tone="accent">{o.kind}</Badge>
        <div className="flex justify-between"><span className="text-muted">When</span><span>{fmt.dateTime(o.observed_at)}</span></div>
        {o.count != null && <div className="flex justify-between"><span className="text-muted">Count</span><span>{o.count}</span></div>}
        {o.accuracy_m != null && <div className="flex justify-between"><span className="text-muted">GPS accuracy</span><span>±{Math.round(o.accuracy_m)} m</span></div>}
        {o.notes && <p className="whitespace-pre-line text-muted">{o.notes}</p>}
      </div>
    );
  } else {
    const h = selected.item;
    geometry = { type: "Point", coordinates: [h.lon!, h.lat!] };
    title = <><SpeciesName code={h.species_code} /> · harvest</>;
    body = (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted">When</span><span>{fmt.dateTime(h.harvested_at)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Sex / age</span><span className="capitalize">{h.sex} · {h.age_class}</span></div>
        {h.weight_kg != null && <div className="flex justify-between"><span className="text-muted">Weight</span><span>{h.weight_kg} kg</span></div>}
        {h.session_id && <Link to={`/journal/${h.session_id}`} className="font-medium text-primary">Open hunt session</Link>}
      </div>
    );
  }

  return (
    <FloatingPanel title={title} onClose={onClose} className="sm:left-auto sm:right-14 sm:top-3">
      {editing ? (
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          {selected.type === "feature" && kindsForGeometry(selected.item.geometry.type).length > 1 && (
            <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value as MapFeatureKind)}>
              {kindsForGeometry(selected.item.geometry.type).map((k) => <option key={k} value={k}>{FEATURE_KINDS[k].label}</option>)}
            </Select></Field>
          )}
          <Field label={selected.type === "area" ? "Description" : "Notes"}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button onClick={() => update.mutate()} loading={update.isPending} disabled={!name.trim()}>Save</Button></div>
        </div>
      ) : (
        <>
          {body}
          <div className="mt-4 flex flex-wrap gap-2">
            {geometry && <Button size="sm" variant="outline" onClick={() => onFly(geometry!)}><Crosshair /> Zoom to</Button>}
            {editable && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
            {editable && <Button size="sm" variant="ghost" className="text-danger" loading={remove.isPending} onClick={() => { if (confirm("Delete this item from the map?")) remove.mutate(); }}><Trash2 /> Delete</Button>}
          </div>
        </>
      )}
    </FloatingPanel>
  );
}

function SaveDrawingDialog({ open, onOpenChange, geometry, areas, canCreateArea, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; geometry: GeoJSON.Geometry | null; areas: HuntingArea[]; canCreateArea: boolean; onSaved: () => void;
}) {
  const { org } = useOrg();
  const allowed = geometry ? kindsForGeometry(geometry.type) : [];
  const [target, setTarget] = useState<"feature" | "area">("feature");
  const [kind, setKind] = useState<MapFeatureKind>("stand");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [areaId, setAreaId] = useState("");
  const [color, setColor] = useState("#c08a3e");
  useEffect(() => {
    if (open && geometry) {
      const k = kindsForGeometry(geometry.type);
      setKind(k[0]); setName(""); setNotes(""); setAreaId("");
      setTarget(geometry.type === "Polygon" && canCreateArea && areas.length === 0 ? "area" : "feature");
    }
  }, [open, geometry, canCreateArea, areas.length]);
  const m = geometry ? measure(geometry) : {};
  const save = useAction(async () => {
    if (!geometry || !org) return;
    if (target === "area") {
      return unwrap(await supabase.from("hunting_areas").insert({ org_id: org.id, name: name.trim(), description: notes.trim() || null, geometry, area_m2: m.areaM2 ?? null, color }).select().single());
    }
    return unwrap(await supabase.from("map_features").insert({ org_id: org.id, kind, name: name.trim(), notes: notes.trim() || null, geometry, area_id: areaId || null }).select().single());
  }, { success: "Saved to map", invalidate: [["map_features"], ["areas"]], onSuccess: onSaved });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Save to map" description={m.areaM2 ? `${fmt.area(m.areaM2)}` : m.lengthM ? fmt.distance(m.lengthM) : geometry?.type === "Point" ? fmt.coord((geometry.coordinates as number[])[1], (geometry.coordinates as number[])[0]) : undefined}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>Save</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
        {geometry?.type === "Polygon" && canCreateArea && (
          <Segmented value={target} onChange={setTarget} options={[{ value: "feature", label: "Zone" }, { value: "area", label: "Hunting area" }]} />
        )}
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder={target === "area" ? "e.g. Norra skiftet" : "e.g. Torn 4"} /></Field>
        {target === "feature" && allowed.length > 1 && (
          <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value as MapFeatureKind)}>{allowed.map((k) => <option key={k} value={k}>{FEATURE_KINDS[k].label}</option>)}</Select></Field>
        )}
        {target === "feature" && areas.length > 0 && (
          <Field label="Hunting area"><Select value={areaId} onChange={(e) => setAreaId(e.target.value)}><option value="">None</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        )}
        {target === "area" && <Field label="Colour"><Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-20 p-1" /></Field>}
        <Field label={target === "area" ? "Description" : "Notes"}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
        {target === "area" && <p className="text-xs text-muted">A hunting area is your team's planning boundary. It is not a property boundary and does not grant hunting rights.</p>}
      </form>
    </Dialog>
  );
}

function ImportDialog({ result, onClose, canCreateArea, onDone }: { result: ImportResult | null; onClose: () => void; canCreateArea: boolean; onDone: (fc: GeoJSON.FeatureCollection) => void }) {
  const { org } = useOrg();
  const [polygonsAsAreas, setPolygonsAsAreas] = useState(false);
  const run = useAction(async () => {
    if (!result || !org) return;
    const polys = result.candidates.filter((c) => c.geometry.type.includes("Polygon"));
    const asAreas = polygonsAsAreas && canCreateArea ? polys : [];
    const asFeatures = result.candidates.filter((c) => !asAreas.includes(c));
    for (let i = 0; i < asFeatures.length; i += 200) {
      unwrap(await supabase.from("map_features").insert(asFeatures.slice(i, i + 200).map((c) => ({ org_id: org.id, kind: c.kind, name: c.name, notes: c.notes, geometry: c.geometry, properties: c.properties }))).select("id"));
    }
    if (asAreas.length) {
      unwrap(await supabase.from("hunting_areas").insert(asAreas.map((c) => ({ org_id: org.id, name: c.name, description: c.notes, geometry: c.geometry, area_m2: measure(c.geometry).areaM2 ?? null }))).select("id"));
    }
    return result.candidates.length;
  }, { success: "Import complete", invalidate: [["map_features"], ["areas"]], onSuccess: () => result && onDone({ type: "FeatureCollection", features: result.candidates.map((c) => ({ type: "Feature", geometry: c.geometry, properties: {} })) }) });
  const counts = result?.candidates.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] ?? 0) + 1 }), {}) ?? {};
  return (
    <Dialog open={!!result} onOpenChange={(v) => !v && onClose()} title="Import GeoJSON"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => run.mutate()} loading={run.isPending} disabled={!result?.candidates.length}>Import {result?.candidates.length ?? 0} features</Button></>}>
      {result && (
        <div className="space-y-3 text-sm">
          <ul className="space-y-1">
            {Object.entries(counts).map(([k, n]) => <li key={k} className="flex justify-between"><span>{FEATURE_KINDS[k as MapFeatureKind].label}</span><span className="tabular text-muted">{n}</span></li>)}
          </ul>
          {result.skipped.length > 0 && <p className="text-warning">{result.skipped.length} feature(s) skipped (unsupported or invalid geometry).</p>}
          {canCreateArea && result.candidates.some((c) => c.geometry.type.includes("Polygon")) && (
            <Checkbox label="Import polygons as hunting areas instead of zones" checked={polygonsAsAreas} onChange={(e) => setPolygonsAsAreas(e.target.checked)} />
          )}
          <p className="text-xs text-muted">Types are inferred from a <code>kind</code> property or names like "Torn" or "Åtel". You can change them afterwards. Coordinates must be WGS84 (EPSG:4326).</p>
        </div>
      )}
    </Dialog>
  );
}

