import { describe, test, expect } from "bun:test";
import { LCG } from "./LCG.ts";

describe("LCG", () => {
  test("random() returns values in [0, 1)", () => {
    const rng = new LCG(12345);
    for (let i = 0; i < 100; i++) {
      const v = rng.random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("same seed produces same sequence", () => {
    const a = new LCG(42);
    const b = new LCG(42);
    for (let i = 0; i < 20; i++) {
      expect(a.random()).toBe(b.random());
    }
  });

  test("different seeds produce different sequences", () => {
    const a = new LCG(1);
    const b = new LCG(2);
    const aValues = Array.from({ length: 10 }, () => a.random());
    const bValues = Array.from({ length: 10 }, () => b.random());
    expect(aValues).not.toEqual(bValues);
  });

  test("sequence is not constant", () => {
    const rng = new LCG(999);
    const values = new Set(Array.from({ length: 20 }, () => rng.random()));
    expect(values.size).toBeGreaterThan(1);
  });

  test("normalizes equivalent seeds to uint32", () => {
    const negative = new LCG(-1);
    const uint32 = new LCG(0xffffffff);
    const fractional = new LCG(42.9);
    const integer = new LCG(42);

    expect(negative.random()).toBe(uint32.random());
    expect(fractional.random()).toBe(integer.random());
  });

  test("rejects non-finite seeds", () => {
    expect(() => new LCG(Number.NaN)).toThrow("seed must be finite");
    expect(() => new LCG(Number.POSITIVE_INFINITY)).toThrow("seed must be finite");
  });
});
