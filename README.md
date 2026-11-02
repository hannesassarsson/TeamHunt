# NORDHUNT

Hunting and wildlife intelligence for Nordic hunting teams: GIS maps, AI-assisted trail camera
analysis, a field journal, weather, team collaboration and analytics.

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 · MapLibre GL · Recharts · TanStack Query ·
Supabase (Postgres with Row Level Security, Auth, Storage, Realtime, Edge Functions on Deno).

## Features

| Area | What it does |
|---|---|
| **Map & GIS** | Satellite / terrain / standard base layers; hunting areas, stands, feeding stations, salt licks, markers, parking, paths, tracking routes and zones; cameras, observations and harvests as layers; draw, live distance/area measurement, search, layer toggles, time-window filter, GeoJSON import/export, "place camera on map". |
| **Trail camera AI** | Browser upload or direct camera ingest (per-camera token). SHA-256 exact-duplicate guard and perceptual-hash burst detection. EXIF capture time. Swappable vision providers (Claude, any HTTP detector such as MegaDetector/SpeciesNet, or none = manual review). Nordic species catalogue (39 classes, sv/no/fi names). Detections are **confirmed** (verified by a person), **probable** (AI ≥ team threshold) or **uncertain**. Review queue, bulk review and C/R keyboard shortcuts, corrections that keep the AI's original guess, manual detections, tags, re-analysis, thumbnails, EXIF GPS camera-position suggestions, searchable library. |
| **Wildlife analytics** | Activity by hour (team time zone), daily/weekly trend, species distribution by confidence tier, seasonal year-over-year, camera activity, weather correlation with sample sizes. Counts are *camera events*, never claimed as individual animals. |
| **Journal** | Hunt sessions with participants (members or guests), observations, harvest records with photos, automatic weather snapshot, season statistics, CSV/GeoJSON export. Mobile-first quick observation with GPS. The app launches offline (cached shell) and observations sync when back online. |
| **Sun & moon** | Civil dawn/dusk, sunrise/sunset, midnight sun/polar night, moon phase, and activity relative to sunrise/sunset. |
| **Weather** | MET Norway forecast and Open-Meteo modelled history, always labelled *forecast* vs *historical (modelled)*. Wind direction with scent (downwind) bearing. Weather is attached to camera images and observations automatically. |
| **Teams** | Organisations with owner/admin/member/viewer roles, hashed email invitations, strict data isolation via RLS, audit log. |
| **Notifications** | Per-user rules (species detected, any animal, camera offline, new observation, harvest, daily summary), tier and camera filters, in-app (realtime), Web Push and email, quiet hours. |

## Quick start

```bash
npm install
cp .env.example .env.local    # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

You need a Supabase project with the migrations in `supabase/migrations` applied and the edge
functions deployed. Step-by-step instructions, every environment variable and the worker schedule
are in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and production build |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:db` | Apply all migrations to a throwaway Postgres and run the SQL/RLS test suites |
| `npm run test:functions` | Deno tests, type check and lint for edge functions |
| `npm run check` | Lint + types + tests + build |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system design, data model, security model, AI pipeline
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): setup, configuration, credentials, scheduling
- [docs/AUDIT.md](docs/AUDIT.md): audit findings, technical debt and roadmap
- [CLAUDE.md](CLAUDE.md): conventions for contributors and coding agents
