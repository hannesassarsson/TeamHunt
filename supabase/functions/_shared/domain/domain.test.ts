import { describe, expect, it } from "vitest";
import { resolveSpeciesCode, speciesLabel, SPECIES, isAnimal } from "./species.ts";
import { detectionTier, meetsTier } from "./tiers.ts";
import { dHashFromGray9x8, grayscale9x8, hammingDistance, isNearDuplicate } from "./phash.ts";
import { parseMetNorway, parseOpenMeteo, nearestSample, windDirectionLabel, coarseCoordinate } from "./weather.ts";
import { ruleMatches, buildMessage, inQuietHours, type NotificationRule } from "./notifications.ts";
import { normalizeDetections, parseLlmVisionResponse, statusAfterAnalysis, hasAnimals } from "./vision.ts";

describe("species", () => {
  it("has unique codes", () => {
    expect(new Set(SPECIES.map((s) => s.code)).size).toBe(SPECIES.length);
  });
  it("resolves common provider labels", () => {
    expect(resolveSpeciesCode("Moose")).toBe("moose");
    expect(resolveSpeciesCode("Eurasian elk")).toBe("moose");
    expect(resolveSpeciesCode("Älg")).toBe("moose");
    expect(resolveSpeciesCode("alces alces")).toBe("moose");
    expect(resolveSpeciesCode("wild-boar")).toBe("wild_boar");
    expect(resolveSpeciesCode("mammalia;carnivora;canidae;vulpes;vulpes vulpes")).toBe("red_fox");
    expect(resolveSpeciesCode("Grävling")).toBe("badger");
    expect(resolveSpeciesCode("kangaroo")).toBeNull();
    expect(resolveSpeciesCode("")).toBeNull();
  });
  it("labels and categorises", () => {
    expect(speciesLabel("roe_deer", "sv")).toBe("Rådjur");
    expect(speciesLabel("nope")).toBe("nope");
    expect(isAnimal("human")).toBe(false);
    expect(isAnimal("lynx")).toBe(true);
  });
});

describe("tiers", () => {
  it("never confirms from AI alone", () => {
    expect(detectionTier({ source: "ai", review: "unreviewed", confidence: 0.999 })).toBe("probable");
    expect(detectionTier({ source: "ai", review: "unreviewed", confidence: 0.5 })).toBe("uncertain");
    expect(detectionTier({ source: "ai", review: "confirmed", confidence: 0.2 })).toBe("confirmed");
    expect(detectionTier({ source: "ai", review: "corrected", confidence: 0.2 })).toBe("confirmed");
    expect(detectionTier({ source: "ai", review: "rejected", confidence: 0.99 })).toBe("rejected");
    expect(detectionTier({ source: "manual", review: "unreviewed", confidence: null })).toBe("confirmed");
  });
  it("honours custom thresholds", () => {
    expect(detectionTier({ source: "ai", review: "unreviewed", confidence: 0.7, threshold: 0.65 })).toBe("probable");
    expect(meetsTier("probable", "uncertain")).toBe(true);
    expect(meetsTier("uncertain", "probable")).toBe(false);
    expect(meetsTier("rejected", "uncertain")).toBe(false);
  });
});

describe("phash", () => {
  const gradient = Array.from({ length: 72 }, (_, i) => (i % 9) * 20);
  it("computes 64-bit hashes", () => {
    const h = dHashFromGray9x8(gradient);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toBe("0000000000000000"); // strictly increasing left->right
    expect(dHashFromGray9x8(gradient.map((v) => 255 - v))).toBe("ffffffffffffffff");
  });
  it("measures hamming distance", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("00000000000000f0", "0000000000000000")).toBe(4);
    expect(() => hammingDistance("00", "000")).toThrow();
  });
  it("downscales RGBA to 9x8", () => {
    const w = 18, h = 16;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = x * 14; rgba[i + 3] = 255; }
    const g = grayscale9x8(rgba, w, h);
    expect(g).toHaveLength(72);
    expect(dHashFromGray9x8(g)).toBe("0000000000000000");
  });
  it("detects bursts only within the time window", () => {
    const a = { phash: "0f0f0f0f0f0f0f0f", capturedAt: 0 };
    expect(isNearDuplicate(a, { phash: "0f0f0f0f0f0f0f0e", capturedAt: 30_000 })).toBe(true);
    expect(isNearDuplicate(a, { phash: "0f0f0f0f0f0f0f0e", capturedAt: 3_600_000 })).toBe(false);
    expect(isNearDuplicate(a, { phash: "f0f0f0f0f0f0f0f0", capturedAt: 1_000 })).toBe(false);
  });
});

