import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Images, Upload, Filter, Copy, ListChecks } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useCameras, useSignedUrls, thumbOf } from "@/lib/hooks";
import type { CameraImage, Detection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Select, Checkbox } from "@/components/ui/form";
import { EmptyState, ErrorState, PageHeader, Spinner, Segmented } from "@/components/ui/misc";
import { SpeciesSelect, TierBadge } from "@/components/species";
import { ImageDetail, imageStatusBadge } from "@/components/ImageDetail";
import { UploadImages } from "@/components/UploadImages";
import { cn, fmt, startOfDayDaysAgo } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";
import { tierRank } from "@shared/domain/tiers.ts";

const PAGE = 48;

export default function Library() {
  const { org, can } = useOrg();
  const cameras = useCameras();
  const [params, setParams] = useSearchParams();
  const set = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const f = {
    camera: params.get("camera") ?? "",
    species: params.get("species") ?? "",
    tier: params.get("tier") ?? "",
    status: params.get("status") ?? "",
    tag: params.get("tag") ?? "",
    days: params.get("days") ?? "30",
    animals: params.get("animals") === "1",
    dups: params.get("dups") === "1",
  };
  const openId = params.get("image");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const tags = useQuery({
    queryKey: ["tags", org?.id],
    enabled: !!org,
    queryFn: async () => [...new Set((unwrap(await supabase.from("image_tags").select("tag").eq("org_id", org!.id).limit(2000)) as { tag: string }[]).map((t) => t.tag))].sort(),
  });

  const q = useInfiniteQuery({
    queryKey: ["images", org?.id, f],
    enabled: !!org,
    initialPageParam: null as null | { at: string; id: string },
    getNextPageParam: (last: CameraImage[]) => (last.length < PAGE ? undefined : { at: last[last.length - 1].captured_at ?? last[last.length - 1].uploaded_at, id: last[last.length - 1].id }),
    refetchInterval: (query) => (query.state.data?.pages.some((p) => p.some((i) => i.status === "pending" || i.status === "processing")) ? 6000 : false),
    queryFn: async ({ pageParam }) => unwrap(await supabase.rpc("search_images", {
      p_org: org!.id,
      p_camera: f.camera || null,
      p_species: f.species || null,
      p_min_tier: f.tier || null,
      p_status: f.status || null,
      p_tag: f.tag || null,
      p_from: f.days !== "0" ? startOfDayDaysAgo(Number(f.days)).toISOString() : null,
      p_include_duplicates: f.dups,
      p_animals_only: f.animals,
      p_before_at: pageParam?.at ?? null,
      p_before_id: pageParam?.id ?? null,
      p_limit: PAGE,
    })) as CameraImage[],
  });
  const images = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  const ids = images.map((i) => i.id);
  const dets = useQuery({
    queryKey: ["images-dets", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const out: Detection[] = [];
      for (let i = 0; i < ids.length; i += 150) out.push(...(unwrap(await supabase.from("detections_view").select("image_id, species_code, count, confidence, tier, review").in("image_id", ids.slice(i, i + 150)).neq("review", "rejected")) as Detection[]));
      return out;
    },
  });
  const best = useMemo(() => {
    const m = new Map<string, Detection>();
    for (const d of dets.data ?? []) {
      const cur = m.get(d.image_id);
      if (!cur || tierRank(d.tier) > tierRank(cur.tier) || (tierRank(d.tier) === tierRank(cur.tier) && (d.confidence ?? 1) > (cur.confidence ?? 1))) m.set(d.image_id, d);
    }
    return m;
  }, [dets.data]);
  const signed = useSignedUrls("camera-images", images.map(thumbOf));
  const cameraName = (id: string | null) => cameras.data?.find((c) => c.id === id)?.name ?? "Unassigned";

  const idx = openId ? ids.indexOf(openId) : -1;
  const activeFilters = [f.camera, f.species, f.tier, f.status, f.tag, f.animals ? "1" : "", f.dups ? "1" : ""].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
      <PageHeader title="Camera images" description="Every trail camera image, analysed by AI and verified by your team."
        actions={<>
          <Button variant={f.status === "needs_review" ? "primary" : "outline"} onClick={() => set("status", f.status === "needs_review" ? null : "needs_review")}><ListChecks /> Review queue</Button>
          {can("member") && <Button onClick={() => setUploadOpen(true)}><Upload /> Upload</Button>}
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={f.days} onChange={(v) => set("days", v)} options={[{ value: "1", label: "24h" }, { value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "365", label: "1y" }, { value: "0", label: "All" }]} />
        <Button variant="outline" size="sm" onClick={() => setShowFilters((s) => !s)}><Filter /> Filters{activeFilters ? ` (${activeFilters})` : ""}</Button>
        {activeFilters > 0 && <Button variant="ghost" size="sm" onClick={() => setParams({ days: f.days })}>Clear</Button>}
      </div>
      {showFilters && (
        <div className="mb-5 grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={f.camera} onChange={(e) => set("camera", e.target.value)} aria-label="Camera">
            <option value="">All cameras</option>{cameras.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <SpeciesSelect value={f.species} onChange={(v) => set("species", v)} placeholder="All species" includeNonAnimals />
          <Select value={f.tier} onChange={(e) => set("tier", e.target.value)} aria-label="Classification">
            <option value="">Any classification</option><option value="confirmed">Confirmed only</option><option value="probable">Probable or better</option><option value="uncertain">Including uncertain</option>
          </Select>
          <Select value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
            <option value="">Any status</option><option value="needs_review">Needs review</option><option value="analyzed">Analysed</option>
            <option value="pending">Queued</option><option value="failed">Failed</option><option value="duplicate">Duplicates</option>
          </Select>
          <Select value={f.tag} onChange={(e) => set("tag", e.target.value)} aria-label="Tag">
            <option value="">Any tag</option>{tags.data?.map((t) => <option key={t}>{t}</option>)}
          </Select>
          <Checkbox label="Only images with animals" checked={f.animals} onChange={(e) => set("animals", e.target.checked ? "1" : null)} />
          <Checkbox label="Show duplicate bursts" checked={f.dups} onChange={(e) => set("dups", e.target.checked ? "1" : null)} />
        </div>
      )}

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <div className="flex h-64 items-center justify-center"><Spinner /></div> : images.length === 0 ? (
        <EmptyState icon={Images} title="No images found" description={activeFilters ? "Try widening the filters or time range." : "Upload trail camera images or connect a camera to start building your library."}
          action={can("member") && <Button onClick={() => setUploadOpen(true)}><Upload /> Upload images</Button>} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {images.map((img) => {
              const d = best.get(img.id);
              const url = signed.data?.[thumbOf(img)];
              return (
                <button key={img.id} onClick={() => set("image", img.id)} className="group overflow-hidden rounded-xl border border-border bg-surface text-left transition hover:border-primary/60 hover:shadow-md">
                  <div className="relative aspect-[4/3] bg-surface-2">
                    {url && <img src={url} alt="" loading="lazy" className={cn("size-full object-cover transition group-hover:scale-[1.02]", img.status === "duplicate" && "opacity-60")} />}
                    <div className="absolute left-1.5 top-1.5">{img.status !== "analyzed" && imageStatusBadge(img.status)}</div>
                    {img.status === "duplicate" && <Copy className="absolute right-2 top-2 size-4 text-white drop-shadow" />}
                  </div>
                  <div className="space-y-1 p-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-sm font-semibold">{d ? `${speciesLabel(d.species_code)}${d.count && d.count > 1 ? ` ×${d.count}` : ""}` : img.status === "analyzed" ? "Empty" : "—"}</span>
                      {d && <TierBadge tier={d.tier} className="shrink-0" />}
                    </div>
                    <div className="flex justify-between text-[11px] text-muted"><span className="truncate">{cameraName(img.camera_id)}</span><span className="shrink-0 tabular">{fmt.dateTime(img.captured_at ?? img.uploaded_at)}</span></div>
                  </div>
                </button>
              );
            })}
          </div>
          {q.hasNextPage && <div className="mt-6 flex justify-center"><Button variant="outline" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
        </>
      )}

      <ImageDetail imageId={openId} onClose={() => set("image", null)} onSelect={(id) => set("image", id)}
        onPrev={idx > 0 ? () => set("image", ids[idx - 1]) : undefined}
        onNext={idx >= 0 && idx < ids.length - 1 ? () => set("image", ids[idx + 1]) : undefined} />
      <UploadImages open={uploadOpen} onOpenChange={setUploadOpen} defaultCameraId={f.camera || undefined} />
    </div>
  );
}
