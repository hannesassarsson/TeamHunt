// Direct image ingest for cellular trail cameras or mail-to-HTTP bridges.
//   POST /functions/v1/camera-ingest
//   X-Camera-Token: nhc_...            (per-camera token, rotate in the Cameras page)
//   Content-Type: image/jpeg            (raw body)  OR  multipart/form-data with field "image"
//   Optional headers: X-Captured-At (ISO 8601), X-Battery (0-100)
import { serviceClient } from "../_shared/clients.ts";
import { HttpError, json, serve, sha256Hex } from "../_shared/http.ts";

const MAX_BYTES = 25 * 1024 * 1024;
const RATE_PER_MINUTE = 30;

function sniffMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

serve("camera-ingest", async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const token = req.headers.get("x-camera-token") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("nhc_") || token.length < 20) throw new HttpError(401, "Missing or invalid camera token");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new HttpError(413, "Image too large");

  const db = serviceClient();
  const { data: tok } = await db.from("camera_ingest_tokens").select("camera_id, org_id").eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (!tok) throw new HttpError(401, "Unknown camera token");
  const { data: cam } = await db.from("cameras").select("id, org_id, active").eq("id", tok.camera_id).maybeSingle();
  if (!cam || !cam.active) throw new HttpError(403, "Camera is inactive");

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("camera_images").select("id", { count: "exact", head: true }).eq("camera_id", cam.id).gte("uploaded_at", since);
  if ((count ?? 0) >= RATE_PER_MINUTE) throw new HttpError(429, "Rate limit exceeded", "rate_limited");

  let bytes: Uint8Array;
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) throw new HttpError(400, "Missing form field 'image'");
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    bytes = new Uint8Array(await req.arrayBuffer());
  }
  if (bytes.length === 0) throw new HttpError(400, "Empty body");
  if (bytes.length > MAX_BYTES) throw new HttpError(413, "Image too large");
  const mime = sniffMime(bytes);
  if (!mime) throw new HttpError(415, "Only JPEG, PNG or WebP images are accepted");

  const sha256 = await sha256Hex(bytes);
  const { data: existing } = await db.from("camera_images").select("id").eq("org_id", cam.org_id).eq("sha256", sha256).maybeSingle();
  if (existing) return json(req, { id: existing.id, duplicate: true });

  const capturedHeader = req.headers.get("x-captured-at");
  const capturedAt = capturedHeader && !Number.isNaN(Date.parse(capturedHeader)) ? new Date(capturedHeader).toISOString() : null;
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const id = crypto.randomUUID();
  const path = `${cam.org_id}/${cam.id}/${new Date().toISOString().slice(0, 7)}/${id}.${ext}`;
  const { error: upErr } = await db.storage.from("camera-images").upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { error: insErr } = await db.from("camera_images").insert({
    id, org_id: cam.org_id, camera_id: cam.id, storage_path: path, sha256, bytes: bytes.length,
    captured_at: capturedAt, captured_at_source: capturedAt ? "camera" : null, source: "ingest", status: "pending", uploaded_by: null,
  });
  if (insErr) {
    await db.storage.from("camera-images").remove([path]);
    if (insErr.code === "23505") return json(req, { duplicate: true });
    throw insErr;
  }
  const battery = Number(req.headers.get("x-battery"));
  if (Number.isInteger(battery) && battery >= 0 && battery <= 100) {
    await db.from("cameras").update({ last_battery_pct: battery }).eq("id", cam.id);
  }
  return json(req, { id, duplicate: false }, 201);
});