describe("weather", () => {
  const met = {
    properties: {
      timeseries: [
        { time: "2026-11-02T10:00:00Z", data: { instant: { details: { air_temperature: 3.1, wind_speed: 4.2, wind_from_direction: 225, relative_humidity: 88, air_pressure_at_sea_level: 1003.2, cloud_area_fraction: 90 } }, next_1_hours: { summary: { symbol_code: "rain" }, details: { precipitation_amount: 0.4 } } } },
        { time: "2026-11-02T11:00:00Z", data: { instant: { details: { air_temperature: 3.5 } } } },
      ],
    },
  };
  it("parses MET Norway as forecast", () => {
    const s = parseMetNorway(met);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ kind: "forecast", temperature_c: 3.1, wind_dir_deg: 225, precipitation_mm: 0.4, symbol: "rain" });
    expect(s[1].wind_speed_ms).toBeNull();
    expect(() => parseMetNorway({})).toThrow();
  });
  it("parses Open-Meteo with explicit kind", () => {
    const s = parseOpenMeteo({ hourly: { time: ["2026-10-01T05:00"], temperature_2m: [2.5], wind_speed_10m: [1.1], precipitation: [0] } }, "historical", "open-meteo-era5");
    expect(s[0]).toMatchObject({ time: "2026-10-01T05:00:00.000Z", kind: "historical", temperature_c: 2.5, precipitation_mm: 0, humidity_pct: null });
  });
  it("finds nearest sample within a gap", () => {
    const s = parseMetNorway(met);
    expect(nearestSample(s, "2026-11-02T10:20:00Z")?.temperature_c).toBe(3.1);
    expect(nearestSample(s, "2026-11-02T18:00:00Z")).toBeNull();
  });
  it("formats wind and coarsens coordinates", () => {
    expect(windDirectionLabel(0)).toBe("N");
    expect(windDirectionLabel(225)).toBe("SW");
    expect(windDirectionLabel(359)).toBe("N");
    expect(windDirectionLabel(null)).toBe("–");
    expect(coarseCoordinate(60.12345)).toBe(60.12);
  });
});

