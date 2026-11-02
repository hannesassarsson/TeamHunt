import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CloudSun, Crosshair, Navigation, Wind } from "lucide-react";
import { toast } from "sonner";
import { invokeFunction } from "@/lib/supabase";
import { useAreas, useCameras } from "@/lib/hooks";
import { getPosition } from "@/lib/geolocation";
import { geometryCenter } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, PageHeader, PageLoader, Segmented } from "@/components/ui/misc";
import { WeatherIcon, WeatherKindBadge, WindArrow } from "@/components/weather";
import { ChartTooltip, useChartColors } from "@/components/charts";
import { SunMoonCard } from "@/components/sun";
import { fmt, getStored, setStored } from "@/lib/utils";
import { windDirectionLabel, downwindBearing, type WeatherSample } from "@shared/domain/weather.ts";

type Loc = { key: string; label: string; lat: number; lon: number };

export default function Weather() {
  const areas = useAreas();
  const cameras = useCameras();
  const colors = useChartColors();
  const [myPos, setMyPos] = useState<Loc | null>(null);
  const locations = useMemo<Loc[]>(() => [
    ...(myPos ? [myPos] : []),
    ...(areas.data ?? []).map((a) => { const [lon, lat] = geometryCenter(a.geometry); return { key: `a:${a.id}`, label: `${a.name} (area)`, lat, lon }; }),
    ...(cameras.data ?? []).filter((c) => c.lat != null).map((c) => ({ key: `c:${c.id}`, label: `${c.name} (camera)`, lat: c.lat!, lon: c.lon! })),
  ], [areas.data, cameras.data, myPos]);
  const [key, setKey] = useState<string>(() => getStored("nh-weather-loc", ""));
  const loc = locations.find((l) => l.key === key) ?? locations[0];
  useEffect(() => { if (loc) setStored("nh-weather-loc", loc.key); }, [loc]);
  const [mode, setMode] = useState<"forecast" | "history">("forecast");
  const [day, setDay] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));

  const q = useQuery({
    queryKey: ["weather", mode, loc?.lat, loc?.lon, mode === "history" ? day : null],
    enabled: !!loc,
    staleTime: 10 * 60_000,
    queryFn: () => invokeFunction<{ samples: WeatherSample[]; attribution: string }>("weather", {
      query: { lat: loc!.lat.toFixed(4), lon: loc!.lon.toFixed(4), ...(mode === "history" ? { day } : {}) },
    }),
  });
  const samples = q.data?.samples ?? [];
  const now = samples[0];
  const series = samples.slice(0, mode === "forecast" ? 48 : 24).map((s) => ({ ...s, label: new Date(s.time).toLocaleString("sv-SE", { weekday: mode === "forecast" ? "short" : undefined, hour: "2-digit", minute: "2-digit" }) }));
  const axis = { tick: { fill: colors.muted, fontSize: 11 }, axisLine: false, tickLine: false } as const;

  const useMyPosition = async () => {
    try { const p = await getPosition(); const l = { key: "me", label: "My position", lat: p.lat, lon: p.lon }; setMyPos(l); setKey("me"); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title="Weather" description="Forecasts for planning and modelled historical weather for looking back." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Select className="w-64" value={loc?.key ?? ""} onChange={(e) => setKey(e.target.value)} aria-label="Location">
          {locations.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          {!locations.length && <option value="">No locations yet</option>}
        </Select>
        <Button variant="outline" onClick={useMyPosition}><Crosshair /> My position</Button>
        <Segmented value={mode} onChange={setMode} options={[{ value: "forecast", label: "Forecast" }, { value: "history", label: "Historical" }]} />
        {mode === "history" && <Input type="date" className="w-44" value={day} max={new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value)} />}
      </div>

      {!loc ? <EmptyState icon={CloudSun} title="Choose a location" description="Draw a hunting area, position a camera, or use your current position to see weather." action={<Button onClick={useMyPosition}><Crosshair /> Use my position</Button>} /> :
        q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <PageLoader /> : !samples.length ? <EmptyState icon={CloudSun} title="No data" description="The provider returned no data for this location or date." /> : (
          <div className="space-y-4">
            {now && (
              <Card className="overflow-hidden">
                <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                  <WeatherIcon s={now} className="size-14 text-accent" />
                  <div>
                    <div className="flex items-center gap-2"><WeatherKindBadge kind={now.kind} /><span className="text-xs text-muted">{fmt.dateTime(now.time)}</span></div>
                    <div className="mt-1 font-display text-4xl font-bold tabular">{fmt.num(now.temperature_c, 1)}°</div>
                    <div className="text-sm text-muted">{now.humidity_pct != null && `Humidity ${fmt.num(now.humidity_pct)}% · `}{now.pressure_hpa != null && `${fmt.num(now.pressure_hpa)} hPa · `}{now.precipitation_mm != null && `${fmt.num(now.precipitation_mm, 1)} mm`}</div>
                  </div>
                  {now.wind_dir_deg != null && (
                    <div className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
                      <div className="relative grid size-16 place-items-center rounded-full border border-border">
                        <span className="absolute top-0.5 text-[9px] text-muted">N</span>
                        <Navigation className="size-7 text-accent" style={{ transform: `rotate(${downwindBearing(now.wind_dir_deg)}deg)` }} />
                      </div>
                      <div className="text-sm">
                        <div className="flex items-center gap-1 font-semibold"><Wind className="size-4" /> {fmt.num(now.wind_speed_ms, 1)} m/s from {windDirectionLabel(now.wind_dir_deg)}</div>
                        {now.wind_gust_ms != null && <div className="text-muted">Gusts {fmt.num(now.wind_gust_ms, 1)} m/s</div>}
                        <div className="text-xs text-muted">Scent carries towards {windDirectionLabel(downwindBearing(now.wind_dir_deg))}</div>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}
            <Card>
              <CardHeader title="Sun & moon" description={mode === "history" ? day : "Today"} />
              <CardBody><SunMoonCard lat={loc.lat} lon={loc.lon} day={mode === "history" ? day : undefined} /></CardBody>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Temperature (°C)" />
                <CardBody className="h-52">
                  <ResponsiveContainer>
                    <LineChart data={series}>
                      <CartesianGrid vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="label" {...axis} minTickGap={28} />
                      <YAxis {...axis} width={30} />
                      <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v} °C`} />} cursor={{ stroke: colors.muted, strokeDasharray: "3 3" }} />
                      <Line type="monotone" dataKey="temperature_c" name="Temperature" stroke={colors.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Wind (m/s)" />
                <CardBody className="h-52">
                  <ResponsiveContainer>
                    <BarChart data={series}>
                      <CartesianGrid vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="label" {...axis} minTickGap={28} />
                      <YAxis {...axis} width={30} />
                      <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v} m/s`} />} cursor={{ fill: colors.grid, opacity: 0.4 }} />
                      <Bar dataKey="wind_speed_ms" name="Wind" fill={colors.series[0]} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </div>
            <Card>
              <CardHeader title="Hour by hour" description={q.data?.attribution} />
              <CardBody className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-1.5 font-medium">Time</th><th className="font-medium" /><th className="font-medium">Temp</th><th className="font-medium">Wind</th><th className="font-medium">Gust</th><th className="font-medium">Precip.</th><th className="font-medium">Cloud</th></tr></thead>
                  <tbody>
                    {series.map((s) => (
                      <tr key={s.time} className="border-t border-border">
                        <td className="py-1.5 tabular">{s.label}</td>
                        <td><WeatherIcon s={s} className="size-4 text-muted" /></td>
                        <td className="tabular">{fmt.num(s.temperature_c, 1)}°</td>
                        <td className="tabular"><span className="inline-flex items-center gap-1"><WindArrow deg={s.wind_dir_deg} className="size-3.5 text-muted" />{fmt.num(s.wind_speed_ms, 1)} {windDirectionLabel(s.wind_dir_deg)}</span></td>
                        <td className="tabular">{fmt.num(s.wind_gust_ms, 1)}</td>
                        <td className="tabular">{fmt.num(s.precipitation_mm, 1)}</td>
                        <td className="tabular">{s.cloud_cover_pct != null ? `${fmt.num(s.cloud_cover_pct)}%` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>
        )}
    </div>
  );
}
