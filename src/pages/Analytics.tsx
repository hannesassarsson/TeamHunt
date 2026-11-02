import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { BarChart3, Info, Table2 } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { EmptyState, ErrorState, PageHeader, PageLoader, Segmented, Stat } from "@/components/ui/misc";
import { SpeciesSelect } from "@/components/species";
import { ChartTable, ChartTooltip, LegendItems, useChartColors } from "@/components/charts";
import { fmt, startOfDayDaysAgo } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";
import { sunRelativeHistogram } from "@shared/domain/sun.ts";
import { tierRank } from "@shared/domain/tiers.ts";
import { useCameras } from "@/lib/hooks";

interface SpeciesRow { species_code: string; camera_events: number; confirmed_events: number; probable_events: number; uncertain_events: number; observations: number; harvests: number; last_seen: string | null }
interface HourRow { hour: number; camera_events: number; observations: number }
interface DayRow { day: string; images: number; camera_events: number; observations: number }
interface MonthRow { year: number; month: number; camera_events: number; observations: number; harvests: number }
interface WeatherRow { dimension: string; bucket: string; sort_key: number; images: number; animal_images: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN_SAMPLE = 20;

export default function Analytics() {
  const { org } = useOrg();
  const colors = useChartColors();
  const [days, setDays] = useState("90");
  const [species, setSpecies] = useState("");
  const [minTier, setMinTier] = useState("uncertain");
  const [tables, setTables] = useState(false);
  const from = startOfDayDaysAgo(Number(days)).toISOString();
  const to = new Date().toISOString();
  const sp = species ? [species] : null;

  const q = useQuery({
    queryKey: ["analytics", org?.id, days, species, minTier],
    enabled: !!org,
    queryFn: async () => {
      const [summary, hours, daily, monthly, weather] = await Promise.all([
        supabase.rpc("analytics_species_summary", { p_org: org!.id, p_from: from, p_to: to }),
        supabase.rpc("analytics_activity_by_hour", { p_org: org!.id, p_from: from, p_to: to, p_species: sp, p_min_tier: minTier }),
        supabase.rpc("analytics_daily", { p_org: org!.id, p_from: from, p_to: to, p_species: sp }),
        supabase.rpc("analytics_monthly", { p_org: org!.id, p_years: 3, p_species: sp }),
        supabase.rpc("analytics_weather", { p_org: org!.id, p_from: from, p_to: to, p_species: sp }),
      ]);
      return {
        summary: unwrap(summary) as SpeciesRow[], hours: unwrap(hours) as HourRow[], daily: unwrap(daily) as DayRow[],
        monthly: unwrap(monthly) as MonthRow[], weather: unwrap(weather) as WeatherRow[],
      };
    },
  });
  const d = q.data;
  const cameras = useCameras();
  const sunQ = useQuery({
    queryKey: ["analytics-sun", org?.id, days, species, minTier],
    enabled: !!org,
    queryFn: async () => {
      let ce = supabase.from("camera_events").select("at, camera_id, species_code, tier_rank").eq("org_id", org!.id).gte("at", from).lt("at", to).gte("tier_rank", tierRank(minTier)).limit(10000);
      let ob = supabase.from("observations").select("observed_at, lat, lon, species_code").eq("org_id", org!.id).gte("observed_at", from).lt("observed_at", to).not("lat", "is", null).limit(10000);
      if (species) { ce = ce.eq("species_code", species); ob = ob.eq("species_code", species); }
      const [a, b] = await Promise.all([ce, ob]);
      return { events: unwrap(a) as { at: string; camera_id: string | null }[], obs: unwrap(b) as { observed_at: string; lat: number; lon: number }[] };
    },
  });
  const sunHist = useMemo(() => {
    if (!sunQ.data) return null;
    const pos = new Map((cameras.data ?? []).filter((c) => c.lat != null).map((c) => [c.id, { lat: c.lat!, lon: c.lon! }]));
    const located = [
      ...sunQ.data.events.flatMap((e) => (e.camera_id && pos.has(e.camera_id) ? [{ at: e.at, ...pos.get(e.camera_id)! }] : [])),
      ...sunQ.data.obs.map((o) => ({ at: o.observed_at, lat: o.lat, lon: o.lon })),
    ];
    const h = sunRelativeHistogram(located);
    const label = (o: number) => `${o >= 0 ? "+" : "−"}${Math.abs(o) / 60 >= 1 ? `${Math.floor(Math.abs(o) / 60)}h` : ""}${Math.abs(o) % 60 ? `${Math.abs(o) % 60}m` : Math.abs(o) < 60 ? "0" : ""}`;
    return { rows: h.buckets.map((b) => ({ ...b, label: label(b.offset) })), outside: h.outside, total: located.length, unlocated: sunQ.data.events.length - sunQ.data.events.filter((e) => e.camera_id && pos.has(e.camera_id)).length };
  }, [sunQ.data, cameras.data]);

  const years = useMemo(() => [...new Set((d?.monthly ?? []).map((m) => m.year))].sort(), [d?.monthly]);
  const seasonal = useMemo(() => MONTHS.map((label, i) => {
    const row: Record<string, number | string> = { month: label };
    for (const y of years) {
      const m = d?.monthly.find((x) => x.year === y && x.month === i + 1);
      row[String(y)] = (m?.camera_events ?? 0) + (m?.observations ?? 0);
    }
    return row;
  }), [d?.monthly, years]);
  const daily = useMemo(() => {
    const rows = d?.daily ?? [];
    if (rows.length <= 120) return rows.map((r) => ({ ...r, label: r.day }));
    // Weekly buckets for long ranges keep bars readable.
    const out: (DayRow & { label: string })[] = [];
    for (let i = 0; i < rows.length; i += 7) {
      const chunk = rows.slice(i, i + 7);
      out.push({ day: chunk[0].day, label: `w/c ${chunk[0].day}`, images: chunk.reduce((a, r) => a + r.images, 0), camera_events: chunk.reduce((a, r) => a + r.camera_events, 0), observations: chunk.reduce((a, r) => a + r.observations, 0) });
    }
    return out;
  }, [d?.daily]);
  const filteredSummary = (d?.summary ?? []).filter((r) => !species || r.species_code === species);
  const totals = filteredSummary.reduce((a, r) => ({ events: a.events + r.camera_events, confirmed: a.confirmed + r.confirmed_events, obs: a.obs + r.observations, harvests: a.harvests + r.harvests }), { events: 0, confirmed: 0, obs: 0, harvests: 0 });
  const peakHour = d?.hours.reduce((best, h) => (h.camera_events + h.observations > best.camera_events + best.observations ? h : best), d.hours[0]);
  const axis = { tick: { fill: colors.muted, fontSize: 11 }, axisLine: false, tickLine: false } as const;
  const weatherDims = ["temperature", "wind", "precipitation"].map((dim) => ({ dim, rows: (d?.weather ?? []).filter((w) => w.dimension === dim).map((w) => ({ ...w, rate: w.images ? w.animal_images / w.images : 0 })) }));

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageHeader title="Wildlife analytics" description="Patterns from your team's camera detections, observations and harvests."
        actions={<button onClick={() => setTables((t) => !t)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2" aria-pressed={tables}><Table2 className="size-4" /> {tables ? "Charts" : "Tables"}</button>} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented value={days} onChange={setDays} options={[{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }, { value: "365", label: "12m" }, { value: "1095", label: "3y" }]} />
        <div className="w-56"><SpeciesSelect value={species} onChange={setSpecies} placeholder="All species" /></div>
        <Select className="w-52" value={minTier} onChange={(e) => setMinTier(e.target.value)} aria-label="Minimum classification">
          <option value="uncertain">All AI classifications</option><option value="probable">Probable & confirmed</option><option value="confirmed">Confirmed only</option>
        </Select>
      </div>
      <p className="mb-5 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        A camera event is one image in which a species was detected; duplicate bursts are excluded. Events are not individual animals: the same animal can appear many times, and NORDHUNT does not identify individuals.
      </p>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <PageLoader /> : !d || (!d.summary.length && !d.daily.some((x) => x.images)) ? (
        <EmptyState icon={BarChart3} title="Not enough data yet" description="Analytics appear once camera images are analysed or observations are recorded in this period." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Camera events" value={fmt.num(totals.events)} sub={`${fmt.num(totals.confirmed)} confirmed`} />
            <Stat label="Observations" value={fmt.num(totals.obs)} />
            <Stat label="Harvests" value={fmt.num(totals.harvests)} />
            <Stat label="Peak activity" value={peakHour && peakHour.camera_events + peakHour.observations > 0 ? `${String(peakHour.hour).padStart(2, "0")}:00` : "–"} sub={org?.timezone} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Activity by time of day" description="Camera events and observations per hour" action={<LegendItems items={[{ label: "Camera events", color: colors.series[0] }, { label: "Observations", color: colors.series[1] }]} />} />
              <CardBody className={tables ? "" : "h-64"}>
                {tables ? <ChartTable columns={[{ key: "hour", label: "Hour" }, { key: "camera_events", label: "Camera events" }, { key: "observations", label: "Observations" }]} rows={d.hours.map((h) => ({ ...h, hour: `${String(h.hour).padStart(2, "0")}:00` }))} /> : (
                  <ResponsiveContainer>
                    <BarChart data={d.hours} barGap={2}>
                      <CartesianGrid vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="hour" {...axis} interval={2} />
                      <YAxis allowDecimals={false} {...axis} width={30} />
                      <Tooltip content={<ChartTooltip labelFormatter={(h) => `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59`} />} cursor={{ fill: colors.grid, opacity: 0.4 }} />
                      <Bar dataKey="camera_events" name="Camera events" fill={colors.series[0]} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="observations" name="Observations" fill={colors.series[1]} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={daily.length && daily[0].label.startsWith("w/c") ? "Weekly trend" : "Daily trend"} description="Camera events and observations" action={<LegendItems items={[{ label: "Camera events", color: colors.series[0] }, { label: "Observations", color: colors.series[1] }]} />} />
              <CardBody className={tables ? "" : "h-64"}>
                {tables ? <ChartTable columns={[{ key: "label", label: "Period" }, { key: "images", label: "Images" }, { key: "camera_events", label: "Camera events" }, { key: "observations", label: "Observations" }]} rows={daily} /> : (
                  <ResponsiveContainer>
                    <LineChart data={daily}>
                      <CartesianGrid vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="day" {...axis} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                      <YAxis allowDecimals={false} {...axis} width={30} />
                      <Tooltip content={<ChartTooltip labelFormatter={(l) => String(l)} />} cursor={{ stroke: colors.muted, strokeDasharray: "3 3" }} />
                      <Line type="monotone" dataKey="camera_events" name="Camera events" stroke={colors.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} />
                      <Line type="monotone" dataKey="observations" name="Observations" stroke={colors.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Species distribution" description="Camera events by classification tier, plus field observations and harvests"
              action={<LegendItems items={[{ label: "Confirmed", color: colors.tiers.confirmed }, { label: "Probable", color: colors.tiers.probable }, { label: "Uncertain", color: colors.tiers.uncertain }]} />} />
            <CardBody>
              {!filteredSummary.length ? <p className="text-sm text-muted">No species recorded in this period.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted"><th className="py-2 pr-3 font-medium">Species</th><th className="w-[40%] py-2 pr-3 font-medium">Camera events</th><th className="py-2 pr-3 text-right font-medium">Obs.</th><th className="py-2 pr-3 text-right font-medium">Harvest</th><th className="py-2 text-right font-medium">Last seen</th></tr></thead>
                    <tbody>
                      {filteredSummary.map((r) => {
                        const max = Math.max(...filteredSummary.map((x) => x.camera_events), 1);
                        return (
                          <tr key={r.species_code} className="border-t border-border">
                            <td className="py-2 pr-3 font-medium">{speciesLabel(r.species_code)}</td>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-2">
                                <div className="flex h-3 flex-1 gap-[2px] overflow-hidden" title={`${r.confirmed_events} confirmed · ${r.probable_events} probable · ${r.uncertain_events} uncertain`}>
                                  {[["confirmed", r.confirmed_events], ["probable", r.probable_events], ["uncertain", r.uncertain_events]].map(([t, n]) => Number(n) > 0 && (
                                    <div key={t as string} className="h-full first:rounded-l last:rounded-r" style={{ width: `${(Number(n) / max) * 100}%`, background: colors.tiers[t as "confirmed"] }} />
                                  ))}
                                </div>
                                <span className="w-10 text-right tabular">{r.camera_events}</span>
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right tabular">{r.observations}</td>
                            <td className="py-2 pr-3 text-right tabular">{r.harvests}</td>
                            <td className="py-2 text-right text-xs text-muted">{fmt.date(r.last_seen)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity around sunrise and sunset" description="Camera events (cameras with a position) and observations, in 30-minute steps relative to the nearest sunrise or sunset" />
            <CardBody>
              {!sunHist || sunHist.total === 0 ? <p className="text-sm text-muted">Needs camera events from positioned cameras, or observations with GPS.</p> : tables ? (
                <ChartTable columns={[{ key: "label", label: "Offset" }, { key: "sunrise", label: "Around sunrise" }, { key: "sunset", label: "Around sunset" }]} rows={sunHist.rows} />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {(["sunrise", "sunset"] as const).map((k, i) => (
                    <div key={k}>
                      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{k === "sunrise" ? "Around sunrise" : "Around sunset"}</h4>
                      <div className="h-44">
                        <ResponsiveContainer>
                          <BarChart data={sunHist.rows}>
                            <CartesianGrid vertical={false} stroke={colors.grid} />
                            <XAxis dataKey="label" {...axis} interval={1} />
                            <YAxis allowDecimals={false} {...axis} width={30} />
                            <Tooltip content={<ChartTooltip labelFormatter={(l) => `${l} from ${k}`} />} cursor={{ fill: colors.grid, opacity: 0.4 }} />
                            <Bar dataKey={k} name="Events" fill={colors.series[i === 0 ? 3 : 1]} radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {sunHist && sunHist.total > 0 && <p className="mt-2 text-[11px] text-muted">{sunHist.total - sunHist.outside} of {sunHist.total} located events fall within ±3 h of sunrise or sunset.{sunHist.unlocated > 0 && ` ${sunHist.unlocated} camera events are excluded because the camera has no position.`}</p>}
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Seasonal pattern" description="Camera events + observations per month, compared year over year" action={<LegendItems items={years.map((y, i) => ({ label: String(y), color: colors.series[i % 4] }))} />} />
              <CardBody className={tables ? "" : "h-64"}>
                {tables ? <ChartTable columns={[{ key: "month", label: "Month" }, ...years.map((y) => ({ key: String(y), label: String(y) }))]} rows={seasonal} /> : (
                  <ResponsiveContainer>
                    <LineChart data={seasonal}>
                      <CartesianGrid vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="month" {...axis} />
                      <YAxis allowDecimals={false} {...axis} width={30} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.muted, strokeDasharray: "3 3" }} />
                      {years.map((y, i) => <Line key={y} type="monotone" dataKey={String(y)} name={String(y)} stroke={colors.series[i % 4]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5, stroke: colors.surface, strokeWidth: 2 }} />)}
                      <Legend wrapperStyle={{ display: "none" }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Weather correlation" description="Share of camera images with the selected species, by weather at capture time (model data, not station measurements)" />
              <CardBody className="space-y-4">
                {weatherDims.every((w) => !w.rows.length) ? <p className="text-sm text-muted">No weather-enriched images yet. Weather is attached automatically when a camera has a position.</p> :
                  weatherDims.filter((w) => w.rows.length).map(({ dim, rows }) => (
                    <div key={dim}>
                      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{dim}</h4>
                      <ul className="space-y-1">
                        {rows.map((r) => (
                          <li key={r.bucket} className="grid grid-cols-[120px_1fr_88px] items-center gap-2 text-xs">
                            <span className="truncate">{r.bucket}</span>
                            <div className="h-2.5 rounded bg-surface-2"><div className="h-full rounded" style={{ width: `${r.rate * 100}%`, background: colors.series[0], opacity: r.images < MIN_SAMPLE ? 0.45 : 1 }} /></div>
                            <span className="text-right tabular text-muted">{fmt.pct(r.rate)} <span className="opacity-70">n={r.images}</span></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                <p className="text-[11px] text-muted">Faded bars have fewer than {MIN_SAMPLE} images and are not reliable. Correlation is not causation.</p>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
