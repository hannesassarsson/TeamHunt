import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Field, Select } from "./ui/form";
import { useOrg } from "@/lib/org";
import { useCameras } from "@/lib/hooks";
import { ACCEPTED_IMAGE_TYPES, runPool, uploadCameraImage, type UploadOutcome } from "@/lib/upload";
import { cn } from "@/lib/utils";

export function UploadImages({ open, onOpenChange, defaultCameraId }: { open: boolean; onOpenChange: (v: boolean) => void; defaultCameraId?: string }) {
  const { org } = useOrg();
  const cameras = useCameras();
  const qc = useQueryClient();
  const [cameraId, setCameraId] = useState(defaultCameraId ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<UploadOutcome[] | null>(null);
  const [drag, setDrag] = useState(false);

  const pick = (list: FileList | null) => {
    if (!list) return;
    setResults(null);
    setFiles([...list].filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type)).slice(0, 500));
  };
  const start = async () => {
    if (!org || !files.length) return;
    setProgress(0);
    const out = await runPool(files, 4, (f) => uploadCameraImage(org.id, cameraId || null, f).catch((e) => ({ file: f.name, status: "error" as const, message: String(e) })), setProgress);
    setResults(out);
    setProgress(null);
    const ok = out.filter((r) => r.status === "uploaded").length;
    if (ok) toast.success(`${ok} image${ok > 1 ? "s" : ""} uploaded — analysis runs in the background`);
    qc.invalidateQueries({ queryKey: ["images"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    setFiles([]);
  };
  const summary = results && {
    uploaded: results.filter((r) => r.status === "uploaded").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
    errors: results.filter((r) => r.status === "error"),
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (progress === null) { onOpenChange(v); if (!v) { setResults(null); setFiles([]); } } }} title="Upload camera images"
      description="JPEG, PNG or WebP up to 25 MB. Capture time is read from the image's EXIF data."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)} disabled={progress !== null}>Close</Button><Button onClick={start} disabled={!files.length} loading={progress !== null}>Upload {files.length || ""}</Button></>}>
      <div className="space-y-4">
        <Field label="Camera" hint="Images from the same camera enable duplicate-burst detection and per-camera analytics.">
          <Select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            <option value="">Unassigned</option>
            {cameras.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
          className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border px-4 py-10 text-center transition", drag && "border-primary bg-primary/5")}>
          <ImagePlus className="mb-2 size-8 text-muted" />
          <span className="text-sm font-medium">{files.length ? `${files.length} image${files.length > 1 ? "s" : ""} selected` : "Drop images here or tap to choose"}</span>
          <span className="mt-1 text-xs text-muted">Up to 500 per batch</span>
          <input type="file" multiple accept={ACCEPTED_IMAGE_TYPES.join(",")} className="hidden" onChange={(e) => pick(e.target.files)} />
        </label>
        {progress !== null && (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary transition-all" style={{ width: `${(progress / Math.max(files.length, 1)) * 100}%` }} /></div>
            <p className="mt-1 text-xs text-muted tabular">{progress} / {files.length}</p>
          </div>
        )}
        {summary && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <p>{summary.uploaded} uploaded · {summary.duplicate} already in library · {summary.errors.length} failed</p>
            {summary.errors.slice(0, 5).map((e) => <p key={e.file} className="mt-1 text-xs text-danger">{e.file}: {e.message}</p>)}
          </div>
        )}
      </div>
    </Dialog>
  );
}
