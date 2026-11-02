import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Battery, Camera, MapPin, Plus, Wifi, WifiOff } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useCameras, cameraStatus } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, ErrorState, PageHeader, PageLoader } from "@/components/ui/misc";
import { CameraForm } from "@/components/CameraForm";
import { fmt, startOfDayDaysAgo } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";

export default function Cameras() {
  const { org, can } = useOrg();
  const cameras = useCameras();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const activity = useQuery({
    queryKey: ["camera-activity", org?.id],
    enabled: !!org,
    queryFn: async () => unwrap(await supabase.rpc("analytics_camera_activity", { p_org: org!.id, p_from: startOfDayDaysAgo(30).toISOString(), p_to: new Date().toISOString() })) as { camera_id: string; images: number; animal_images: number; top_species: string | null }[],
  });
  const act = new Map(activity.data?.map((a) => [a.camera_id, a]));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title="Cameras" description="Trail cameras, their health and the last 30 days of activity." actions={can("admin") && <Button onClick={() => setFormOpen(true)}><Plus /> Add camera</Button>} />
      {cameras.isError ? <ErrorState error={cameras.error} onRetry={() => cameras.refetch()} /> : cameras.isLoading ? <PageLoader /> : !cameras.data?.length ? (
        <EmptyState icon={Camera} title="No cameras yet" description="Add your trail cameras to organise images, track activity and get alerts when a camera goes quiet."
          action={can("admin") && <Button onClick={() => setFormOpen(true)}><Plus /> Add camera</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.data.map((c) => {
            const st = cameraStatus(c);
            const a = act.get(c.id);
            return (
              <Link key={c.id} to={`/cameras/${c.id}`}>
                <Card className="h-full p-4 transition hover:border-primary/60 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-display font-semibold">{c.name}</h3>
                      <p className="truncate text-xs text-muted">{c.model ?? "Unknown model"}</p>
                    </div>
                    <Badge tone={st === "online" ? "success" : st === "offline" ? "danger" : "neutral"}>
                      {st === "online" ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}{st === "never" ? "no images" : st}
                    </Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-surface-2 py-2"><dt className="text-[10px] uppercase text-muted">Images</dt><dd className="font-display font-bold tabular">{a?.images ?? 0}</dd></div>
                    <div className="rounded-lg bg-surface-2 py-2"><dt className="text-[10px] uppercase text-muted">Animals</dt><dd className="font-display font-bold tabular">{a?.animal_images ?? 0}</dd></div>
                    <div className="rounded-lg bg-surface-2 py-2"><dt className="text-[10px] uppercase text-muted">Top</dt><dd className="truncate px-1 text-xs font-semibold leading-6">{a?.top_species ? speciesLabel(a.top_species) : "–"}</dd></div>
                  </dl>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted">
                    <span>Last image {fmt.ago(c.last_seen_at)}</span>
                    <span className="flex items-center gap-2">
                      {c.last_battery_pct != null && <span className="inline-flex items-center gap-0.5"><Battery className="size-3.5" />{c.last_battery_pct}%</span>}
                      {c.lat == null && <span className="inline-flex items-center gap-0.5 text-warning"><MapPin className="size-3.5" />No position</span>}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      <CameraForm open={formOpen} onOpenChange={setFormOpen} onSaved={(c) => navigate(`/cameras/${c.id}`)} />
    </div>
  );
}
