# NORDHUNT: contributor and agent guide

## Layout
- `src/`: React SPA. `pages/` are lazy-loaded routes, `components/ui/` are design-system primitives, `lib/` holds the data/clients/helpers.
- `supabase/functions/_shared/domain/`: **pure, dependency-free TypeScript** shared by the frontend (`@shared/*` alias) and the Deno edge functions. Keep it free of DOM/Deno APIs and use explicit `.ts` import extensions.
- `supabase/functions/*/index.ts`: edge functions (Deno). `_shared/` holds Deno-only adapters (vision, weather, notify, images).
- `supabase/migrations/`: ordered SQL migrations. **Never edit a migration that has been deployed; add a new one.**
- `supabase/tests/`: SQL tests run by `scripts/test-db.sh` against plain Postgres with a Supabase stub (`00_supabase_stub.sql`).

## Rules
- Every tenant table has `org_id`, RLS enabled, and policies using `private.has_role(org_id, '<min role>')`. Add a test in `supabase/tests/` for every new table or policy.
- Cross-table references inside an org use composite FKs `(x_id, org_id)` so rows can't point into another org.
- AI must never produce "confirmed" results: only people confirm. Never store attributes a model did not observe (no sex/age/weight/individual identity from images).
- Weather values must carry `kind` (`forecast` | `historical` | `observed`) and `source`.
- Don't fabricate integrations. If a credential is missing, the adapter returns `skipped` and the UI says so.
- Secrets live only in edge-function env. The frontend only uses the public anon key.
- UI: use tokens from `src/styles.css` (no hard-coded colours). Chart colours come from `components/charts.tsx` (validated palette). Every interactive element must do something real.

## Before pushing
`npm run check && npm run test:db && npm run test:functions`
