import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, KeyRound, MapPin, Pencil, Trash2, Upload, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAction, useCameras, useSignedUrls, cameraStatus, thumbOf } from "@/lib/hooks";
import type { CameraImage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, PageLoader, Segmented } from "@/components/ui/misc";
import { CameraForm } from "@/components/CameraForm";
import { UploadImages } from "@/components/UploadImages";
import { ImageDetail } from "@/components/ImageDetail";
import { ChartTooltip, useChartColors } from "@/components/charts";
import { fmt, startOfDayDaysAgo } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";
import { Images } from "lucide-react";

export default function CameraDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { org, can } = useOrg();
  const cameras = useCameras();
  const camera = cameras.data?.find((c) => c.id === id);
  const [days, setDays] = useState("30");
  const [editOpen, setEditOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [openImage, setOpenImage] = useState<string | null>(null);
  const from = startOfDayDaysAgo(Number(days)).toISOString();
  const colors = useChartColors();

  const events = useQuery({
    queryKey: ["camera-events", id, days],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from("camera_events").select("image_id, at, species_code, tier_rank").eq("camera_id", id!).gte("at", from).limit(5000)) as { image_id: string; at: string; species_code: string; tier_rank: number }[],
  });
  const recent = useQuery({
    queryKey: ["images", "camera", id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from("camera_images").select("*").eq("camera_id", id!).neq("status", "duplicate").order("captured_at", { ascending: false, nullsFirst: false }).limit(12)) as CameraImage[],
  });
  const signed = useSignedUrls("camera-images", (recent.data ?? []).map(thumbOf));

  const byHour = useMemo(() => {
    const tz = org?.timezone ?? "Europe/Stockholm";
    const fmtH = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz });
    const rows = Array.from({ length: 24 }, (_, h) => ({ hour: h, events: 0 }));
    for (const e of events.data ?? []) rows[Number(fmtH.format(new Date(e.at)))].events++;
    return rows;
  }, [events.data, org?.timezone]);
  const bySpecies = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events.data ?? []) m.set(e.species_code, (m.get(e.species_code) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [events.data]);

  const gpsSuggestion = useQuery({
    queryKey: ["camera-gps", id],
    enabled: !!id && !!cameras.data?.find((c) => c.id === id && c.lat == null),
    queryFn: async () => unwrap(await supabase.from("camera_images").select("gps_lat, gps_lon").eq("camera_id", id!).not("gps_lat", "is", null).order("uploaded_at", { ascending: false }).limit(1).maybeSingle()) as { gps_lat: number; gps_lon: number } | null,
  });
  const applyGps = useAction(async (p: { lat: number; lon: number }) => unwrap(await supabase.from("cameras").update({ lat: p.lat, lon: p.lon }).eq("id", id!).select().single()), { success: "Camera position set from image GPS", invalidate: [["cameras"]] });
  const rotate = useAction(async () => unwrap(await supabase.rpc("rotate_camera_ingest_token", { p_camera: id })) as string, { invalidate: [["cameras"]], onSuccess: (t) => setToken(t) });
  const del = useAction(async () => unwrap(await supabase.from("cameras").delete().eq("id", id!).select("id")), { success: "Camera deleted", invalidate: [["cameras"]], onSuccess: () => navigate("/cameras") });

  if (cameras.isLoading) return <PageLoader />;
  if (!camera) return <div className="p-6"><EmptyState icon={Images} title="Camera not found" action={<Link to="/cameras" className="text-primary">Back to cameras</Link>} /></div>;
  const st = cameraStatus(camera);
  const ingestUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/camera-ingest`;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link to="/cameras" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" /> Cameras</Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold">{camera.name} <Badge tone={st === "online" ? "success" : st === "offline" ? "danger" : "neutral"}>{st}</Badge></h1>
          <p className="mt-1 text-sm text-muted">{[camera.model, camera.serial].filter(Boolean).join(" · ") || "No model info"} · last image {fmt.ago(camera.last_seen_at)}{camera.last_battery_pct != null ? ` · battery ${camera.last_battery_pct}%` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("member") && <Button variant="outline" onClick={() => setUploadOpen(true)}><Upload /> Upload</Button>}
          <Button variant="outline" onClick={() => navigate(`/library?camera=${camera.id}`)}><Images /> All images</Button>
          {can("admin") && <Button variant="outline" onClick={() => navigate(`/map?placeCamera=${camera.id}`)}><MapPin /> {camera.lat == null ? "Place on map" : "Move on map"}</Button>}
          {can("admin") && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>}
        </div>
      </div>

      {camera.lat == null && gpsSuggestion.data && can("admin") && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-info/40 bg-info/10 px-4 py-3 text-sm">
          <MapPin className="size-4 text-info" />
          <span className="flex-1">This camera has no position, but its images contain GPS coordinates ({fmt.coord(gpsSuggestion.data.gps_lat, gpsSuggestion.data.gps_lon)}).</span>
          <Button size="sm" onClick={() => applyGps.mutate({ lat: gpsSuggestion.data!.gps_lat, lon: gpsSuggestion.data!.gps_lon })} loading={applyGps.isPending}>Use this position</Button>
        </div>
      )}
      <div className="mb-4 flex justify-end"><Segmented value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "365", label: "12 months" }]} /></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Activity by time of day" description={`Camera events (images with an animal) · ${org?.timezone}`} />
          <CardBody className="h-56">
            <ResponsiveContainer>
              <BarChart data={byHour}>
                <CartesianGrid vertical={false} stroke={colors.grid} />
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}`} tick={{ fill: colors.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: colors.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip content={<ChartTooltip labelFormatter={(h) => `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59`} />} cursor={{ fill: colors.grid }} />
                <Bar dataKey="events" name="Events" fill={colors.series[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Species" description="Camera events in period" />
          <CardBody>
            {bySpecies.length ? (
              <ul className="space-y-2">
                {bySpecies.slice(0, 8).map(([s, n]) => (
                  <li key={s}>
                    <div className="flex justify-between text-sm"><span>{speciesLabel(s)}</span><span className="tabular text-muted">{n}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${(n / bySpecies[0][1]) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No animal detections in this period.</p>}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Latest images" />
        <CardBody>
          {recent.data?.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {recent.data.map((i) => (
                <button key={i.id} onClick={() => setOpenImage(i.id)} className="overflow-hidden rounded-lg border border-border">
                  {signed.data?.[thumbOf(i)] ? <img src={signed.data[thumbOf(i)]} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" /> : <div className="aspect-[4/3] bg-surface-2" />}
                  <div className="px-1.5 py-1 text-left text-[10px] text-muted">{fmt.dateTime(i.captured_at ?? i.uploaded_at)}</div>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-muted">No images from this camera yet.</p>}
        </CardBody>
      </Card>

      {can("admin") && (
        <Card className="mt-4">
          <CardHeader title="Direct camera upload" description="Cellular cameras or e-mail/FTP bridges can post images straight to NORDHUNT with a per-camera token." />
          <CardBody className="space-y-3 text-sm">
            <p>Current token: {camera.ingest_token_prefix ? <code className="rounded bg-surface-2 px-1">{camera.ingest_token_prefix}…</code> : <span className="text-muted">none</span>}</p>
            <Button variant="outline" onClick={() => { if (!camera.ingest_token_prefix || confirm("Rotating invalidates the current token. Continue?")) rotate.mutate(); }} loading={rotate.isPending}>
              <KeyRound /> {camera.ingest_token_prefix ? "Rotate token" : "Create token"}
            </Button>
            <div className="border-t border-border pt-3">
              <Button variant="ghost" className="text-danger" onClick={() => { if (confirm(`Delete camera "${camera.name}"? Images are kept but become unassigned.`)) del.mutate(); }} loading={del.isPending}><Trash2 /> Delete camera</Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Dialog open={!!token} onOpenChange={(v) => !v && setToken(null)} title="Camera upload token" description="Copy it now — it is shown only once."
        footer={<Button onClick={() => setToken(null)}>Done</Button>}>
        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            <code className="flex-1 break-all rounded-lg bg-surface-2 p-2 text-xs">{token}</code>
            <Button variant="outline" size="icon" aria-label="Copy token" onClick={() => { void navigator.clipboard.writeText(token ?? ""); toast.success("Copied"); }}><Copy /></Button>
          </div>
          <p className="text-muted">Example:</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-2 text-[11px]">{`curl -X POST "${ingestUrl}" \\
  -H "X-Camera-Token: ${token}" \\
  -H "Content-Type: image/jpeg" \\
  -H "X-Battery: 87" \\
  --data-binary @IMG_0001.JPG`}</pre>
        </div>
      </Dialog>
      <CameraForm open={editOpen} onOpenChange={setEditOpen} camera={camera} />
      <UploadImages open={uploadOpen} onOpenChange={setUploadOpen} defaultCameraId={camera.id} />
      <ImageDetail imageId={openImage} onClose={() => setOpenImage(null)} onSelect={setOpenImage} />
    </div>
  );
}
