// Fade curve (6t^5 – 15t^4 + 10t^3)
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Permutation table built with Fisher-Yates shuffle
const PERM = new Uint8Array(512);
(function generatePerm() {
  const p: number[] = Array.from({ length: 256 }, (_, i) => i);
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255]!;
  }
})();

function grad(hash: number, x: number): number {
  return (hash & 1) === 0 ? x : -x;
}

/** 1D Perlin-style noise in [-1, 1]. */
export function noise1D(x: number): number {
  const xi = Math.floor(x) & 255;
  const xf = x - Math.floor(x);
  const u = fade(xf);

  const leftHash = PERM[xi]!;
  const rightHash = PERM[xi + 1]!;

  const g0 = grad(leftHash, xf);
  const g1 = grad(rightHash, xf - 1);

  return lerp(g0, g1, u);
}

/**
 * Fractional Brownian Motion (fBm) 1D — sum of octaves of noise.
 * @param x          input coordinate
 * @param octaves    layers to stack (default 5)
 * @param lacunarity frequency multiplier each octave (default 2)
 * @param gain       amplitude multiplier each octave (default 0.5)
 */
export function fBm1D(x: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  if (!Number.isFinite(x)) throw new Error("fBm1D x must be finite");
  if (!Number.isSafeInteger(octaves) || octaves <= 0) {
    throw new Error("fBm1D octaves must be a positive integer");
  }
  if (!Number.isFinite(lacunarity) || lacunarity <= 0) {
    throw new Error("fBm1D lacunarity must be finite and > 0");
  }
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) {
    throw new Error("fBm1D gain must be finite and in [0, 1]");
  }

  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    if (!Number.isFinite(x * freq) || !Number.isFinite(amp)) {
      throw new Error("fBm1D parameters exceed the finite numeric range");
    }
    sum += noise1D(x * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / norm;
}
