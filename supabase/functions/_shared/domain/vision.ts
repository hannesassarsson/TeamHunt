// Provider-agnostic vision output normalisation. Every adapter returns RawDetection[]; this
// module turns it into rows that are safe to store: catalog species codes, clamped values,
// and no attributes the model did not explicitly return.
import { resolveSpeciesCode, isAnimal } from "./species.ts";

export interface RawDetection {
  label: string;
  confidence: number;
  count?: number | null;
  /** [x, y, w, h] normalised 0..1 */
  bbox?: [number, number, number, number] | null;
}

export interface NormalizedDetection {
  species_code: string;
  confidence: number;
  count: number | null;
  bbox: [number, number, number, number] | null;
  raw_label: string;
}

export interface VisionAnalysis {
  provider: string;
  model: string;
  detections: NormalizedDetection[];
  /** Provider-reported "image contains no animals". */
  empty: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function normalizeDetections(raw: RawDetection[], opts: { minConfidence?: number } = {}): NormalizedDetection[] {
  const minConfidence = opts.minConfidence ?? 0.15;
  const bySpecies = new Map<string, NormalizedDetection & { boxes: number }>();
  for (const r of raw) {
    if (!r || typeof r.label !== "string" || typeof r.confidence !== "number" || !Number.isFinite(r.confidence)) continue;
    const confidence = Math.round(clamp01(r.confidence) * 1000) / 1000;
    if (confidence < minConfidence) continue;
    let code = resolveSpeciesCode(r.label);
    if (!code) code = "animal_unknown";
    const bbox = Array.isArray(r.bbox) && r.bbox.length === 4 && r.bbox.every((v) => Number.isFinite(v))
      ? (r.bbox.map((v) => Math.round(clamp01(v) * 10000) / 10000) as [number, number, number, number])
      : null;
    const count = r.count != null && Number.isFinite(r.count) && r.count >= 1 ? Math.min(500, Math.round(r.count)) : null;
    const existing = bySpecies.get(code);
    if (!existing) {
      bySpecies.set(code, { species_code: code, confidence, count, bbox, raw_label: r.label, boxes: bbox ? 1 : 0 });
    } else {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.boxes += bbox ? 1 : 0;
      if (count != null) existing.count = Math.max(existing.count ?? 0, count);
      if (!existing.bbox && bbox) existing.bbox = bbox;
    }
  }
  return [...bySpecies.values()].map(({ boxes, ...d }) => ({
    ...d,
    // Multiple boxes of the same species imply a count when the provider gave none.
    count: d.count ?? (boxes > 1 ? boxes : null),
  }));
}

export function hasAnimals(dets: NormalizedDetection[]): boolean {
  return dets.some((d) => isAnimal(d.species_code));
}

/** Extract the first JSON object from an LLM text response (tolerates ```json fences). */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model response");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Parse the JSON contract used by the LLM vision adapter prompt. */
export function parseLlmVisionResponse(text: string): { empty: boolean; detections: RawDetection[] } {
  // deno-lint-ignore no-explicit-any
  const obj = extractJsonObject(text) as any;
  const list = Array.isArray(obj?.detections) ? obj.detections : [];
  const detections: RawDetection[] = list
    .filter((d: unknown) => d && typeof d === "object")
    // deno-lint-ignore no-explicit-any
    .map((d: any) => ({
      label: String(d.species ?? d.label ?? ""),
      confidence: Number(d.confidence),
      count: d.count == null ? null : Number(d.count),
      bbox: Array.isArray(d.bbox) ? d.bbox.map(Number) : null,
    }));
  return { empty: obj?.empty === true || detections.length === 0, detections };
}

/** Image status after analysis. Anything the team should look at goes to the review queue. */
export function statusAfterAnalysis(dets: NormalizedDetection[], threshold: number): "analyzed" | "needs_review" {
  return dets.some((d) => d.confidence < threshold || d.species_code === "animal_unknown") ? "needs_review" : "analyzed";
}
