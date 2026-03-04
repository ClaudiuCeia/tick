import type { World } from "../../index.ts";

export type WorldLoopOptions = {
  maxDeltaTime?: number;
  autoStart?: boolean;
};

export class WorldLoop {
  private rafId: number | null = null;
  private lastTs = 0;
  private readonly maxDeltaTime: number;

  constructor(
    private readonly world: World,
    options: WorldLoopOptions = {},
  ) {
    this.maxDeltaTime = options.maxDeltaTime ?? 0.05;

    if (options.autoStart ?? true) {
      this.start();
    }
  }

  public start(): void {
    if (this.rafId !== null) return;

    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  public stop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private readonly onFrame = (now: number): void => {
    if (this.rafId === null) return;

    const dt = Math.min(this.maxDeltaTime, Math.max(0, (now - this.lastTs) / 1000));
    this.lastTs = now;

    this.world.step(dt);
    this.rafId = requestAnimationFrame(this.onFrame);
  };
}