describe("notifications", () => {
  const base: NotificationRule = { id: "r", org_id: "o", user_id: "u", name: "x", event: "species_detected", species_codes: ["moose"], camera_ids: [], min_tier: "probable", channels: ["in_app"], enabled: true };
  const det = (species: string, tier: "probable" | "uncertain" | "confirmed") => ({ type: "detection" as const, orgId: "o", cameraId: "c1", imageId: "i", detections: [{ species, tier, count: 2 }] });
  it("matches species rules by tier", () => {
    expect(ruleMatches(base, det("moose", "probable"))).toBe(true);
    expect(ruleMatches(base, det("moose", "uncertain"))).toBe(false);
    expect(ruleMatches(base, det("roe_deer", "confirmed"))).toBe(false);
    expect(ruleMatches({ ...base, enabled: false }, det("moose", "confirmed"))).toBe(false);
    expect(ruleMatches({ ...base, org_id: "other" }, det("moose", "confirmed"))).toBe(false);
  });
  it("filters by camera and ignores people for any-animal rules", () => {
    const any = { ...base, event: "detection" as const, species_codes: [] };
    expect(ruleMatches(any, det("human", "confirmed"))).toBe(false);
    expect(ruleMatches(any, det("wild_boar", "probable"))).toBe(true);
    expect(ruleMatches({ ...any, camera_ids: ["c2"] }, det("wild_boar", "probable"))).toBe(false);
  });
  it("does not notify users about their own observations", () => {
    const r = { ...base, event: "observation_created" as const, species_codes: [] };
    expect(ruleMatches(r, { type: "observation_created", orgId: "o", observationId: "1", species: "moose", count: 1, actorId: "u" })).toBe(false);
    expect(ruleMatches(r, { type: "observation_created", orgId: "o", observationId: "1", species: "moose", count: 1, actorId: "v" })).toBe(true);
  });
  it("builds readable messages", () => {
    const m = buildMessage(base, det("moose", "probable"), { cameraName: "Myren" });
    expect(m.title).toBe("Moose detected · Myren");
    expect(m.body).toBe("Moose ×2 (probable)");
  });
  it("handles quiet hours across midnight", () => {
    const p = { quiet_hours_start: 22, quiet_hours_end: 6, timezone: "UTC" };
    expect(inQuietHours(p, new Date("2026-11-02T23:30:00Z"))).toBe(true);
    expect(inQuietHours(p, new Date("2026-11-02T03:00:00Z"))).toBe(true);
    expect(inQuietHours(p, new Date("2026-11-02T12:00:00Z"))).toBe(false);
    expect(inQuietHours({ ...p, quiet_hours_start: null }, new Date("2026-11-02T23:30:00Z"))).toBe(false);
  });
});

describe("vision normalisation", () => {
  it("maps labels, clamps values and merges per species", () => {
    const out = normalizeDetections([
      { label: "Moose", confidence: 0.91, bbox: [0.1, 0.2, 0.3, 0.4] },
      { label: "elk", confidence: 0.85, bbox: [0.5, 0.2, 1.3, 0.4] },
      { label: "kangaroo", confidence: 0.6 },
      { label: "fox", confidence: 0.05 },
      { label: "roe deer", confidence: 7, count: 2.4 },
      { label: "bad", confidence: NaN },
    ]);
    const moose = out.find((d) => d.species_code === "moose")!;
    expect(moose.confidence).toBe(0.91);
    expect(moose.count).toBe(2); // two boxes
    expect(out.find((d) => d.species_code === "animal_unknown")?.raw_label).toBe("kangaroo");
    expect(out.find((d) => d.species_code === "red_fox")).toBeUndefined(); // below min confidence
    expect(out.find((d) => d.species_code === "roe_deer")).toMatchObject({ confidence: 1, count: 2 });
    expect(hasAnimals(out)).toBe(true);
  });
  it("parses LLM JSON with fences", () => {
    const r = parseLlmVisionResponse('Here:\n```json\n{"empty": false, "detections": [{"species": "wild boar", "confidence": 0.82, "count": 3}]}\n```');
    expect(r.empty).toBe(false);
    expect(r.detections[0]).toMatchObject({ label: "wild boar", confidence: 0.82, count: 3 });
    expect(parseLlmVisionResponse('{"empty": true, "detections": []}').empty).toBe(true);
    expect(() => parseLlmVisionResponse("no json")).toThrow();
  });
  it("routes uncertain results to review", () => {
    expect(statusAfterAnalysis([{ species_code: "moose", confidence: 0.95, count: 1, bbox: null, raw_label: "m" }], 0.8)).toBe("analyzed");
    expect(statusAfterAnalysis([{ species_code: "moose", confidence: 0.6, count: 1, bbox: null, raw_label: "m" }], 0.8)).toBe("needs_review");
    expect(statusAfterAnalysis([{ species_code: "animal_unknown", confidence: 0.95, count: 1, bbox: null, raw_label: "?" }], 0.8)).toBe("needs_review");
  });
});
