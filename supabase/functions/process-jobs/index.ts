// NORDHUNT background worker. Invoke every minute (pg_cron + pg_net, or any scheduler) with
//   Authorization: Bearer <WORKER_SECRET>
// Drains the Postgres job queue: image analysis, event evaluation, notification delivery,
// camera health checks and daily summaries.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { serviceClient, env } from "../_shared/clients.ts";
import { HttpError, json, log, safeEqual, serve } from "../_shared/http.ts";
import { computePhash, exifDateTimeOriginal, zonedToUtc } from "../_shared/images.ts";
import { getVisionProvider } from "../_shared/vision/index.ts";
import { weatherAt } from "../_shared/weather.ts";
import { sendEmail, sendPush, escapeHtml } from "../_shared/notify.ts";
import { hammingDistance, NEAR_DUPLICATE_MAX_DISTANCE, NEAR_DUPLICATE_WINDOW_SECONDS } from "../_shared/domain/phash.ts";
import { normalizeDetections, hasAnimals, statusAfterAnalysis } from "../_shared/domain/vision.ts";
import { detectionTier, type ReviewState } from "../_shared/domain/tiers.ts";
import { buildMessage, inQuietHours, ruleMatches, type DomainEvent, type NotificationRule } from "../_shared/domain/notifications.ts";
import { speciesLabel } from "../_shared/domain/species.ts";

interface Job { id: number; type: string; payload: Record<string, unknown>; attempts: number }

const TIME_BUDGET_MS = 45_000;
const APP_URL = Deno.env.get("APP_URL") ?? "";

serve("process-jobs", async (req) => {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !safeEqual(token, env("WORKER_SECRET"))) throw new HttpError(401, "Unauthorized");
  const db = serviceClient();
  await scheduleRecurring(db);

  const started = Date.now();
  const worker = `w-${crypto.randomUUID().slice(0, 8)}`;
  const stats = { done: 0, failed: 0 };
  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: jobs, error } = await db.rpc("claim_jobs", { p_worker: worker, p_limit: 5 });
    if (error) throw error;
    if (!jobs?.length) break;
    for (const job of jobs as Job[]) {
      try {
        await handle(db, job);
        await db.rpc("complete_job", { p_id: job.id });
        stats.done++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("warn", "job failed", { job: job.id, type: job.type, attempt: job.attempts, error: msg });
        await db.rpc("fail_job", { p_id: job.id, p_error: msg });
        stats.failed++;
      }
    }
  }
  return json(req, { worker, ...stats });
});

async function scheduleRecurring(db: SupabaseClient) {
  const now = new Date();
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const rows = [
    { type: "camera_health", payload: {}, dedupe_key: `camera_health:${hour}` },
    // Daily summary for the previous day, sent at 06:00 UTC (07:00/08:00 Nordic time).
    { type: "daily_summary", payload: { date: new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10) }, dedupe_key: `daily_summary:${day}`, run_after: `${day}T06:00:00Z` },
  ];
  const { error } = await db.from("jobs").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) log("warn", "schedule failed", { error: error.message });
}

function handle(db: SupabaseClient, job: Job): Promise<void> {
  switch (job.type) {
    case "analyze_image": return analyzeImage(db, String(job.payload.image_id), job.payload.reanalyze === true);
    case "evaluate_event": return evaluateEvent(db, job.payload);
    case "dispatch_notification": return dispatchNotification(db, String(job.payload.notification_id));
    case "camera_health": return cameraHealth(db);
    case "daily_summary": return dailySummary(db, String(job.payload.date));
    default: throw new Error(`Unknown job type ${job.type}`);
  }
}

