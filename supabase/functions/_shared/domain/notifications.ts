import { meetsTier, type Tier } from "./tiers.ts";
import { speciesLabel } from "./species.ts";

export type NotificationEventType =
  | "detection" | "species_detected" | "camera_offline" | "observation_created" | "harvest_created" | "daily_summary";

export interface NotificationRule {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  event: NotificationEventType;
  species_codes: string[];
  camera_ids: string[];
  min_tier: "uncertain" | "probable" | "confirmed";
  channels: ("in_app" | "email" | "push")[];
  enabled: boolean;
}

export type DomainEvent =
  | { type: "detection"; orgId: string; cameraId: string | null; imageId: string; detections: { species: string; tier: Tier; count: number | null }[] }
  | { type: "camera_offline"; orgId: string; cameraId: string; cameraName: string; lastSeenAt: string | null }
  | { type: "observation_created"; orgId: string; observationId: string; species: string; count: number | null; actorId: string | null }
  | { type: "harvest_created"; orgId: string; harvestId: string; species: string; actorId: string | null }
  | { type: "daily_summary"; orgId: string; date: string; lines: string[] };

/** Species from a detection event that satisfy a rule (tier + species filters). */
export function matchingDetections(rule: NotificationRule, event: Extract<DomainEvent, { type: "detection" }>) {
  return event.detections.filter(
    (d) => d.tier !== "rejected" && meetsTier(d.tier, rule.min_tier) && d.species !== "human" && d.species !== "vehicle" &&
      (rule.event === "detection" || rule.species_codes.includes(d.species)),
  );
}

export function ruleMatches(rule: NotificationRule, event: DomainEvent): boolean {
  if (!rule.enabled || rule.org_id !== event.orgId) return false;
  switch (event.type) {
    case "detection":
      if (rule.event !== "detection" && rule.event !== "species_detected") return false;
      if (rule.camera_ids.length && (!event.cameraId || !rule.camera_ids.includes(event.cameraId))) return false;
      if (rule.event === "detection" && rule.species_codes.length) {
        return matchingDetections({ ...rule, event: "species_detected" }, event).length > 0;
      }
      return matchingDetections(rule, event).length > 0;
    case "camera_offline":
      return rule.event === "camera_offline" && (!rule.camera_ids.length || rule.camera_ids.includes(event.cameraId));
    case "observation_created":
      // Do not notify people about their own observations.
      return rule.event === "observation_created" && rule.user_id !== event.actorId &&
        (!rule.species_codes.length || rule.species_codes.includes(event.species));
    case "harvest_created":
      return rule.event === "harvest_created" && rule.user_id !== event.actorId &&
        (!rule.species_codes.length || rule.species_codes.includes(event.species));
    case "daily_summary":
      return rule.event === "daily_summary";
  }
}

export function buildMessage(rule: NotificationRule, event: DomainEvent, ctx: { cameraName?: string } = {}) {
  switch (event.type) {
    case "detection": {
      const matched = rule.event === "detection" && !rule.species_codes.length
        ? matchingDetections(rule, event)
        : matchingDetections({ ...rule, event: "species_detected" }, event);
      const parts = matched.map((d) => `${speciesLabel(d.species)}${d.count && d.count > 1 ? ` ×${d.count}` : ""} (${d.tier})`);
      return {
        title: `${parts.length ? speciesLabel(matched[0].species) : "Animal"} detected${ctx.cameraName ? ` · ${ctx.cameraName}` : ""}`,
        body: parts.join(", "),
        link: `/library?image=${event.imageId}`,
      };
    }
    case "camera_offline":
      return {
        title: `Camera offline · ${event.cameraName}`,
        body: event.lastSeenAt ? `No images since ${new Date(event.lastSeenAt).toUTCString()}` : "No images received yet",
        link: `/cameras/${event.cameraId}`,
      };
    case "observation_created":
      return {
        title: `New observation · ${speciesLabel(event.species)}`,
        body: event.count ? `${event.count} reported` : "",
        link: `/observations?id=${event.observationId}`,
      };
    case "harvest_created":
      return { title: `Harvest registered · ${speciesLabel(event.species)}`, body: "", link: `/journal` };
    case "daily_summary":
      return { title: `Daily wildlife summary · ${event.date}`, body: event.lines.join("\n") || "No activity recorded.", link: "/analytics" };
  }
}

/** True when `now` falls inside the user's quiet hours (local time). Handles windows crossing midnight. */
export function inQuietHours(prefs: { quiet_hours_start: number | null; quiet_hours_end: number | null; timezone: string }, now = new Date()): boolean {
  const { quiet_hours_start: s, quiet_hours_end: e } = prefs;
  if (s == null || e == null || s === e) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: prefs.timezone }).format(now));
  return s < e ? hour >= s && hour < e : hour >= s || hour < e;
}
