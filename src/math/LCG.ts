/** Deterministic, seedable Linear Congruential Generator. */
export class LCG {
  private seed: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new Error("LCG seed must be finite");
    }
    this.seed = Math.trunc(seed) >>> 0;
  }

  /** Returns a pseudo-random number in [0, 1). */
  public random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }
}
