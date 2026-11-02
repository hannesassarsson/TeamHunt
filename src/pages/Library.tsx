import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Images, Upload, Filter, Copy, ListChecks, CheckSquare, Square, Check, X, Tag, Trash2 } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAction, useCameras, useSignedUrls, thumbOf } from "@/lib/hooks";
import type { CameraImage, Detection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Select, Checkbox } from "@/components/ui/form";
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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };
  const bulkInv = [["images"], ["images-dets"], ["dashboard"], ["image"], ["image-detections"]];
  const sel = () => [...selected];
  const bulkReview = useAction(async (review: "confirmed" | "rejected") => {
    unwrap(await supabase.from("detections").update({ review }).in("image_id", sel()).eq("source", "ai").eq("review", "unreviewed").select("id"));
  }, { success: "Detections updated", invalidate: bulkInv, onSuccess: exitSelect });
  const bulkCamera = useAction(async (cameraId: string) => {
    unwrap(await supabase.from("camera_images").update({ camera_id: cameraId || null }).in("id", sel()).select("id"));
  }, { success: "Camera assigned", invalidate: bulkInv, onSuccess: exitSelect });
  const bulkAddTag = useAction(async (tag: string) => {
    unwrap(await supabase.from("image_tags").upsert(sel().map((id) => ({ image_id: id, org_id: org!.id, tag })), { onConflict: "image_id,tag", ignoreDuplicates: true }).select("image_id"));
  }, { success: "Tag added", invalidate: [["tags"], ["image-tags"]], onSuccess: () => { setBulkTag(""); exitSelect(); } });
  const bulkDelete = useAction(async () => {
    unwrap(await supabase.from("camera_images").delete().in("id", sel()).select("id"));
  }, { success: "Images deleted", invalidate: bulkInv, onSuccess: exitSelect });

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
          {can("member") && <Button variant={selecting ? "primary" : "outline"} onClick={() => (selecting ? exitSelect() : setSelecting(true))}><CheckSquare /> {selecting ? "Done" : "Select"}</Button>}
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
                <button key={img.id} onClick={() => (selecting ? toggleSel(img.id) : set("image", img.id))} aria-pressed={selecting ? selected.has(img.id) : undefined}
                  className={cn("group relative overflow-hidden rounded-xl border bg-surface text-left transition hover:border-primary/60 hover:shadow-md", selecting && selected.has(img.id) ? "border-primary ring-2 ring-primary" : "border-border")}>
                  {selecting && <span className="absolute right-1.5 top-1.5 z-10 rounded bg-surface/90 p-0.5">{selected.has(img.id) ? <CheckSquare className="size-4 text-primary" /> : <Square className="size-4 text-muted" />}</span>}
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

      {selecting && (
        <div className="sticky bottom-3 z-20 mx-auto mt-4 flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur">
          <span className="text-sm font-semibold tabular">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(ids))}>All loaded</Button>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button size="sm" variant="outline" disabled={!selected.size} loading={bulkReview.isPending && bulkReview.variables === "confirmed"} onClick={() => bulkReview.mutate("confirmed")} title="Confirm all unreviewed AI detections in the selected images"><Check className="text-success" /> Confirm AI</Button>
          <Button size="sm" variant="outline" disabled={!selected.size} loading={bulkReview.isPending && bulkReview.variables === "rejected"} onClick={() => bulkReview.mutate("rejected")} title="Reject all unreviewed AI detections in the selected images"><X className="text-danger" /> Reject AI</Button>
          <Select className="h-8 w-40 text-xs" value="" disabled={!selected.size} onChange={(e) => e.target.value && bulkCamera.mutate(e.target.value === "__none" ? "" : e.target.value)} aria-label="Assign camera">
            <option value="">Assign camera…</option><option value="__none">Unassigned</option>
            {cameras.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const t = bulkTag.trim().toLowerCase(); if (t && selected.size) bulkAddTag.mutate(t); }}>
            <Input className="h-8 w-28 text-xs" placeholder="Tag" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} maxLength={32} pattern="[\w\-åäöæøÅÄÖÆØ ]{1,32}" aria-label="Tag to add" />
            <Button size="sm" variant="outline" type="submit" disabled={!selected.size || !bulkTag.trim()} aria-label="Add tag"><Tag /></Button>
          </form>
          {can("admin") && <Button size="sm" variant="ghost" className="ml-auto text-danger" disabled={!selected.size} loading={bulkDelete.isPending}
            onClick={() => { if (confirm(`Delete ${selected.size} image(s) permanently?`)) bulkDelete.mutate(); }}><Trash2 /> Delete</Button>}
        </div>
      )}

      <ImageDetail imageId={openId} onClose={() => set("image", null)} onSelect={(id) => set("image", id)}
        onPrev={idx > 0 ? () => set("image", ids[idx - 1]) : undefined}
        onNext={idx >= 0 && idx < ids.length - 1 ? () => set("image", ids[idx + 1]) : undefined} />
      <UploadImages open={uploadOpen} onOpenChange={setUploadOpen} defaultCameraId={f.camera || undefined} />
    </div>
  );
}
