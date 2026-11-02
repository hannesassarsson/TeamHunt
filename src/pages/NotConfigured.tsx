export function NotConfigured() {
  return (
    <div className="mx-auto mt-24 max-w-lg px-6">
      <h1 className="font-display text-2xl font-bold">NORDHUNT is not configured</h1>
      <p className="mt-3 text-sm text-muted">
        Set <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_URL</code> and <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_ANON_KEY</code> in
        <code className="rounded bg-surface-2 px-1"> .env.local</code> (see <code>.env.example</code> and <code>docs/DEPLOYMENT.md</code>), then restart the dev server.
      </p>
    </div>
  );
}
