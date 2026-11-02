import { describe, expect, it } from "vitest";
import { parseGeoJsonImport, validateGeometry, measure, buildExport, kindsForGeometry, distanceM } from "./geo";

describe("geo", () => {
  it("validates geometries", () => {
    expect(validateGeometry({ type: "Point", coordinates: [15, 60] })).toBe(true);
    expect(validateGeometry({ type: "Point", coordinates: [200, 60] })).toBe(false);
    expect(validateGeometry({ type: "LineString", coordinates: [[15, 60]] })).toBe(false);
    expect(validateGeometry({ type: "Polygon", coordinates: [[[15, 60], [15.1, 60], [15, 60]]] })).toBe(false);
    expect(validateGeometry({ type: "Polygon", coordinates: [[[15, 60], [15.1, 60], [15.1, 60.1], [15, 60]]] })).toBe(true);
    expect(validateGeometry({ type: "GeometryCollection", geometries: [] })).toBe(false);
    expect(validateGeometry(null)).toBe(false);
  });

  it("imports feature collections with kind inference", () => {
    const r = parseGeoJsonImport(JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [15, 60] }, properties: { name: "Torn 3", height: 4 } },
        { type: "Feature", geometry: { type: "Point", coordinates: [15, 60] }, properties: { name: "Åtel norr" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [15, 60] }, properties: { kind: "parking" } },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[15, 60], [15.1, 60.1]] }, properties: { name: "Stig" } },
        { type: "Feature", geometry: { type: "Polygon", coordinates: [[[15, 60], [15.1, 60], [15.1, 60.1], [15, 60]]] }, properties: {} },
        { type: "Feature", geometry: { type: "Point", coordinates: [999, 60] }, properties: {} },
      ],
    }));
    expect(r.candidates.map((c) => c.kind)).toEqual(["stand", "feeding_station", "parking", "path", "zone"]);
    expect(r.candidates[0].properties).toEqual({ height: 4 });
    expect(r.candidates[2].name).toBe("Imported 3");
    expect(r.skipped).toEqual([{ index: 5, reason: "Unsupported or invalid geometry" }]);
  });

  it("rejects non-WGS84 and invalid JSON", () => {
    expect(() => parseGeoJsonImport("{nope")).toThrow(/valid JSON/);
    expect(() => parseGeoJsonImport(JSON.stringify({ type: "FeatureCollection", crs: { properties: { name: "EPSG:3006" } }, features: [] }))).toThrow(/3006/);
  });

  it("accepts a bare geometry", () => {
    expect(parseGeoJsonImport(JSON.stringify({ type: "Point", coordinates: [15, 60] })).candidates).toHaveLength(1);
  });

  it("measures lines and polygons", () => {
    const line = measure({ type: "LineString", coordinates: [[15, 60], [15, 60.01]] });
    expect(line.lengthM!).toBeGreaterThan(1100);
    expect(line.lengthM!).toBeLessThan(1120);
    const poly = measure({ type: "Polygon", coordinates: [[[15, 60], [15.01, 60], [15.01, 60.01], [15, 60.01], [15, 60]]] });
    expect(poly.areaM2! / 10_000).toBeGreaterThan(60);
    expect(poly.areaM2! / 10_000).toBeLessThan(65);
    expect(distanceM([15, 60], [15, 60.01])).toBeCloseTo(line.lengthM!, 0);
  });

  it("maps geometry to allowed kinds", () => {
    expect(kindsForGeometry("Polygon")).toEqual(["zone"]);
    expect(kindsForGeometry("LineString")).toEqual(["path", "drag_route"]);
    expect(kindsForGeometry("Point")).toContain("stand");
  });

  it("exports all layers", () => {
    const fc = buildExport({
      areas: [], features: [], observations: [],
      cameras: [{ id: "c", name: "Cam", lat: 60, lon: 15, model: null } as never, { id: "d", name: "NoPos", lat: null, lon: null } as never],
    });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ layer: "camera", name: "Cam" });
  });
});
