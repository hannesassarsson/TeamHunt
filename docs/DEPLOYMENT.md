# Deployment

## 1. Supabase project
1. Create a project (Postgres 15+). Link the CLI: `supabase link --project-ref <ref>`.
2. Apply migrations: `supabase db push`. They are additive and non-destructive. They create the private storage buckets `camera-images` and `journal-photos`.
3. Auth → URL configuration: set the Site URL and redirect URLs to your frontend origin. Configure SMTP for production auth emails.
4. Enable **Realtime** (the migrations add `notifications` to the `supabase_realtime` publication).

## 2. Edge functions
```bash
supabase functions deploy process-jobs --no-verify-jwt
supabase functions deploy camera-ingest --no-verify-jwt
supabase functions deploy weather
supabase functions deploy send-invitation
supabase secrets set --env-file supabase/functions/.env   # see table below
```

### Environment variables (edge functions)
| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | auto | Provided by Supabase |
| `WORKER_SECRET` | **yes** | Shared secret for `process-jobs` (generate: `openssl rand -hex 32`) |
| `APP_URL` | recommended | Frontend origin for links in emails and invitations |
| `ALLOWED_ORIGINS` | recommended | Comma-separated CORS origins (default `*`) |
| `VISION_PROVIDER` | for AI | `anthropic`, `http` or empty (manual review only) |
| `ANTHROPIC_API_KEY` | if `anthropic` | Claude API key |
| `ANTHROPIC_VISION_MODEL` | optional | Defaults to `claude-opus-5-5`. A cheaper model can be set here for high image volumes. |
| `VISION_HTTP_URL`, `VISION_HTTP_TOKEN` | if `http` | Self-hosted detector (e.g. MegaDetector + SpeciesNet). Contract in `_shared/vision/http.ts`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email | Email notifications and invitations. Without them, invitations return a shareable link. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push | Web Push (generate with `npx web-push generate-vapid-keys`) |
| `WEATHER_USER_AGENT` | recommended | Identifying User-Agent required by MET Norway's terms |
| `OPEN_METEO_API_KEY` | for commercial use | Open-Meteo's free tier is non-commercial; the key switches to the customer endpoints |

## 3. Schedule the worker
In the SQL editor (enable the `pg_cron` and `pg_net` extensions first):
```sql
select cron.schedule('nordhunt-worker', '* * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/process-jobs',
    headers := jsonb_build_object('Authorization', 'Bearer <WORKER_SECRET>')
  );
$$);
```
The worker also schedules hourly camera-health checks and the daily summary (06:00 UTC), and prunes finished jobs older than 14 days.

## 4. Frontend
Build with `npm run build` and host `dist/` on any static host with SPA fallback to `index.html` (Vercel, Netlify, Cloudflare Pages, Supabase hosting).

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Required. Public by design; RLS protects the data. |
| `VITE_VAPID_PUBLIC_KEY` | Enables push subscription in the browser |
| `VITE_TILES_STANDARD`, `VITE_TILES_SATELLITE`, `VITE_TILES_TERRAIN` | Optional XYZ tile URLs. The defaults (OSM, Esri World Imagery, OpenTopoMap) are fine for development and small teams but have usage policies. Use a commercial provider or national mapping agency (Lantmäteriet, Kartverket, MML) with your own key in production. |

## 5. Camera ingest
Create a token on a camera's page (admins). Cameras or bridges POST JPEG/PNG/WebP to
`/functions/v1/camera-ingest` with `X-Camera-Token`, optionally `X-Captured-At` (ISO 8601) and
`X-Battery` (0–100). Most cellular trail cameras send email or FTP; use a mail-to-webhook or FTP
bridge to forward images to this endpoint.
