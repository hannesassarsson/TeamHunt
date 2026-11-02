import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { AlertTriangle, Camera, Eye, Images, ListChecks, Map, Play, WifiOff, ArrowRight } from "lucide-react";
import { supabase, unwrap, invokeFunction } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAreas, useCameras, useSignedUrls, cameraStatus } from "@/lib/hooks";
import { geometryCenter } from "@/lib/geo";
import type { CameraImage, Detection, Observation } from "@/lib/types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Stat, PageLoader } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { TierBadge, SpeciesName } from "@/components/species";
import { WeatherIcon, WindArrow, WeatherKindBadge } from "@/components/weather";
import { ChartTooltip, useChartColors } from "@/components/charts";
import { SunMoonCard } from "@/components/sun";
import { cn, fmt, startOfDayDaysAgo } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";
import { windDirectionLabel, type WeatherSample } from "@shared/domain/weather.ts";

export default function Dashboard() {
  const { org, can } = useOrg();
  const cameras = useCameras();
  const areas = useAreas();
  const colors = useChartColors();
  const since7 = startOfDayDaysAgo(6).toISOString();
  const d = useQuery({
    queryKey: ["dashboard", org?.id],
    enabled: !!org,
    refetchInterval: 120_000,
    queryFn: async () => {
      const [images7, review, recent, obs, daily] = await Promise.all([
        supabase.from("camera_images").select("id", { count: "exact", head: true }).eq("org_id", org!.id).gte("uploaded_at", since7).neq("status", "duplicate"),
        supabase.from("camera_images").select("id", { count: "exact", head: true }).eq("org_id", org!.id).eq("status", "needs_review"),
        supabase.from("camera_images").select("*").eq("org_id", org!.id).eq("has_animals", true).neq("status", "duplicate").order("captured_at", { ascending: false, nullsFirst: false }).limit(8),
        supabase.from("observations").select("*").eq("org_id", org!.id).order("observed_at", { ascending: false }).limit(6),
        supabase.rpc("analytics_daily", { p_org: org!.id, p_from: startOfDayDaysAgo(13).toISOString(), p_to: new Date().toISOString(), p_species: null }),
      ]);
      const recentImgs = unwrap(recent) as CameraImage[];
      const dets = recentImgs.length ? unwrap(await supabase.from("detections_view").select("*").in("image_id", recentImgs.map((i) => i.id)).neq("review", "rejected")) as Detection[] : [];
      return {
        images7: images7.count ?? 0, review: review.count ?? 0, recent: recentImgs, dets, obs: unwrap(obs) as Observation[],
        daily: unwrap(daily) as { day: string; images: number; camera_events: number; observations: number }[],
      };
    },
  });
  const signed = useSignedUrls("camera-images", (d.data?.recent ?? []).map((i) => i.storage_path));
  const offline = (cameras.data ?? []).filter((c) => cameraStatus(c) === "offline");
  const anchor = areas.data?.[0] ? geometryCenter(areas.data[0].geometry) : cameras.data?.find((c) => c.lat != null) ? [cameras.data.find((c) => c.lat != null)!.lon!, cameras.data.find((c) => c.lat != null)!.lat!] : null;
  const weather = useQuery({
    queryKey: ["weather", "forecast", anchor?.[1], anchor?.[0], null],
    enabled: !!anchor,
    staleTime: 10 * 60_000,
    queryFn: () => invokeFunction<{ samples: WeatherSample[] }>("weather", { query: { lat: anchor![1].toFixed(4), lon: anchor![0].toFixed(4) } }),
  });
  const events7 = d.data?.daily.slice(-7).reduce((a, r) => a + r.camera_events, 0) ?? 0;
  const prev7 = d.data?.daily.slice(0, 7).reduce((a, r) => a + r.camera_events, 0) ?? 0;
  const delta = prev7 ? Math.round(((events7 - prev7) / prev7) * 100) : null;
  const isEmpty = !d.isLoading && !cameras.data?.length && !areas.data?.length && !d.data?.obs.length;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-6">
        <p className="text-sm text-muted">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{org?.name}</h1>
      </div>

      {isEmpty && (
        <Card className="mb-6 p-5">
          <h2 className="font-display text-lg font-semibold">Get your team set up</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[{ to: "/map", icon: Map, t: "Draw your hunting area", s: "Mark boundaries, stands and feeding stations." },
              { to: "/cameras", icon: Camera, t: "Add trail cameras", s: "Organise images and get offline alerts." },
              { to: "/team", icon: Eye, t: "Invite your team", s: "Share maps, cameras and the journal." }].map((x) => (
              <Link key={x.to} to={x.to} className="rounded-xl border border-border p-4 transition hover:border-primary/60">
                <x.icon className="size-5 text-accent" /><div className="mt-2 font-semibold">{x.t}</div><div className="text-sm text-muted">{x.s}</div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {d.isLoading ? <PageLoader /> : d.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Camera events · 7 days" value={fmt.num(events7)} sub={delta == null ? "No earlier data" : `${delta >= 0 ? "+" : ""}${delta}% vs previous week`} icon={Eye} />
            <Stat label="New images · 7 days" value={fmt.num(d.data.images7)} icon={Images} />
            <Link to="/library?status=needs_review"><Stat label="Needs review" value={fmt.num(d.data.review)} sub="Tap to open the review queue" icon={ListChecks} tone={d.data.review ? "accent" : undefined} /></Link>
            <Link to="/cameras"><Stat label="Cameras offline" value={`${offline.length} / ${cameras.data?.length ?? 0}`} sub={offline.length ? offline.map((c) => c.name).slice(0, 2).join(", ") : "All reporting"} icon={WifiOff} tone={offline.length ? "danger" : "success"} /></Link>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Latest wildlife on camera" action={<Link to="/library?animals=1" className="inline-flex items-center gap-1 text-sm text-primary">All <ArrowRight className="size-4" /></Link>} />
              <CardBody>
                {d.data.recent.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {d.data.recent.map((img) => {
                      const det = d.data!.dets.filter((x) => x.image_id === img.id).sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))[0];
                      return (
                        <Link key={img.id} to={`/library?image=${img.id}`} className="overflow-hidden rounded-lg border border-border">
                          {signed.data?.[img.storage_path] ? <img src={signed.data[img.storage_path]} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] bg-surface-2" />}
                          <div className="space-y-1 p-2">
                            <div className="flex items-center justify-between gap-1"><span className="truncate text-sm font-semibold">{det ? speciesLabel(det.species_code) : "Animal"}</span>{det && <TierBadge tier={det.tier} />}</div>
                            <div className="text-[11px] text-muted">{fmt.ago(img.captured_at ?? img.uploaded_at)}</div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : <p className="py-6 text-center text-sm text-muted">No animal detections yet. <Link to="/library" className="text-primary">Upload images</Link></p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Weather" description={areas.data?.[0]?.name ?? cameras.data?.find((c) => c.lat != null)?.name} action={<Link to="/weather" className="text-sm text-primary">Details</Link>} />
              <CardBody>
                {!anchor ? <p className="text-sm text-muted">Add a hunting area or camera position to see local weather.</p> : weather.isLoading ? <PageLoader /> : weather.data?.samples.length ? (
                  <>
                    <div className="flex items-center gap-3">
                      <WeatherIcon s={weather.data.samples[0]} className="size-10 text-accent" />
                      <div>
                        <div className="font-display text-3xl font-bold tabular">{fmt.num(weather.data.samples[0].temperature_c, 1)}°</div>
                        <div className="flex items-center gap-1 text-sm text-muted"><WindArrow deg={weather.data.samples[0].wind_dir_deg} />{fmt.num(weather.data.samples[0].wind_speed_ms, 1)} m/s {windDirectionLabel(weather.data.samples[0].wind_dir_deg)}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                      {weather.data.samples.filter((_, i) => i > 0 && i % 3 === 0).slice(0, 4).map((s) => (
                        <div key={s.time} className="rounded-lg bg-surface-2 py-2">
                          <div className="text-muted">{fmt.time(s.time)}</div>
                          <WeatherIcon s={s} className="mx-auto my-1 size-4" />
                          <div className="font-semibold tabular">{fmt.num(s.temperature_c, 0)}°</div>
                          <div className="text-muted tabular">{fmt.num(s.wind_speed_ms, 0)} m/s</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><WeatherKindBadge kind="forecast" /><SunMoonCard lat={anchor[1]} lon={anchor[0]} compact /></div>
                  </>
                ) : <p className="text-sm text-muted">Weather unavailable.</p>}
              </CardBody>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Camera events · last 14 days" />
              <CardBody className="h-44">
                <ResponsiveContainer>
                  <AreaChart data={d.data.daily}>
                    <XAxis dataKey="day" tickFormatter={(v: string) => v.slice(5)} tick={{ fill: colors.muted, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={20} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.muted, strokeDasharray: "3 3" }} />
                    <Area type="monotone" dataKey="camera_events" name="Camera events" stroke={colors.series[0]} fill={colors.series[0]} fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Recent observations" action={<Link to="/observations" className="text-sm text-primary">All</Link>} />
              <CardBody>
                {d.data.obs.length ? (
                  <ul className="space-y-2.5">
                    {d.data.obs.map((o) => (
                      <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate"><SpeciesName code={o.species_code} />{o.count ? <span className="text-muted"> ×{o.count}</span> : null}</span>
                        <span className="shrink-0 text-xs text-muted">{fmt.ago(o.observed_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">No observations recorded yet.</p>}
                {can("member") && <Link to="/journal" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4 w-full")}><Play /> Start a hunt</Link>}
              </CardBody>
            </Card>
          </div>
          {offline.length > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <AlertTriangle className="size-4" /> {offline.length} camera{offline.length > 1 ? "s have" : " has"} not sent images recently: {offline.map((c) => c.name).join(", ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
