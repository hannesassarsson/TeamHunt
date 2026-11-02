import { dHashFromGray9x8, grayscale9x8 } from "@shared/domain/phash.ts";
import { supabase } from "./supabase";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Perceptual hash + dimensions computed in the browser (server recomputes if missing). */
export async function imageFingerprint(file: Blob): Promise<{ phash: string; width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = 36;
    canvas.height = 32;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, 36, 32);
    const { data } = ctx.getImageData(0, 0, 36, 32);
    const result = { phash: dHashFromGray9x8(grayscale9x8(data, 36, 32)), width: bmp.width, height: bmp.height };
    bmp.close();
    return result;
  } catch {
    return null;
  }
}

export type UploadOutcome = { file: string; status: "uploaded" | "duplicate" | "error"; message?: string };

export async function uploadCameraImage(orgId: string, cameraId: string | null, file: File): Promise<UploadOutcome> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return { file: file.name, status: "error", message: "Unsupported file type" };
  if (file.size > MAX_IMAGE_BYTES) return { file: file.name, status: "error", message: "File larger than 25 MB" };
  const buf = await file.arrayBuffer();
  const sha256 = await sha256Hex(buf);
  const { data: existing } = await supabase.from("camera_images").select("id").eq("org_id", orgId).eq("sha256", sha256).maybeSingle();
  if (existing) return { file: file.name, status: "duplicate" };
  const fp = await imageFingerprint(file);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const id = crypto.randomUUID();
  const path = `${orgId}/${cameraId ?? "unassigned"}/${new Date().toISOString().slice(0, 7)}/${id}.${ext}`;
  const up = await supabase.storage.from("camera-images").upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return { file: file.name, status: "error", message: up.error.message };
  const { error } = await supabase.from("camera_images").insert({
    id, org_id: orgId, camera_id: cameraId, storage_path: path, sha256, bytes: file.size,
    phash: fp?.phash ?? null, width: fp?.width ?? null, height: fp?.height ?? null,
  });
  if (error) {
    await supabase.storage.from("camera-images").remove([path]);
    return { file: file.name, status: error.code === "23505" ? "duplicate" : "error", message: error.message };
  }
  return { file: file.name, status: "uploaded" };
}

/** Run async tasks with limited concurrency, reporting progress. */
export async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onProgress?: (done: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onProgress?.(++done);
    }
  }));
  return out;
}
