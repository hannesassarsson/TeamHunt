// Claude vision adapter (Anthropic Messages API, structured JSON output).
import Anthropic from "npm:@anthropic-ai/sdk@1";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1/helpers/zod";
import * as z from "npm:zod@^3.25/v4";
import { SPECIES } from "../domain/species.ts";
import type { VisionInput, VisionProvider, VisionProviderResult } from "./types.ts";

const Output = z.object({
  empty: z.boolean().describe("true when no animal, person or vehicle is visible"),
  detections: z.array(z.object({
    species: z.string().describe("one catalog code from the list"),
    confidence: z.number().describe("0..1, your honest probability that the species is correct"),
    count: z.number().int().nullable().describe("number of clearly visible individuals, null if not countable"),
    bbox: z.array(z.number()).nullable().describe("[x, y, width, height] normalised 0..1 for the most prominent individual, or null"),
  })),
});

const CODES = SPECIES.map((s) => `${s.code} (${s.en}${s.scientific ? `, ${s.scientific}` : ""})`).join("\n");

const SYSTEM = `You analyse trail camera images from the Nordic countries (Sweden, Norway, Finland, Denmark).
Report only what is visible. For each distinct species present, return one detection using a code from this catalog:
${CODES}

Rules:
- Use "animal_unknown" when an animal is visible but the species cannot be determined (blurry, partial, night IR glare).
- Confidence must reflect real uncertainty: night/IR, motion blur, partial bodies and distance lower it.
- Count only individuals you can actually see. Use null if you cannot count reliably.
- Never infer sex, age, weight, health, antler size or individual identity.
- Set empty=true and return no detections if the frame shows no animal, person or vehicle (e.g. wind-triggered vegetation).`;

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export class AnthropicVisionProvider implements VisionProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 60_000 });
  }

  async analyze(input: VisionInput): Promise<VisionProviderResult> {
    if (!SUPPORTED.has(input.mimeType)) throw new Error(`Unsupported image type for Claude: ${input.mimeType}`);
    const b64 = encodeBase64(input.bytes);
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      output_config: { effort: "low", format: zodOutputFormat(Output) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: input.mimeType as "image/jpeg", data: b64 } },
          { type: "text", text: `Analyse this trail camera image${input.hints?.capturedAt ? ` (captured ${input.hints.capturedAt})` : ""}.` },
        ],
      }],
    });
    if (response.stop_reason === "refusal") {
      // Leave it to a human reviewer rather than guessing.
      return { model: this.model, empty: false, detections: [{ label: "animal_unknown", confidence: 0.2 }] };
    }
    const out = response.parsed_output;
    if (!out) throw new Error(`Claude returned no parseable output (stop_reason=${response.stop_reason})`);
    return {
      model: response.model ?? this.model,
      empty: out.empty && out.detections.length === 0,
      detections: out.detections.map((d) => ({
        label: d.species,
        confidence: d.confidence,
        count: d.count,
        bbox: d.bbox && d.bbox.length === 4 ? (d.bbox as [number, number, number, number]) : null,
      })),
    };
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
