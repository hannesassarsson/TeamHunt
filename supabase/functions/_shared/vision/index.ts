// Provider registry. Select with VISION_PROVIDER = anthropic | http | none.
import { AnthropicVisionProvider } from "./anthropic.ts";
import { HttpVisionProvider } from "./http.ts";
import type { VisionProvider } from "./types.ts";

export type { VisionProvider } from "./types.ts";

/** Returns null when no provider is configured: images then go to manual review. */
export function getVisionProvider(): VisionProvider | null {
  const name = (Deno.env.get("VISION_PROVIDER") ?? "").toLowerCase();
  if (name === "anthropic") {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return null;
    return new AnthropicVisionProvider(key, Deno.env.get("ANTHROPIC_VISION_MODEL") || "claude-opus-5-5");
  }
  if (name === "http") {
    const url = Deno.env.get("VISION_HTTP_URL");
    if (!url) return null;
    return new HttpVisionProvider(url, Deno.env.get("VISION_HTTP_TOKEN") || undefined);
  }
  return null;
}
