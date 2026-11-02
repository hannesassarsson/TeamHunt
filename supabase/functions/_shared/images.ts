// Server-side image utilities: decode, perceptual hash and EXIF capture time.
import { Image, decode } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { dHashFromGray9x8, grayscale9x8 } from "./domain/phash.ts";

export interface DecodedInfo {
  phash: string;
  width: number;
  height: number;
  /** JPEG thumbnail, longest side THUMB_SIZE px. */
  thumbnail: Uint8Array | null;
}

export const THUMB_SIZE = 480;

/** Decode once; produce perceptual hash, dimensions and a thumbnail. */
export async function analyzePixels(bytes: Uint8Array): Promise<DecodedInfo | null> {
  try {
    const img = await decode(bytes);
    if (!(img instanceof Image)) return null;
    const { width, height } = img;
    const phash = dHashFromGray9x8(grayscale9x8(img.clone().resize(36, 32).bitmap, 36, 32));
    let thumbnail: Uint8Array | null = null;
    try {
      const scale = THUMB_SIZE / Math.max(width, height);
      const thumb = scale < 1 ? img.resize(Math.round(width * scale), Math.round(height * scale)) : img;
      thumbnail = await thumb.encodeJPEG(72);
    } catch {
      thumbnail = null;
    }
    return { phash, width, height, thumbnail };
  } catch {
    return null;
  }
}

/** @deprecated use analyzePixels */
export async function computePhash(bytes: Uint8Array): Promise<{ phash: string; width: number; height: number } | null> {
  const r = await analyzePixels(bytes);
  return r && { phash: r.phash, width: r.width, height: r.height };
}

function exifTiff(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === "Exif") {
      return bytes.subarray(i + 10, i + 2 + len);
    }
    if (marker === 0xda) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * Read DateTimeOriginal (0x9003) from JPEG EXIF. Returns a naive local timestamp string
 * "YYYY-MM-DDTHH:MM:SS" (EXIF has no zone) or null.
 */
export function exifDateTimeOriginal(bytes: Uint8Array): string | null {
  const t = exifTiff(bytes);
  return t ? parseTiffDate(t) : null;
}

/** Read GPS latitude/longitude from JPEG EXIF (GPS IFD 0x8825), or null. */
export function exifGps(bytes: Uint8Array): { lat: number; lon: number } | null {
  const t = exifTiff(bytes);
  if (!t || t.length < 8) return null;
  const le = t[0] === 0x49;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0);
  const entries = (off: number) => {
    const out = new Map<number, { type: number; count: number; value: number; at: number }>();
    if (off + 2 > t.length) return out;
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (e + 12 > t.length) break;
      out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8), at: e + 8 });
    }
    return out;
  };
  const gpsPtr = entries(u32(4)).get(0x8825)?.value;
  if (!gpsPtr) return null;
  const g = entries(gpsPtr);
  const ref = (tag: number) => { const e = g.get(tag); return e ? String.fromCharCode(t[e.at]) : ""; };
  const dms = (tag: number) => {
    const e = g.get(tag);
    if (!e || e.type !== 5 || e.count !== 3 || e.value + 24 > t.length) return null;
    const r = (k: number) => { const den = u32(e.value + k * 8 + 4); return den ? u32(e.value + k * 8) / den : NaN; };
    const v = r(0) + r(1) / 60 + r(2) / 3600;
    return Number.isFinite(v) ? v : null;
  };
  let lat = dms(0x0002), lon = dms(0x0004);
  if (lat == null || lon == null) return null;
  if (ref(0x0001) === "S") lat = -lat;
  if (ref(0x0003) === "W") lon = -lon;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

function parseTiffDate(t: Uint8Array): string | null {
  if (t.length < 8) return null;
  const le = t[0] === 0x49;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0);
  const readIfd = (off: number, tags: number[]): Map<number, number> => {
    const out = new Map<number, number>();
    if (off + 2 > t.length) return out;
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (e + 12 > t.length) break;
      const tag = u16(e);
      if (tags.includes(tag)) out.set(tag, u32(e + 8));
    }
    return out;
  };
  const ifd0 = readIfd(u32(4), [0x8769, 0x0132]);
  const exifOff = ifd0.get(0x8769);
  const sub = exifOff ? readIfd(exifOff, [0x9003]) : new Map<number, number>();
  const strOff = sub.get(0x9003) ?? ifd0.get(0x0132);
  if (strOff == null || strOff + 19 > t.length) return null;
  const s = String.fromCharCode(...t.subarray(strOff, strOff + 19));
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m || m[1] === "0000") return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** Convert a naive local timestamp in an IANA zone to a UTC ISO string. */
export function zonedToUtc(naive: string, timeZone: string): string {
  const asUtc = new Date(`${naive}Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(asUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const zoned = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(asUtc.getTime() - (zoned - asUtc.getTime())).toISOString();
}
