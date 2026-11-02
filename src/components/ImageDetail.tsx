import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Check, X, RefreshCw, Trash2, Plus, Tag, Camera as CameraIcon, Clock, Sparkles, AlertTriangle, Copy } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useAction, useCameras, useSignedUrls } from "@/lib/hooks";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import type { CameraImage, Detection } from "@/lib/types";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input, Select } from "./ui/form";
import { Badge, Spinner } from "./ui/misc";
import { SpeciesName, SpeciesSelect, TierBadge } from "./species";
import { WeatherSummary } from "./weather";
import { cn, fmt } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  pending: { label: "Queued", tone: "neutral" }, processing: { label: "Analysing", tone: "info" }, analyzed: { label: "Analysed", tone: "success" },
  needs_review: { label: "Needs review", tone: "warning" }, failed: { label: "Failed", tone: "danger" }, duplicate: { label: "Duplicate burst", tone: "neutral" },
};
export const imageStatusBadge = (s: string) => <Badge tone={STATUS_LABEL[s]?.tone ?? "neutral"}>{STATUS_LABEL[s]?.label ?? s}</Badge>;

export function ImageDetail({ imageId, onClose, onPrev, onNext, onSelect }: { imageId: string | null; onClose: () => void; onPrev?: () => void; onNext?: () => void; onSelect?: (id: string) => void }) {
  const { can } = useOrg();
  const { userId } = useAuth();
  const cameras = useCameras();
  const image = useQuery({
    queryKey: ["image", imageId],
    enabled: !!imageId,
    refetchInterval: (q) => (q.state.data && ["pending", "processing"].includes(q.state.data.status) ? 4000 : false),
    queryFn: async () => unwrap(await supabase.from("camera_images").select("*").eq("id", imageId!).single()) as CameraImage,
  });
  const dets = useQuery({
    queryKey: ["image-detections", imageId, image.data?.status],
    enabled: !!imageId,
    queryFn: async () => unwrap(await supabase.from("detections_view").select("*").eq("image_id", imageId!).order("confidence", { ascending: false, nullsFirst: true })) as Detection[],
  });
  const tags = useQuery({
    queryKey: ["image-tags", imageId],
    enabled: !!imageId,
    queryFn: async () => (unwrap(await supabase.from("image_tags").select("tag").eq("image_id", imageId!).order("tag")) as { tag: string }[]).map((t) => t.tag),
  });
  const img = image.data;
  const history = useQuery({
    queryKey: ["image-history", img?.camera_id, imageId],
    enabled: !!img?.camera_id,
    queryFn: async () => unwrap(await supabase.from("camera_images").select("id, storage_path, captured_at, uploaded_at").eq("camera_id", img!.camera_id!).eq("has_animals", true).neq("id", imageId!).neq("status", "duplicate").order("captured_at", { ascending: false }).limit(8)) as CameraImage[],
  });
  const signed = useSignedUrls("camera-images", [img?.storage_path, ...(history.data ?? []).map((h) => h.storage_path)].filter(Boolean) as string[]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|SELECT|TEXTAREA/)) return;
      if (e.key === "ArrowLeft") onPrev?.();
      if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext]);

  const inv = [["image", imageId], ["image-detections", imageId], ["images"], ["dashboard"], ["review-count"]];
  const review = useAction(async (p: { id: string; patch: Partial<Detection> }) => unwrap(await supabase.from("detections").update(p.patch).eq("id", p.id).select().single()), { invalidate: inv });
  const addManual = useAction(async (p: { species: string; count: number | null }) => unwrap(await supabase.from("detections").insert({ org_id: img!.org_id, image_id: img!.id, species_code: p.species, count: p.count, source: "manual" }).select().single()), { success: "Detection added", invalidate: inv });
  const removeManual = useAction(async (id: string) => unwrap(await supabase.from("detections").delete().eq("id", id).select()), { invalidate: inv });
  const reanalyze = useAction(async () => unwrap(await supabase.rpc("reanalyze_image", { p_image: img!.id })), { success: "Queued for analysis", invalidate: inv });
  const setCamera = useAction(async (cameraId: string) => unwrap(await supabase.from("camera_images").update({ camera_id: cameraId || null }).eq("id", img!.id).select().single()), { success: "Camera updated", invalidate: inv });
  const addTag = useAction(async (tag: string) => unwrap(await supabase.from("image_tags").insert({ image_id: img!.id, org_id: img!.org_id, tag }).select()), { invalidate: [["image-tags", imageId], ["tags"]] });
  const removeTag = useAction(async (tag: string) => unwrap(await supabase.from("image_tags").delete().eq("image_id", img!.id).eq("tag", tag).select()), { invalidate: [["image-tags", imageId], ["tags"]] });
  const del = useAction(async () => {
    unwrap(await supabase.from("camera_images").delete().eq("id", img!.id).select("id"));
    await supabase.storage.from("camera-images").remove([img!.storage_path]);
  }, { success: "Image deleted", invalidate: [["images"], ["dashboard"]], onSuccess: onClose });

  const [newSpecies, setNewSpecies] = useState("moose");
  const [newCount, setNewCount] = useState("1");
  const [newTag, setNewTag] = useState("");
  const [showBoxes, setShowBoxes] = useState(true);
  const canEdit = can("member");
  const canDelete = can("admin") || (canEdit && img?.source === "upload" && (img as unknown as { uploaded_by?: string })?.uploaded_by === userId);
  const url = img ? signed.data?.[img.storage_path] : undefined;
  const visibleDets = (dets.data ?? []).filter((d) => d.review !== "rejected");

  return (
    <Dialog open={!!imageId} onOpenChange={(v) => !v && onClose()} size="full"
      title={<span className="flex items-center gap-2">{img ? fmt.dateTime(img.captured_at ?? img.uploaded_at) : "Image"} {img && imageStatusBadge(img.status)}</span>}
      description={img ? (cameras.data?.find((c) => c.id === img.camera_id)?.name ?? "Unassigned camera") : undefined}>
      {!img ? <div className="flex h-64 items-center justify-center"><Spinner /></div> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            <div className="relative overflow-hidden rounded-xl bg-black">
              {url ? (
                <div className="relative mx-auto w-fit">
                  <img src={url} alt="Trail camera" className="max-h-[68dvh] w-auto object-contain" />
                  {showBoxes && visibleDets.filter((d) => d.bbox).map((d) => (
                    <div key={d.id} className="pointer-events-none absolute border-2 border-accent" style={{ left: `${d.bbox![0] * 100}%`, top: `${d.bbox![1] * 100}%`, width: `${d.bbox![2] * 100}%`, height: `${d.bbox![3] * 100}%` }}>
                      <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-accent px-1 text-[10px] font-semibold text-white">{speciesLabel(d.species_code)}</span>
                    </div>
                  ))}
                </div>
              ) : signed.isLoading ? <div className="flex h-72 items-center justify-center"><Spinner /></div> : (
                <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-white/70"><AlertTriangle className="size-5" />Image file unavailable{signed.isError ? ": could not create a download link" : ""}</div>
              )}
              {onPrev && <button onClick={onPrev} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" aria-label="Previous image"><ChevronLeft /></button>}
              {onNext && <button onClick={onNext} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" aria-label="Next image"><ChevronRight /></button>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
              <label className="flex items-center gap-1"><input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} /> Show boxes</label>
              {img.width && <span>{img.width}×{img.height}</span>}
              <span className="inline-flex items-center gap-1"><Clock className="size-3" /> Time from {img.captured_at_source === "exif" ? "EXIF" : img.captured_at_source === "camera" ? "camera" : img.captured_at_source === "upload" ? "upload time (no EXIF)" : "–"}</span>
              <span>{img.source === "ingest" ? "Camera upload" : "Manual upload"}</span>
            </div>
            {img.status === "duplicate" && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 p-3 text-sm">
                <Copy className="size-4 text-muted" /> Near-identical to another frame from the same burst, so it's excluded from statistics.
                {img.duplicate_of && onSelect && <Button size="sm" variant="link" onClick={() => onSelect(img.duplicate_of!)}>View original</Button>}
              </div>
            )}
            {history.data && history.data.length > 0 && (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Earlier animal images · same camera</h4>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {history.data.map((h) => (
                    <button key={h.id} onClick={() => onSelect?.(h.id)} className="shrink-0 overflow-hidden rounded-lg border border-border">
                      {signed.data?.[h.storage_path] ? <img src={signed.data[h.storage_path]} alt="" className="h-20 w-28 object-cover" loading="lazy" /> : <div className="h-20 w-28 bg-surface-2" />}
                      <div className="px-1 py-0.5 text-[10px] text-muted">{fmt.dateTime(h.captured_at ?? h.uploaded_at)}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-5">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-display font-semibold">Detections</h4>
                {canEdit && img.status !== "processing" && <Button size="sm" variant="ghost" onClick={() => reanalyze.mutate()} loading={reanalyze.isPending}><RefreshCw /> {img.status === "duplicate" ? "Not a duplicate" : "Re-analyse"}</Button>}
              </div>
              {["pending", "processing"].includes(img.status) && <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-4" /> AI analysis in progress…</p>}
              {img.analysis_error && <p className="mb-2 flex gap-2 rounded-lg bg-warning/10 p-2 text-xs text-warning"><AlertTriangle className="size-4 shrink-0" />{img.analysis_error}</p>}
              {img.status === "analyzed" && !dets.data?.length && <p className="text-sm text-muted">No animals detected in this image.</p>}
              <ul className="space-y-2">
                {(dets.data ?? []).map((d) => <DetectionRow key={d.id} d={d} canEdit={canEdit} onPatch={(patch) => review.mutate({ id: d.id, patch })} onDelete={() => removeManual.mutate(d.id)} />)}
              </ul>
              {canEdit && (
                <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addManual.mutate({ species: newSpecies, count: newCount ? Number(newCount) : null }); }}>
                  <div className="min-w-0 flex-1"><SpeciesSelect value={newSpecies} onChange={setNewSpecies} includeNonAnimals /></div>
                  <Input type="number" min={1} max={500} value={newCount} onChange={(e) => setNewCount(e.target.value)} className="w-16" aria-label="Count" />
                  <Button type="submit" variant="outline" size="icon" aria-label="Add detection" loading={addManual.isPending}><Plus /></Button>
                </form>
              )}
              {img.analysis_provider && <p className="mt-2 flex items-center gap-1 text-[11px] text-muted"><Sparkles className="size-3" /> {img.analysis_provider} · {img.analysis_model} · {fmt.dateTime(img.analyzed_at)}</p>}
            </section>

            <section>
              <h4 className="mb-2 font-display font-semibold">Weather at capture</h4>
              <WeatherSummary w={img.weather} />
            </section>

            <section>
              <h4 className="mb-2 font-display font-semibold">Tags</h4>
              <div className="flex flex-wrap gap-1.5">
                {(tags.data ?? []).map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                    <Tag className="size-3" />{t}
                    {canEdit && <button onClick={() => removeTag.mutate(t)} aria-label={`Remove tag ${t}`} className="text-muted hover:text-danger"><X className="size-3" /></button>}
                  </span>
                ))}
                {!tags.data?.length && <span className="text-xs text-muted">No tags</span>}
              </div>
              {canEdit && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = newTag.trim().toLowerCase(); if (t) { addTag.mutate(t); setNewTag(""); } }}>
                  <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add tag" maxLength={32} pattern="[\w\-åäöæøÅÄÖÆØ ]{1,32}" />
                  <Button type="submit" variant="outline">Add</Button>
                </form>
              )}
            </section>

            <section>
              <h4 className="mb-2 font-display font-semibold">Camera</h4>
              {canEdit ? (
                <Select value={img.camera_id ?? ""} onChange={(e) => setCamera.mutate(e.target.value)}>
                  <option value="">Unassigned</option>
                  {cameras.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              ) : <p className="text-sm">{cameras.data?.find((c) => c.id === img.camera_id)?.name ?? "Unassigned"}</p>}
              {img.camera_id && <Link to={`/cameras/${img.camera_id}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary"><CameraIcon className="size-3" /> Camera details</Link>}
            </section>

            {canDelete && <Button variant="ghost" className="text-danger" onClick={() => { if (confirm("Delete this image permanently?")) del.mutate(); }} loading={del.isPending}><Trash2 /> Delete image</Button>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DetectionRow({ d, canEdit, onPatch, onDelete }: { d: Detection; canEdit: boolean; onPatch: (p: Partial<Detection>) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [species, setSpecies] = useState(d.species_code);
  const [count, setCount] = useState(d.count?.toString() ?? "");
  return (
    <li className={cn("rounded-lg border border-border p-3", d.review === "rejected" && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold"><SpeciesName code={d.species_code} />{d.count ? <span className="ml-1 text-muted">×{d.count}</span> : null}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <TierBadge tier={d.tier} confidence={d.confidence} />
            <span className="text-[11px] text-muted">{d.source === "manual" ? "Manual" : `AI${d.ai_species_code ? ` suggested ${speciesLabel(d.ai_species_code)}` : ""}`}</span>
          </div>
        </div>
        {canEdit && !editing && (
          <div className="flex shrink-0 gap-1">
            {d.source === "ai" && d.review !== "confirmed" && d.review !== "corrected" && <Button size="icon-sm" variant="outline" onClick={() => onPatch({ review: "confirmed" })} aria-label="Confirm" title="Confirm"><Check className="text-success" /></Button>}
            {d.source === "ai" && d.review !== "rejected" && <Button size="icon-sm" variant="outline" onClick={() => onPatch({ review: "rejected" })} aria-label="Reject" title="Reject — not this species / no animal"><X className="text-danger" /></Button>}
            {d.review === "rejected" && <Button size="sm" variant="ghost" onClick={() => onPatch({ review: "unreviewed" })}>Undo</Button>}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <SpeciesSelect value={species} onChange={setSpecies} includeNonAnimals />
          <div className="flex gap-2">
            <Input type="number" min={1} max={500} placeholder="Count" value={count} onChange={(e) => setCount(e.target.value)} />
            <Button onClick={() => { onPatch({ species_code: species, count: count ? Number(count) : null, ...(d.source === "ai" && species === d.species_code ? { review: "confirmed" } : {}) }); setEditing(false); }}>Save</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
          {d.source === "manual" && <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}><Trash2 /> Remove</Button>}
        </div>
      )}
    </li>
  );
}
