import { describe, expect, test } from "bun:test";
import type { World } from "./World.ts";
import { type FrameScheduler, WorldLoop } from "./WorldLoop.ts";

class TestScheduler implements FrameScheduler {
  public timestamp = 1000;
  public readonly canceled: number[] = [];
  private readonly callbacks = new Map<number, (timestamp: number) => void>();
  private nextFrameId = 1;

  public now(): number {
    return this.timestamp;
  }

  public request(callback: (timestamp: number) => void): number {
    const frameId = this.nextFrameId++;
    this.callbacks.set(frameId, callback);
    return frameId;
  }

  public cancel(frameId: number): void {
    this.canceled.push(frameId);
    this.callbacks.delete(frameId);
  }

  public fire(timestamp: number): void {
    const entry = this.callbacks.entries().next().value;
    if (!entry) throw new Error("No frame is pending");
    const [frameId, callback] = entry;
    this.callbacks.delete(frameId);
    this.timestamp = timestamp;
    callback(timestamp);
  }

  public get pendingFrames(): number {
    return this.callbacks.size;
  }
}

const makeWorld = (step: (deltaTime: number) => void): World => ({ step }) as World;

describe("WorldLoop", () => {
  test("auto-starts, clamps frame deltas, and schedules the next frame", () => {
    const scheduler = new TestScheduler();
    const deltas: number[] = [];
    const loop = new WorldLoop(
      makeWorld((deltaTime) => deltas.push(deltaTime)),
      { scheduler },
    );

    expect(loop.isRunning).toBe(true);
    expect(scheduler.pendingFrames).toBe(1);

    scheduler.fire(1200);

    expect(deltas).toEqual([0.05]);
    expect(scheduler.pendingFrames).toBe(1);
  });

  test("supports explicit, idempotent start and stop", () => {
    const scheduler = new TestScheduler();
    const loop = new WorldLoop(
      makeWorld(() => {}),
      { scheduler, autoStart: false },
    );

    expect(loop.isRunning).toBe(false);
    loop.start();
    loop.start();
    expect(scheduler.pendingFrames).toBe(1);

    loop.stop();
    loop.stop();
    expect(loop.isRunning).toBe(false);
    expect(scheduler.pendingFrames).toBe(0);
    expect(scheduler.canceled).toEqual([1]);

    loop.start();
    expect(loop.isRunning).toBe(true);
    expect(scheduler.pendingFrames).toBe(1);
  });

  test("does not reschedule when stopped during a world step", () => {
    const scheduler = new TestScheduler();
    let loop: WorldLoop;
    loop = new WorldLoop(
      makeWorld(() => loop.stop()),
      { scheduler },
    );

    scheduler.fire(1016);

    expect(loop.isRunning).toBe(false);
    expect(scheduler.pendingFrames).toBe(0);
  });

  test("does not create a second frame chain when restarted during a world step", () => {
    const scheduler = new TestScheduler();
    let loop: WorldLoop;
    loop = new WorldLoop(
      makeWorld(() => {
        loop.stop();
        loop.start();
      }),
      { scheduler },
    );

    scheduler.fire(1016);

    expect(loop.isRunning).toBe(true);
    expect(scheduler.pendingFrames).toBe(1);
  });

  test("stops after a world error and can be restarted", () => {
    const scheduler = new TestScheduler();
    let shouldThrow = true;
    const loop = new WorldLoop(
      makeWorld(() => {
        if (shouldThrow) throw new Error("step failed");
      }),
      { scheduler },
    );

    expect(() => scheduler.fire(1016)).toThrow("step failed");
    expect(loop.isRunning).toBe(false);

    shouldThrow = false;
    loop.start();
    scheduler.fire(1032);
    expect(loop.isRunning).toBe(true);
  });

  test("validates options and scheduler timestamps", () => {
    const scheduler = new TestScheduler();
    expect(
      () =>
        new WorldLoop(
          makeWorld(() => {}),
          { scheduler, maxDeltaTime: 0 },
        ),
    ).toThrow("maxDeltaTime");
    scheduler.timestamp = Number.NaN;
    expect(
      () =>
        new WorldLoop(
          makeWorld(() => {}),
          { scheduler },
        ),
    ).toThrow("finite timestamp");
  });
});
