import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { CloudOff, Download, Eye, MapPin, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { useAction, useMembers } from "@/lib/hooks";
import type { Observation } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Badge, EmptyState, ErrorState, PageHeader, PageLoader, Segmented } from "@/components/ui/misc";
import { SpeciesName, SpeciesSelect } from "@/components/species";
import { WeatherSummary } from "@/components/weather";
import { QuickObservation } from "@/components/QuickObservation";
import { discardOutboxItem, getOutbox, subscribeOutbox, syncOutbox } from "@/lib/outbox";
import { downloadFile, fmt, startOfDayDaysAgo, toCsv } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";

const KIND_LABEL: Record<string, string> = { sighting: "Sighting", track: "Tracks", scat: "Droppings", sound: "Heard", bed: "Bed", browsing: "Browsing", carcass: "Carcass", other: "Other" };

export default function Observations() {
  const { org, can } = useOrg();
  const { userId } = useAuth();
  const members = useMembers();
  const [days, setDays] = useState("30");
  const [species, setSpecies] = useState("");
  const [kind, setKind] = useState("");
  const [who, setWho] = useState("");
  const [open, setOpen] = useState(false);
  const outbox = useSyncExternalStore(subscribeOutbox, () => JSON.stringify(getOutbox()));
  const pending = JSON.parse(outbox) as ReturnType<typeof getOutbox>;

  const q = useQuery({
    queryKey: ["observations", org?.id, days, species, kind, who],
    enabled: !!org,
    queryFn: async () => {
      let query = supabase.from("observations").select("*").eq("org_id", org!.id).order("observed_at", { ascending: false }).limit(500);
      if (days !== "0") query = query.gte("observed_at", startOfDayDaysAgo(Number(days)).toISOString());
      if (species) query = query.eq("species_code", species);
      if (kind) query = query.eq("kind", kind);
      if (who) query = query.eq("created_by", who);
      return unwrap(await query) as Observation[];
    },
  });
  const del = useAction(async (id: string) => unwrap(await supabase.from("observations").delete().eq("id", id).select("id")), { success: "Observation deleted", invalidate: [["observations"]] });
  const name = (id: string | null) => members.data?.find((m) => m.user_id === id)?.display_name || "Former member";

  const exportCsv = () => downloadFile(`observations-${new Date().toISOString().slice(0, 10)}.csv`, toCsv((q.data ?? []).map((o) => ({
    observed_at: o.observed_at, species: speciesLabel(o.species_code), species_code: o.species_code, kind: o.kind, count: o.count, lat: o.lat, lon: o.lon,
    accuracy_m: o.accuracy_m, observer: name(o.created_by), notes: o.notes, temperature_c: o.weather?.temperature_c, wind_ms: o.weather?.wind_speed_ms, weather_kind: o.weather?.kind,
  }))), "text/csv");
  const exportGeo = () => downloadFile(`observations-${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify({
    type: "FeatureCollection",
    features: (q.data ?? []).filter((o) => o.lat != null).map((o) => ({ type: "Feature", geometry: { type: "Point", coordinates: [o.lon, o.lat] }, properties: { species: o.species_code, kind: o.kind, count: o.count, observed_at: o.observed_at, notes: o.notes } })),
  }), "application/geo+json");

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader title="Observations" description="Sightings and sign recorded by the team in the field."
        actions={<>
          <Button variant="outline" onClick={exportCsv} disabled={!q.data?.length}><Download /> CSV</Button>
          <Button variant="outline" onClick={exportGeo} disabled={!q.data?.length}><Download /> GeoJSON</Button>
          {can("member") && <Button onClick={() => setOpen(true)}><Plus /> Record</Button>}
        </>} />

      {pending.length > 0 && (
        <Card className="mb-4 border-warning/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold"><CloudOff className="size-4 text-warning" /> Waiting to sync ({pending.length})</h3>
            <Button size="sm" variant="outline" onClick={async () => { const r = await syncOutbox(); toast.message(`${r.synced} synced, ${r.failed} failed`); }}><RefreshCw /> Sync now</Button>
          </div>
          <ul className="divide-y divide-border text-sm">
            {pending.map((p) => (
              <li key={p.local_id} className="flex items-center justify-between gap-2 py-2">
                <span>{speciesLabel(p.species_code)} · {fmt.dateTime(p.observed_at)}{p.last_error && <span className="block text-xs text-danger">{p.last_error}</span>}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Discard" onClick={() => { if (confirm("Discard this unsynced observation?")) discardOutboxItem(p.local_id); }}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={days} onChange={setDays} options={[{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "365", label: "1y" }, { value: "0", label: "All" }]} />
        <div className="w-52"><SpeciesSelect value={species} onChange={setSpecies} placeholder="All species" /></div>
        <Select className="w-36" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="">All types</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select className="w-40" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Observer"><option value="">Everyone</option>{members.data?.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email}</option>)}</Select>
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <PageLoader /> : !q.data?.length ? (
        <EmptyState icon={Eye} title="No observations" description="Tap the + button while you're out to log a sighting with GPS position. It works offline too." action={can("member") && <Button onClick={() => setOpen(true)}><Plus /> Record observation</Button>} />
      ) : (
        <ul className="space-y-2">
          {q.data.map((o) => (
            <Card key={o.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SpeciesName code={o.species_code} className="font-semibold" />
                  {o.count && <span className="text-sm text-muted">×{o.count}</span>}
                  <Badge tone="accent">{KIND_LABEL[o.kind]}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{fmt.dateTime(o.observed_at)} · {name(o.created_by)}{o.lat != null && <span className="ml-1 inline-flex items-center gap-0.5"><MapPin className="size-3" />{fmt.coord(o.lat, o.lon)}</span>}</p>
                {o.notes && <p className="mt-2 whitespace-pre-line text-sm">{o.notes}</p>}
                {o.weather && <div className="mt-2"><WeatherSummary w={o.weather} compact /></div>}
              </div>
              {(can("admin") || o.created_by === userId) && can("member") && (
                <Button size="icon-sm" variant="ghost" aria-label="Delete observation" onClick={() => { if (confirm("Delete this observation?")) del.mutate(o.id); }}><Trash2 /></Button>
              )}
            </Card>
          ))}
        </ul>
      )}
      <QuickObservation open={open} onOpenChange={setOpen} />
    </div>
  );
}
