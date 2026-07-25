import { describe, test, expect } from "bun:test";
import { noise1D, fBm1D } from "./Noise1D.ts";

describe("noise1D", () => {
  test("returns deterministic value for same x in the same runtime", () => {
    const x = 12.3456;
    expect(noise1D(x)).toBe(noise1D(x));
  });

  test("returns values in [-1, 1] for sampled inputs", () => {
    for (let i = -100; i <= 100; i++) {
      const v = noise1D(i / 7);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("fBm1D", () => {
  test("returns finite sampled values", () => {
    for (let i = 0; i < 100; i++) {
      const v = fBm1D(i * 0.1, 4, 2, 0.5);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  test("same parameters produce deterministic output in same runtime", () => {
    const a = fBm1D(3.14, 6, 2.2, 0.45);
    const b = fBm1D(3.14, 6, 2.2, 0.45);
    expect(a).toBe(b);
  });

  test("rejects invalid fBm parameters", () => {
    expect(() => fBm1D(0, 0)).toThrow("octaves");
    expect(() => fBm1D(0, 1.5)).toThrow("octaves");
    expect(() => fBm1D(0, 2, 0)).toThrow("lacunarity");
    expect(() => fBm1D(0, 2, 2, -0.1)).toThrow("gain");
    expect(() => fBm1D(0, 2, 2, 1.1)).toThrow("gain");
    expect(() => fBm1D(Number.NaN)).toThrow("x must be finite");
  });
});
