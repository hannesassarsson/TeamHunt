// Classification confidence tiers. Mirrors public.detection_tier() in SQL.
// - confirmed: verified by a person (or entered manually). AI alone never confirms.
// - probable:  AI confidence >= the team's threshold (default 0.80).
// - uncertain: AI confidence below the threshold.
export type Tier = "confirmed" | "probable" | "uncertain" | "rejected";
export type ReviewState = "unreviewed" | "confirmed" | "corrected" | "rejected";

export const DEFAULT_PROBABLE_THRESHOLD = 0.8;

export function detectionTier(input: {
  source: "ai" | "manual";
  review: ReviewState;
  confidence: number | null;
  threshold?: number;
}): Tier {
  const threshold = input.threshold ?? DEFAULT_PROBABLE_THRESHOLD;
  if (input.review === "rejected") return "rejected";
  if (input.source === "manual" || input.review === "confirmed" || input.review === "corrected") return "confirmed";
  if (input.confidence != null && input.confidence >= threshold) return "probable";
  return "uncertain";
}

export function tierRank(tier: Tier | string): number {
  return tier === "confirmed" ? 3 : tier === "probable" ? 2 : tier === "uncertain" ? 1 : 0;
}

export function meetsTier(tier: Tier | string, min: Tier | string): boolean {
  return tierRank(tier) >= tierRank(min);
}

export const TIER_LABEL: Record<Tier, string> = {
  confirmed: "Confirmed",
  probable: "Probable",
  uncertain: "Uncertain",
  rejected: "Rejected",
};
