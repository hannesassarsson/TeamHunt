import type { RawDetection } from "../domain/vision.ts";

export interface VisionInput {
  bytes: Uint8Array;
  mimeType: string;
  /** Optional context to help the model; never used to invent attributes. */
  hints?: { region?: string; capturedAt?: string | null };
}

export interface VisionProviderResult {
  model: string;
  empty: boolean;
  detections: RawDetection[];
}

/**
 * A vision provider adapter. Implementations must only report what is visible in the image:
 * species, count and bounding boxes. No sex/age/weight/individual identity.
 */
export interface VisionProvider {
  readonly name: string;
  analyze(input: VisionInput): Promise<VisionProviderResult>;
}

export class ProviderNotConfiguredError extends Error {}
