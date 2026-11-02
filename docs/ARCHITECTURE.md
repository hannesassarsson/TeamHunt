# Architecture

```
Browser (React SPA, PWA) ──supabase-js (anon key + user JWT)──► PostgREST ──► Postgres (RLS)
        │                                                        Storage (private buckets, RLS)
        │                                                        Realtime (notifications)
        └──fetch──► Edge functions: weather · send-invitation
Trail cameras / mail bridges ──X-Camera-Token──► camera-ingest ──► Storage + camera_images
pg_cron (every minute) ──WORKER_SECRET──► process-jobs ──► vision provider · MET Norway / Open-Meteo · Resend · Web Push
```

## Data model (public schema)
| Table | Purpose |
|---|---|
| `organizations`, `memberships`, `invitations`, `profiles` | Tenancy. Roles: `viewer < member < admin < owner`. Invitation tokens stored as SHA-256 only. |
| `audit_events` | Generic audit trigger on key tables; records changed column *names*, not values (protects coordinates). |
| `hunting_areas`, `map_features` | GeoJSON (WGS84) in `jsonb`, validated by trigger, with derived bbox columns for viewport filtering. Kind/geometry consistency is enforced. |
| `cameras`, `camera_ingest_tokens` | Cameras; ingest token hashes live in a table with no client policies. |
| `camera_images`, `image_tags` | Image library. `unique(org_id, sha256)` blocks exact duplicates; `phash` enables burst detection. Clients may only edit `camera_id`/capture time; analysis fields belong to the worker. |
| `detections` (+ `detections_view`) | AI/manual detections. `public.detection_tier()` derives confirmed/probable/uncertain/rejected from review state, source and the org's threshold. A trigger keeps the AI's original species when a reviewer corrects it and stamps reviewer + time. |
| `camera_events` (view) | One row per (image, species) excluding duplicates, rejected detections and non-animals. Basis of analytics. |
| `hunt_sessions`, `session_participants`, `observations`, `harvests` | Journal. Participants must be org members (or guests). Photo paths must sit under the org's storage folder. |
| `notification_rules`, `notification_preferences`, `notifications`, `notification_deliveries`, `push_subscriptions` | Per-user alert rules and delivery tracking. |
| `jobs` | Postgres job queue (`FOR UPDATE SKIP LOCKED`, exponential backoff, stale-lock recovery, dedupe keys). |
| `weather_cache` | Provider response cache. Service role only, so other teams' coordinates never leak. |

Analytics are SQL functions (`analytics_*`, `search_images`) declared `SECURITY INVOKER`, so RLS applies.

## Security model
- RLS on every table; `private.has_role()` is `SECURITY DEFINER` to avoid recursive policy evaluation and lives in a non-exposed schema.
- `org_id` and `created_by` are immutable via triggers; composite FKs keep references inside one org.
- Owners can't be removed or demoted unless another owner remains; only owners grant or revoke ownership.
- Column-level grants restrict what members can update on images, detections and notifications.
- Storage objects are namespaced `<org_id>/...`; policies mirror row access. Deletes are limited to admins or the uploader.
- Edge functions authenticate by user JWT (weather, invitations), a shared worker secret (process-jobs) or a hashed per-camera token (camera-ingest, rate-limited to 30 images/min). Invitations are rate-limited to 30/hour per org.
- Coordinates sent to weather providers are rounded to ~1 km.

## AI trail-camera pipeline
1. Upload (browser computes SHA-256 + dHash) or ingest → `camera_images` row (`pending`) → trigger enqueues `analyze_image`.
2. Worker: download → EXIF capture time (converted from the team time zone) → perceptual hash → near-duplicate check (same camera, ±90 s, Hamming ≤ 6) → weather at capture time → vision provider.
3. `normalizeDetections()` maps provider labels (common, Swedish, scientific or taxonomy strings) to catalogue codes, clamps values, merges per species and infers counts only from multiple boxes.
4. Status: `analyzed`, or `needs_review` when any detection is below the threshold or unidentified. No provider configured → `needs_review` with a clear message.
5. `evaluate_event` matches the team members' rules and creates notifications; `dispatch_notification` delivers email/push with retries, quiet hours and expired-subscription cleanup.

Providers implement `VisionProvider` (`supabase/functions/_shared/vision/types.ts`). Add a new one by implementing `analyze()` and registering it in `vision/index.ts`.

## Frontend
- Routes are code-split; MapLibre (~1 MB) only loads with the map.
- TanStack Query for server state, with toast-feedback mutations (`useAction`) and targeted invalidation.
- Offline outbox (`lib/outbox.ts`) for field observations, synced on reconnect.
- Design tokens in `styles.css` (light + dark); chart palette validated for colour-vision deficiency.