// ----------------------------------------------------------------------------- image analysis
async function analyzeImage(db: SupabaseClient, imageId: string, reanalyze: boolean) {
  const { data: img, error } = await db.from("camera_images")
    .select("*, organizations(probable_threshold, timezone), cameras(lat, lon, name)")
    .eq("id", imageId).maybeSingle();
  if (error) throw error;
  if (!img) return; // deleted meanwhile
  if (img.status === "duplicate" && !reanalyze) return;
  const org = img.organizations as { probable_threshold: number; timezone: string };
  const camera = img.cameras as { lat: number | null; lon: number | null; name: string } | null;
  await db.from("camera_images").update({ status: "processing" }).eq("id", imageId);

  const { data: file, error: dlErr } = await db.storage.from("camera-images").download(img.storage_path);
  if (dlErr || !file) throw new Error(`Could not download image: ${dlErr?.message ?? "missing"}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";

  const patch: Record<string, unknown> = {};
  // Capture time: prefer EXIF (interpreted in the team's timezone) over upload time.
  if (!img.captured_at || img.captured_at_source === "upload") {
    const exif = exifDateTimeOriginal(bytes);
    if (exif) {
      patch.captured_at = zonedToUtc(exif, org.timezone);
      patch.captured_at_source = "exif";
    } else if (!img.captured_at) {
      patch.captured_at = img.uploaded_at;
      patch.captured_at_source = "upload";
    }
  }
  const capturedAt = (patch.captured_at as string | undefined) ?? img.captured_at ?? img.uploaded_at;
  if (!img.phash || !img.width) {
    const ph = await computePhash(bytes);
    if (ph) Object.assign(patch, { phash: img.phash ?? ph.phash, width: img.width ?? ph.width, height: img.height ?? ph.height });
  }
  const phash = (patch.phash as string | undefined) ?? img.phash;

  // Near-duplicate burst detection (same camera, similar frame, within the window).
  if (!reanalyze && phash && img.camera_id) {
    const t = new Date(capturedAt).getTime();
    const { data: neighbours } = await db.from("camera_images")
      .select("id, phash, captured_at")
      .eq("camera_id", img.camera_id).neq("id", imageId).neq("status", "duplicate").not("phash", "is", null)
      .gte("captured_at", new Date(t - NEAR_DUPLICATE_WINDOW_SECONDS * 1000).toISOString())
      .lte("captured_at", new Date(t + NEAR_DUPLICATE_WINDOW_SECONDS * 1000).toISOString())
      .lt("uploaded_at", img.uploaded_at)
      .limit(50);
    const dup = (neighbours ?? []).find((n) => hammingDistance(n.phash, phash) <= NEAR_DUPLICATE_MAX_DISTANCE);
    if (dup) {
      await db.from("camera_images").update({ ...patch, status: "duplicate", duplicate_of: dup.id, analyzed_at: new Date().toISOString() }).eq("id", imageId);
      return;
    }
  }

  // Weather at capture time (best effort; never blocks analysis).
  if (camera?.lat != null && camera?.lon != null && !img.weather) {
    try {
      const w = await weatherAt(db, camera.lat, camera.lon, capturedAt);
      if (w) patch.weather = w;
    } catch (e) {
      log("warn", "weather lookup failed", { image: imageId, error: String(e) });
    }
  }

  const provider = getVisionProvider();
  if (!provider) {
    await db.from("camera_images").update({
      ...patch, status: "needs_review", analysis_provider: null,
      analysis_error: "No AI vision provider configured. Classify this image manually.",
    }).eq("id", imageId);
    return;
  }

  const result = await provider.analyze({ bytes, mimeType, hints: { capturedAt } });
  const detections = normalizeDetections(result.detections);
  if (reanalyze) {
    // Replace previous unreviewed AI output; keep anything a person has reviewed.
    await db.from("detections").delete().eq("image_id", imageId).eq("source", "ai").eq("review", "unreviewed");
  }
  if (detections.length) {
    const { error: insErr } = await db.from("detections").insert(detections.map((d) => ({
      org_id: img.org_id, image_id: imageId, species_code: d.species_code, count: d.count,
      confidence: d.confidence, bbox: d.bbox, source: "ai", provider: provider.name, model: result.model,
    })));
    if (insErr) throw insErr;
  }
  const status = detections.length ? statusAfterAnalysis(detections, Number(org.probable_threshold)) : "analyzed";
  await db.from("camera_images").update({
    ...patch, status, has_animals: hasAnimals(detections), analysis_provider: provider.name, analysis_model: result.model,
    analysis_error: null, analyzed_at: new Date().toISOString(),
  }).eq("id", imageId);

  if (detections.length) {
    await db.from("jobs").insert({ type: "evaluate_event", payload: { event: "detection", image_id: imageId } });
  }
}

// ----------------------------------------------------------------------------- events & rules
async function buildEvent(db: SupabaseClient, p: Record<string, unknown>): Promise<{ event: DomainEvent; cameraName?: string } | null> {
  switch (p.event) {
    case "detection": {
      const { data: img } = await db.from("camera_images").select("id, org_id, camera_id, cameras(name), organizations(probable_threshold)").eq("id", p.image_id).maybeSingle();
      if (!img) return null;
      const { data: dets } = await db.from("detections").select("species_code, count, confidence, source, review").eq("image_id", img.id);
      const threshold = Number((img.organizations as unknown as { probable_threshold: number }).probable_threshold);
      return {
        cameraName: (img.cameras as unknown as { name: string } | null)?.name,
        event: {
          type: "detection", orgId: img.org_id, cameraId: img.camera_id, imageId: img.id,
          detections: (dets ?? []).map((d) => ({
            species: d.species_code, count: d.count,
            tier: detectionTier({ source: d.source, review: d.review as ReviewState, confidence: d.confidence == null ? null : Number(d.confidence), threshold }),
          })),
        },
      };
    }
    case "observation_created": {
      const { data: o } = await db.from("observations").select("id, org_id, species_code, count, created_by, lat, lon, observed_at, weather").eq("id", p.observation_id).maybeSingle();
      if (!o) return null;
      if (o.lat != null && o.lon != null && !o.weather) {
        try {
          const w = await weatherAt(db, o.lat, o.lon, o.observed_at);
          if (w) await db.from("observations").update({ weather: w }).eq("id", o.id);
        } catch (e) {
          log("warn", "observation weather failed", { error: String(e) });
        }
      }
      return { event: { type: "observation_created", orgId: o.org_id, observationId: o.id, species: o.species_code, count: o.count, actorId: o.created_by } };
    }
    case "harvest_created": {
      const { data: h } = await db.from("harvests").select("id, org_id, species_code, created_by").eq("id", p.harvest_id).maybeSingle();
      if (!h) return null;
      return { event: { type: "harvest_created", orgId: h.org_id, harvestId: h.id, species: h.species_code, actorId: h.created_by } };
    }
    case "camera_offline":
      return { event: p.data as DomainEvent };
    case "daily_summary":
      return { event: p.data as DomainEvent };
  }
  return null;
}

function dedupeKeyFor(event: DomainEvent, ruleId: string): string {
  switch (event.type) {
    case "detection": return `det:${event.imageId}:${ruleId}`;
    case "observation_created": return `obs:${event.observationId}:${ruleId}`;
    case "harvest_created": return `hv:${event.harvestId}:${ruleId}`;
    case "camera_offline": return `off:${event.cameraId}:${event.lastSeenAt ?? "never"}:${ruleId}`;
    case "daily_summary": return `sum:${event.orgId}:${event.date}:${ruleId}`;
  }
}

async function evaluateEvent(db: SupabaseClient, payload: Record<string, unknown>) {
  const built = await buildEvent(db, payload);
  if (!built) return;
  const { event, cameraName } = built;
  const eventTypes = event.type === "detection" ? ["detection", "species_detected"] : [event.type];
  const { data: rules, error } = await db.from("notification_rules").select("*").eq("org_id", event.orgId).eq("enabled", true).in("event", eventTypes);
  if (error) throw error;
  if (!rules?.length) return;
  // Only current members receive notifications.
  const { data: members } = await db.from("memberships").select("user_id").eq("org_id", event.orgId);
  const memberIds = new Set((members ?? []).map((m) => m.user_id));

  for (const rule of rules as NotificationRule[]) {
    if (!memberIds.has(rule.user_id) || !ruleMatches(rule, event)) continue;
    const msg = buildMessage(rule, event, { cameraName });
    const { data: n, error: nErr } = await db.from("notifications").upsert({
      org_id: event.orgId, user_id: rule.user_id, rule_id: rule.id, event: rule.event === "species_detected" && event.type === "detection" ? "species_detected" : event.type,
      title: msg.title, body: msg.body, link: msg.link, dedupe_key: dedupeKeyFor(event, rule.id),
      data: { event: event.type },
    }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (nErr) throw nErr;
    if (!n) continue; // already notified
    const channels = rule.channels.filter((c) => c !== "in_app") as ("email" | "push")[];
    if (channels.length) {
      await db.from("notification_deliveries").insert(channels.map((channel) => ({ notification_id: n.id, channel })));
      await db.from("jobs").insert({ type: "dispatch_notification", payload: { notification_id: n.id } });
    }
  }
}

async function dispatchNotification(db: SupabaseClient, notificationId: string) {
  const { data: n } = await db.from("notifications").select("*").eq("id", notificationId).maybeSingle();
  if (!n) return;
  const { data: deliveries } = await db.from("notification_deliveries").select("*").eq("notification_id", n.id).in("status", ["pending", "failed"]);
  if (!deliveries?.length) return;
  const { data: prefs } = await db.from("notification_preferences").select("*").eq("user_id", n.user_id).maybeSingle();
  const quiet = prefs ? inQuietHours(prefs) : false;
  let retry = false;

  for (const d of deliveries) {
    let result: { status: string; provider: string; error?: string; expiredEndpoints?: string[] };
    if (quiet) {
      result = { status: "skipped", provider: "none", error: "Quiet hours" };
    } else if (d.channel === "email") {
      if (prefs && !prefs.email_enabled) result = { status: "skipped", provider: "none", error: "Email disabled by user" };
      else {
        const { data: u } = await db.auth.admin.getUserById(n.user_id);
        const link = APP_URL && n.link ? `${APP_URL}${n.link}` : "";
        result = u?.user?.email
          ? await sendEmail({
            to: u.user.email, subject: `NORDHUNT · ${n.title}`,
            text: `${n.title}\n\n${n.body}${link ? `\n\n${link}` : ""}`,
            html: `<h2 style="font-family:sans-serif">${escapeHtml(n.title)}</h2><p style="font-family:sans-serif;white-space:pre-line">${escapeHtml(n.body)}</p>${link ? `<p><a href="${escapeHtml(link)}">Open in NORDHUNT</a></p>` : ""}`,
          })
          : { status: "skipped", provider: "none", error: "User has no email" };
      }
    } else {
      if (prefs && !prefs.push_enabled) result = { status: "skipped", provider: "none", error: "Push disabled by user" };
      else {
        const { data: subs } = await db.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", n.user_id);
        result = await sendPush(subs ?? [], { title: n.title, body: n.body, url: n.link ?? "/" });
        if (result.expiredEndpoints?.length) await db.from("push_subscriptions").delete().in("endpoint", result.expiredEndpoints);
      }
    }
    const attempts = d.attempts + 1;
    await db.from("notification_deliveries").update({
      status: result.status, provider: result.provider, last_error: result.error ?? null, attempts,
      sent_at: result.status === "sent" ? new Date().toISOString() : null,
    }).eq("id", d.id);
    if (result.status === "failed" && attempts < 5) retry = true;
  }
  if (retry) throw new Error("Some deliveries failed; will retry");
}

// ----------------------------------------------------------------------------- scheduled
async function cameraHealth(db: SupabaseClient) {
  const { data: cams, error } = await db.from("cameras").select("id, org_id, name, last_seen_at, offline_after_hours, created_at").eq("active", true).is("offline_notified_at", null);
  if (error) throw error;
  const now = Date.now();
  for (const c of cams ?? []) {
    const ref = new Date(c.last_seen_at ?? c.created_at).getTime();
    if (now - ref < c.offline_after_hours * 3_600_000) continue;
    await db.from("cameras").update({ offline_notified_at: new Date().toISOString() }).eq("id", c.id);
    await db.from("jobs").insert({
      type: "evaluate_event",
      payload: { event: "camera_offline", data: { type: "camera_offline", orgId: c.org_id, cameraId: c.id, cameraName: c.name, lastSeenAt: c.last_seen_at } },
    });
  }
}

async function dailySummary(db: SupabaseClient, date: string) {
  const { data: rules } = await db.from("notification_rules").select("org_id").eq("event", "daily_summary").eq("enabled", true);
  const orgIds = [...new Set((rules ?? []).map((r) => r.org_id))];
  for (const orgId of orgIds) {
    const { data: org } = await db.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
    if (!org) continue;
    const from = zonedToUtc(`${date}T00:00:00`, org.timezone);
    const to = new Date(new Date(from).getTime() + 86_400_000).toISOString();
    const { data: summary, error } = await db.rpc("analytics_species_summary", { p_org: orgId, p_from: from, p_to: to });
    if (error) throw error;
    const { count: images } = await db.from("camera_images").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("uploaded_at", from).lt("uploaded_at", to);
    const lines = [`${images ?? 0} new camera images`];
    for (const s of (summary ?? []).slice(0, 8)) {
      const parts = [];
      if (s.camera_events) parts.push(`${s.camera_events} camera events (${s.confirmed_events} confirmed)`);
      if (s.observations) parts.push(`${s.observations} observations`);
      if (s.harvests) parts.push(`${s.harvests} harvested`);
      lines.push(`${speciesLabel(s.species_code)}: ${parts.join(", ")}`);
    }
    await db.from("jobs").insert({ type: "evaluate_event", payload: { event: "daily_summary", data: { type: "daily_summary", orgId, date, lines } } });
  }
}
