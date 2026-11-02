// Server-side image utilities: decode, perceptual hash and EXIF capture time.
import { Image, decode } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { dHashFromGray9x8, grayscale9x8 } from "./domain/phash.ts";

export async function computePhash(bytes: Uint8Array): Promise<{ phash: string; width: number; height: number } | null> {
  try {
    const img = await decode(bytes);
    if (!(img instanceof Image)) return null;
    const { width, height } = img;
    const small = img.resize(36, 32);
    const rgba = small.bitmap;
    return { phash: dHashFromGray9x8(grayscale9x8(rgba, 36, 32)), width, height };
  } catch {
    return null;
  }
}

/**
 * Read DateTimeOriginal (0x9003) from JPEG EXIF. Returns a naive local timestamp string
 * "YYYY-MM-DDTHH:MM:SS" (EXIF has no zone) or null.
 */
export function exifDateTimeOriginal(bytes: Uint8Array): string | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === "Exif") {
      return parseTiffDate(bytes.subarray(i + 10, i + 2 + len));
    }
    if (marker === 0xda) return null;
    i += 2 + len;
  }
  return null;
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
