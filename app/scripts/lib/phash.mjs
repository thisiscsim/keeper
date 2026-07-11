// 64-bit perceptual hash (pHash): 32x32 grayscale -> 2D DCT -> sign of the
// top-left 8x8 AC coefficients vs their median. Near-duplicate frames land
// within a small Hamming distance of each other. Pure JS, no dependencies.

const SIZE = 32;
const LOW = 8;

/** Precomputed DCT-II cosine basis for a 32-point transform. */
const COS = (() => {
  const table = [];
  for (let u = 0; u < LOW; u++) {
    const row = new Float64Array(SIZE);
    for (let x = 0; x < SIZE; x++) {
      row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
    }
    table.push(row);
  }
  return table;
})();

/**
 * Compute the pHash of a 32x32 grayscale buffer (1024 bytes).
 * Returns a BigInt with 64 significant bits.
 */
export function phash(gray32) {
  if (gray32.length !== SIZE * SIZE) throw new Error(`phash needs ${SIZE * SIZE} pixels, got ${gray32.length}`);

  // Row-column separable 2D DCT, keeping only the LOW x LOW corner.
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = new Float64Array(LOW);
    for (let u = 0; u < LOW; u++) {
      let acc = 0;
      const basis = COS[u];
      for (let x = 0; x < SIZE; x++) acc += gray32[y * SIZE + x] * basis[x];
      row[u] = acc;
    }
    rows.push(row);
  }
  const coeffs = new Float64Array(LOW * LOW);
  for (let v = 0; v < LOW; v++) {
    const basis = COS[v];
    for (let u = 0; u < LOW; u++) {
      let acc = 0;
      for (let y = 0; y < SIZE; y++) acc += rows[y][u] * basis[y];
      coeffs[v * LOW + u] = acc;
    }
  }

  // Median of the AC coefficients (skip the DC term at [0]).
  const ac = Array.from(coeffs.slice(1)).sort((a, b) => a - b);
  const median = ac[Math.floor(ac.length / 2)];

  let hash = 0n;
  for (let i = 1; i < coeffs.length; i++) {
    hash <<= 1n;
    if (coeffs[i] > median) hash |= 1n;
  }
  return hash;
}

/** Hamming distance between two pHashes (0 = identical structure). */
export function hamming(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Box-filter a square grayscale buffer down to target x target. */
export function downsampleGray(gray, size, target) {
  if (size === target) return gray;
  const out = new Uint8Array(target * target);
  const ratio = size / target;
  for (let y = 0; y < target; y++) {
    const y0 = Math.floor(y * ratio);
    const y1 = Math.min(size, Math.ceil((y + 1) * ratio));
    for (let x = 0; x < target; x++) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.min(size, Math.ceil((x + 1) * ratio));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          sum += gray[yy * size + xx];
          n++;
        }
      }
      out[y * target + x] = Math.round(sum / Math.max(1, n));
    }
  }
  return out;
}

/** Serialize for storage. */
export function phashToHex(hash) {
  return hash.toString(16).padStart(16, "0");
}

export function phashFromHex(hex) {
  return BigInt(`0x${hex}`);
}
