// Generic HTTP adapter for self-hosted detectors (e.g. a MegaDetector + SpeciesNet service,
// or any in-house model). Contract:
//   POST VISION_HTTP_URL  (multipart/form-data, field "image")
//   Authorization: Bearer VISION_HTTP_TOKEN (optional)
//   -> 200 { "model": "speciesnet-4.0", "detections": [ { "label": "alces alces", "confidence": 0.93,
//            "bbox": [x, y, w, h], "count": 1 } ] }
// Labels may be catalog codes, common names, scientific names or taxonomy strings.
import { fetchWithRetry } from "../http.ts";
import type { VisionInput, VisionProvider, VisionProviderResult } from "./types.ts";

export class HttpVisionProvider implements VisionProvider {
  readonly name = "http";
  constructor(private url: string, private token?: string) {}

  async analyze(input: VisionInput): Promise<VisionProviderResult> {
    const form = new FormData();
    form.append("image", new Blob([input.bytes as BlobPart], { type: input.mimeType }), "image");
    const res = await fetchWithRetry(this.url, {
      method: "POST",
      body: form,
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    }, { timeoutMs: 60_000 });
    if (!res.ok) throw new Error(`Vision service responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const detections = Array.isArray(body?.detections) ? body.detections : [];
    return {
      model: String(body?.model ?? "http"),
      empty: detections.length === 0,
      // deno-lint-ignore no-explicit-any
      detections: detections.map((d: any) => ({
        label: String(d.label ?? d.species ?? ""),
        confidence: Number(d.confidence ?? d.score),
        count: d.count == null ? null : Number(d.count),
        bbox: Array.isArray(d.bbox) && d.bbox.length === 4 ? d.bbox.map(Number) : null,
      })),
    };
  }
}
