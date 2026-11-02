import { assertEquals } from "jsr:@std/assert@1";
import { exifDateTimeOriginal, zonedToUtc } from "./images.ts";

function jpegWithExif(date: string): Uint8Array {
  // Little-endian TIFF: IFD0 with ExifIFD pointer -> Exif IFD with DateTimeOriginal.
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 12 + 4 + 20);
  const dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true);
  dv.setUint16(10, 0x8769, true); dv.setUint16(12, 4, true); dv.setUint32(14, 1, true); dv.setUint32(18, 26, true);
  dv.setUint32(22, 0, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 0x9003, true); dv.setUint16(30, 2, true); dv.setUint32(32, 20, true); dv.setUint32(36, 44, true);
  dv.setUint32(40, 0, true);
  tiff.set(new TextEncoder().encode(date + "\0"), 44);
  const app1Len = 2 + 6 + tiff.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, ...new TextEncoder().encode("Exif"), 0, 0, ...tiff, 0xff, 0xd9]);
}

Deno.test("reads EXIF DateTimeOriginal", () => {
  assertEquals(exifDateTimeOriginal(jpegWithExif("2026:10:01 06:15:30")), "2026-10-01T06:15:30");
  assertEquals(exifDateTimeOriginal(jpegWithExif("0000:00:00 00:00:00")), null);
  assertEquals(exifDateTimeOriginal(new Uint8Array([1, 2, 3])), null);
});

Deno.test("converts local camera time to UTC", () => {
  assertEquals(zonedToUtc("2026-10-01T06:15:30", "Europe/Stockholm"), "2026-10-01T04:15:30.000Z"); // CEST
  assertEquals(zonedToUtc("2026-12-01T06:00:00", "Europe/Stockholm"), "2026-12-01T05:00:00.000Z"); // CET
  assertEquals(zonedToUtc("2026-07-01T12:00:00", "Europe/Helsinki"), "2026-07-01T09:00:00.000Z");
});

import { exifGps, analyzePixels } from "./images.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

function jpegWithGps(lat: [number, number, number], latRef: string, lon: [number, number, number], lonRef: string): Uint8Array {
  // IFD0 (1 entry: GPS pointer) at 8; GPS IFD (4 entries) at 26; rationals after.
  const gpsIfd = 26, rationals = gpsIfd + 2 + 4 * 12 + 4;
  const tiff = new Uint8Array(rationals + 48);
  const dv = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d, 0x00, 0x2a]); // big-endian
  dv.setUint32(4, 8);
  dv.setUint16(8, 1);
  dv.setUint16(10, 0x8825); dv.setUint16(12, 4); dv.setUint32(14, 1); dv.setUint32(18, gpsIfd);
  dv.setUint16(gpsIfd, 4);
  const entry = (k: number, tag: number, type: number, count: number, value: number) => {
    const e = gpsIfd + 2 + k * 12; dv.setUint16(e, tag); dv.setUint16(e + 2, type); dv.setUint32(e + 4, count); dv.setUint32(e + 8, value);
  };
  entry(0, 0x0001, 2, 2, 0); tiff[gpsIfd + 2 + 8] = latRef.charCodeAt(0);
  entry(1, 0x0002, 5, 3, rationals);
  entry(2, 0x0003, 2, 2, 0); tiff[gpsIfd + 2 + 24 + 8] = lonRef.charCodeAt(0);
  entry(3, 0x0004, 5, 3, rationals + 24);
  [...lat, ...lon].forEach((v, i) => { dv.setUint32(rationals + i * 8, Math.round(v * 100)); dv.setUint32(rationals + i * 8 + 4, 100); });
  const len = 2 + 6 + tiff.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...new TextEncoder().encode("Exif"), 0, 0, ...tiff, 0xff, 0xd9]);
}

Deno.test("reads EXIF GPS", () => {
  assertEquals(exifGps(jpegWithGps([62, 23, 24], "N", [17, 18, 36], "E")), { lat: 62.39, lon: 17.31 });
  assertEquals(exifGps(jpegWithGps([33, 0, 0], "S", [70, 30, 0], "W")), { lat: -33, lon: -70.5 });
  assertEquals(exifGps(jpegWithGps([0, 0, 0], "N", [0, 0, 0], "E")), null);
  assertEquals(exifGps(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
});

Deno.test("creates a bounded thumbnail and phash", async () => {
  const img = new Image(1600, 900).fill(0x336699ff);
  const r = await analyzePixels(await img.encodeJPEG(80));
  assertEquals([r?.width, r?.height], [1600, 900]);
  assertEquals(r?.phash.length, 16);
  const thumb = await (await import("https://deno.land/x/imagescript@1.3.0/mod.ts")).decode(r!.thumbnail!) as Image;
  assertEquals([thumb.width, thumb.height], [480, 270]);
});
