import type { World } from "./World.ts";

export interface FrameScheduler {
  /** Current scheduler timestamp in milliseconds. */
  now(): number;
  /** Requests one frame whose timestamp uses the same clock as now(). */
  request(callback: (timestamp: number) => void): number;
  cancel(frameId: number): void;
}

export type WorldLoopOptions = {
  maxDeltaTime?: number;
  autoStart?: boolean;
  scheduler?: FrameScheduler;
};

const browserFrameScheduler: FrameScheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (frameId) => cancelAnimationFrame(frameId),
};

/** Drives a World from animation frames. Call stop() before tearing the world down. */
export class WorldLoop {
  private frameId: number | null = null;
  private lastTimestamp = 0;
  private running = false;
  private readonly maxDeltaTime: number;
  private readonly scheduler: FrameScheduler;

  constructor(
    private readonly world: World,
    options: WorldLoopOptions = {},
  ) {
    this.maxDeltaTime = options.maxDeltaTime ?? 0.05;
    if (!Number.isFinite(this.maxDeltaTime) || this.maxDeltaTime <= 0) {
      throw new RangeError("maxDeltaTime must be a finite number greater than 0");
    }
    this.scheduler = options.scheduler ?? browserFrameScheduler;

    if (options.autoStart ?? true) this.start();
  }

  public get isRunning(): boolean {
    return this.running;
  }

  public start(): void {
    if (this.running) return;

    this.lastTimestamp = this.scheduler.now();
    if (!Number.isFinite(this.lastTimestamp)) {
      throw new RangeError("Frame scheduler now() must return a finite timestamp");
    }

    this.running = true;
    this.requestNextFrame();
  }

  public stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.frameId !== null) this.scheduler.cancel(this.frameId);
    this.frameId = null;
  }

  private requestNextFrame(): void {
    try {
      this.frameId = this.scheduler.request(this.onFrame);
    } catch (error) {
      this.running = false;
      this.frameId = null;
      throw error;
    }
  }

  private readonly onFrame = (timestamp: number): void => {
    if (!this.running) return;
    this.frameId = null;

    const deltaTime = Math.min(
      this.maxDeltaTime,
      Math.max(0, (timestamp - this.lastTimestamp) / 1000),
    );
    this.lastTimestamp = timestamp;

    try {
      this.world.step(deltaTime);
    } catch (error) {
      this.running = false;
      throw error;
    }

    if (this.running && this.frameId === null) this.requestNextFrame();
  };
}
