# Audit, technical debt and roadmap

## Starting point (2026-11-02)
The `TeamHunt` repository designated for NORDHUNT was **empty**: no commits, no branches and no code.
The two other repositories in the workspace (`my-rent-life`, `hemmaliv-shared-home`) are unrelated
apps. There was nothing to audit, so NORDHUNT was built from scratch. It uses the same
Vite/React/Tailwind/Supabase stack as the owner's other projects to stay consistent with their
Lovable/Supabase workflow.

## What was verified
| Check | Result |
|---|---|
| SQL migrations on Postgres 16 + RLS/integrity suites (`npm run test:db`) | 4 suites pass: tenancy & isolation, domain flows, search & re-analysis, hardening |
| Unit/component tests (`npm test`) | 34 pass (domain logic, GIS import/measure/export, form accessibility, formatting) |
| Edge functions (`deno check`, `deno lint`, `deno test`) | Pass |
| ESLint, TypeScript strict, production build | Pass |
| Browser smoke test (Playwright, mocked Supabase API) | 14 routes × desktop/mobile render without errors or horizontal scroll; drawing, measuring, quick observation, detection review and GeoJSON export send the expected writes |

**Not verified:** a live Supabase project, real vision providers, MET Norway/Open-Meteo calls from
the deployed function, Resend and Web Push delivery. These need the credentials listed in
DEPLOYMENT.md.

## Known limitations / technical debt
1. **Spatial model:** GeoJSON in `jsonb` plus bbox columns rather than PostGIS. Fine for team-scale data; for server-side spatial joins (e.g. "observations inside area X") add a PostGIS geometry column alongside.
2. **No generated DB types:** `src/lib/types.ts` is hand-maintained. Run `supabase gen types` once a project is linked and switch the client to the generated `Database` type.
3. **Weather "observed" kind is unused:** historical data is modelled (ERA5 / model analysis). A station adapter (SMHI open data, Frost API for Norway) would add real measurements.
4. **Worker throughput:** one invocation per minute with a 45 s budget, about 30–60 images/minute with an LLM provider. For large backfills, invoke more often or run several workers (the queue is safe for concurrency).
5. **Images are served at full size:** no thumbnail derivatives yet. Supabase image transformations (paid) or a resize step in the worker would cut bandwidth on mobile.
6. **Offline support covers observations only:** the app shell is not cached for offline launch (no precaching service worker).
7. **English UI only:** species are shown with Swedish names, but there is no i18n layer.
8. **Rate limiting** in the weather function is per instance (in memory). Camera ingest and invitations are limited in the database.
9. **Tile providers:** the default tiles are community/free services with usage policies. Configure production tiles.
10. **No e2e test against a real Supabase stack** in CI (no Docker locally). Add `supabase start` + Playwright in CI.

## Roadmap (recommended next milestones)
1. **Connect a Supabase project:** apply migrations, deploy functions, set `WORKER_SECRET`, schedule the worker, generate DB types, run a real end-to-end pass.
2. **Enable AI:** set `VISION_PROVIDER` + key; evaluate accuracy on a labelled set of your own trail-camera images and tune the probable threshold per team. Consider a self-hosted MegaDetector + SpeciesNet service via the HTTP adapter for cost at volume.
3. **Thumbnails + EXIF GPS:** generate 480 px thumbnails in the worker; read GPS from EXIF to suggest camera positions.
4. **Bulk review:** multi-select in the library (confirm/reject/assign camera/tag), plus keyboard shortcuts for rapid review.
5. **PostGIS + area analytics:** observations and detections per hunting area, heatmaps on the map.
6. **i18n (sv/no/fi/en)** and Swedish as default for Swedish teams.
7. **Station weather + moon/sun phase** correlation (sunrise/sunset-relative activity is highly relevant for hunting).
8. **Offline map tiles and app shell** for areas without coverage.
9. **Admin console:** usage, storage quotas, job queue monitoring and failed-job retry.
10. **Native wrapper** (Capacitor) for background GPS tracks during drives.
