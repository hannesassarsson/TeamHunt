// Perceptual difference hash (dHash) for near-duplicate detection of trail camera images.
// Cameras often fire bursts of near-identical frames; exact duplicates are caught by SHA-256.

/**
 * Compute a 64-bit dHash from a 9x8 grayscale image (row-major, 72 values 0..255).
 * Returns 16 lowercase hex chars.
 */
export function dHashFromGray9x8(gray: ArrayLike<number>): string {
  if (gray.length !== 72) throw new Error("dHash expects a 9x8 grayscale buffer (72 values)");
  let hex = "";
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray[y * 9 + x];
      const right = gray[y * 9 + x + 1];
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      bits++;
      if (bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

/** Downscale RGBA pixels to 9x8 grayscale with box averaging. */
export function grayscale9x8(rgba: ArrayLike<number>, width: number, height: number): number[] {
  const out = new Array<number>(72).fill(0);
  for (let ty = 0; ty < 8; ty++) {
    const y0 = Math.floor((ty * height) / 8);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / 8));
    for (let tx = 0; tx < 9; tx++) {
      const x0 = Math.floor((tx * width) / 9);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / 9));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n++;
        }
      }
      out[ty * 9 + tx] = n ? sum / n : 0;
    }
  }
  return out;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("hash length mismatch");
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Default: <= 6 differing bits out of 64 within the burst window is treated as a near-duplicate. */
export const NEAR_DUPLICATE_MAX_DISTANCE = 6;
export const NEAR_DUPLICATE_WINDOW_SECONDS = 90;

export function isNearDuplicate(
  a: { phash: string; capturedAt: number },
  b: { phash: string; capturedAt: number },
  maxDistance = NEAR_DUPLICATE_MAX_DISTANCE,
  windowSeconds = NEAR_DUPLICATE_WINDOW_SECONDS,
): boolean {
  return Math.abs(a.capturedAt - b.capturedAt) <= windowSeconds * 1000 && hammingDistance(a.phash, b.phash) <= maxDistance;
}
