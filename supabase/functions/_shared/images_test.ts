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
