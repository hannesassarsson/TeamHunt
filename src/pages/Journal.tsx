import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Download, Play, Target, Eye, Clock } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useMembers } from "@/lib/hooks";
import type { Harvest, HuntSession, Observation } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, ErrorState, PageHeader, PageLoader, Stat, Segmented } from "@/components/ui/misc";
import { SessionForm, HUNT_TYPES } from "@/components/SessionForm";
import { WeatherSummary } from "@/components/weather";
import { downloadFile, fmt, toCsv } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";

function seasonStart(): Date {
  // Nordic hunting year runs 1 July – 30 June.
  const now = new Date();
  return new Date(now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1, 6, 1);
}

export default function Journal() {
  const { org, can } = useOrg();
  const members = useMembers();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<"season" | "year" | "all">("season");
  const from = range === "season" ? seasonStart() : range === "year" ? new Date(Date.now() - 365 * 86_400_000) : null;

  const q = useQuery({
    queryKey: ["sessions", org?.id, range],
    enabled: !!org,
    queryFn: async () => {
      let s = supabase.from("hunt_sessions").select("*").eq("org_id", org!.id).order("started_at", { ascending: false }).limit(500);
      let h = supabase.from("harvests").select("*").eq("org_id", org!.id).limit(2000);
      let o = supabase.from("observations").select("id, session_id, species_code, count, observed_at").eq("org_id", org!.id).not("session_id", "is", null).limit(5000);
      if (from) { s = s.gte("started_at", from.toISOString()); h = h.gte("harvested_at", from.toISOString()); o = o.gte("observed_at", from.toISOString()); }
      const [sessions, harvests, obs] = await Promise.all([s, h, o]);
      return { sessions: unwrap(sessions) as HuntSession[], harvests: unwrap(harvests) as Harvest[], observations: unwrap(obs) as Observation[] };
    },
  });
  const d = q.data;
  const hours = d?.sessions.reduce((acc, s) => acc + (s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000 : 0), 0) ?? 0;
  const harvestBySpecies = Object.entries((d?.harvests ?? []).reduce<Record<string, number>>((a, h) => ({ ...a, [h.species_code]: (a[h.species_code] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const memberName = (id: string | null) => members.data?.find((m) => m.user_id === id)?.display_name ?? "";

  const exportCsv = (kind: "sessions" | "harvests") => {
    if (!d) return;
    if (kind === "sessions") downloadFile(`hunt-sessions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(d.sessions.map((s) => ({
      title: s.title, type: s.hunt_type, started_at: s.started_at, ended_at: s.ended_at, lat: s.lat, lon: s.lon,
      observations: d.observations.filter((o) => o.session_id === s.id).length, harvests: d.harvests.filter((h) => h.session_id === s.id).length,
      temperature_c: s.weather?.temperature_c, wind_ms: s.weather?.wind_speed_ms, wind_dir_deg: s.weather?.wind_dir_deg, weather_kind: s.weather?.kind, notes: s.notes,
    }))), "text/csv");
    else downloadFile(`harvests-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(d.harvests.map((h) => ({
      harvested_at: h.harvested_at, species: speciesLabel(h.species_code), sex: h.sex, age_class: h.age_class, weight_kg: h.weight_kg, antler_points: h.antler_points,
      shooter: h.shooter_name ?? memberName(h.shooter_user_id), lat: h.lat, lon: h.lon, notes: h.notes,
    }))), "text/csv");
  };

  const active = d?.sessions.filter((s) => !s.ended_at) ?? [];

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader title="Hunting journal" description="Sessions, participants, observations and harvest records."
        actions={<>
          <Button variant="outline" onClick={() => exportCsv("sessions")} disabled={!d?.sessions.length}><Download /> Sessions</Button>
          <Button variant="outline" onClick={() => exportCsv("harvests")} disabled={!d?.harvests.length}><Download /> Harvests</Button>
          {can("member") && <Button onClick={() => setOpen(true)}><Play /> Start hunt</Button>}
        </>} />
      <Segmented className="mb-4" value={range} onChange={setRange} options={[{ value: "season", label: "This season" }, { value: "year", label: "12 months" }, { value: "all", label: "All" }]} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <PageLoader /> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Sessions" value={d!.sessions.length} icon={BookOpen} />
            <Stat label="Hours in the field" value={fmt.num(hours, 0)} icon={Clock} />
            <Stat label="Observations in sessions" value={d!.observations.length} icon={Eye} />
            <Stat label="Harvested" value={d!.harvests.length} icon={Target} tone="accent" sub={harvestBySpecies.slice(0, 3).map(([s, n]) => `${speciesLabel(s)} ${n}`).join(" · ") || undefined} />
          </div>
          {active.length > 0 && (
            <div className="mb-4 space-y-2">
              {active.map((s) => (
                <Link key={s.id} to={`/journal/${s.id}`} className="flex items-center justify-between rounded-xl border border-accent/50 bg-accent-soft px-4 py-3">
                  <span className="flex items-center gap-2 font-semibold"><span className="size-2 animate-pulse rounded-full bg-accent" /> {s.title} · in progress since {fmt.time(s.started_at)}</span>
                  <span className="text-sm text-accent">Open →</span>
                </Link>
              ))}
            </div>
          )}
          {!d!.sessions.length ? (
            <EmptyState icon={BookOpen} title="No hunts recorded" description="Start a hunt when you head out. Observations and harvests you log are linked to it automatically." action={can("member") && <Button onClick={() => setOpen(true)}><Play /> Start hunt</Button>} />
          ) : (
            <ul className="space-y-2">
              {d!.sessions.map((s) => {
                const obs = d!.observations.filter((o) => o.session_id === s.id);
                const hv = d!.harvests.filter((h) => h.session_id === s.id);
                return (
                  <li key={s.id}>
                    <Link to={`/journal/${s.id}`}>
                      <Card className="p-4 transition hover:border-primary/60">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="font-display font-semibold">{s.title}</h3>
                            <p className="text-xs text-muted">{fmt.dateTime(s.started_at)}{s.ended_at ? ` – ${fmt.time(s.ended_at)}` : " · in progress"}{s.hunt_type ? ` · ${HUNT_TYPES[s.hunt_type]}` : ""}</p>
                          </div>
                          <div className="flex gap-1.5">
                            {obs.length > 0 && <Badge tone="info">{obs.length} obs.</Badge>}
                            {hv.length > 0 && <Badge tone="accent">{hv.map((h) => speciesLabel(h.species_code)).join(", ")}</Badge>}
                          </div>
                        </div>
                        {s.weather && <div className="mt-2"><WeatherSummary w={s.weather} compact /></div>}
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <SessionForm open={open} onOpenChange={setOpen} onSaved={(s) => navigate(`/journal/${s.id}`)} />
    </div>
  );
}
