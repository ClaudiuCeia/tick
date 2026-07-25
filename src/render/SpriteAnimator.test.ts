import { describe, expect, test } from "bun:test";
import { SpriteAnimator } from "./SpriteAnimator.ts";

describe("SpriteAnimator", () => {
  test("plays looping clips and advances frames by dt", () => {
    const animator = new SpriteAnimator("idle");
    animator.defineClip("run", { frames: ["a", "b"], frameDuration: 0.1, loop: true });
    animator.play("run");

    expect(animator.getFrame()).toBe("a");
    animator.update(0.11);
    expect(animator.getFrame()).toBe("b");
    animator.update(0.11);
    expect(animator.getFrame()).toBe("a");
  });

  test("non-looping clip stays on the last frame", () => {
    const animator = new SpriteAnimator("idle");
    animator.defineClip("hit", { frames: ["h1", "h2"], frameDuration: 0.05, loop: false });
    animator.play("hit");

    animator.update(0.2);
    expect(animator.getFrame()).toBe("h2");
    animator.update(0.2);
    expect(animator.getFrame()).toBe("h2");
  });

  test("play() resets to first frame when switching clips", () => {
    const animator = new SpriteAnimator("idle");
    animator.defineClip("run", { frames: ["a", "b"], frameDuration: 0.1 });
    animator.defineClip("jump", { frames: ["j"], frameDuration: 1 });

    animator.play("run");
    animator.update(0.11);
    expect(animator.getFrame()).toBe("b");

    animator.play("jump");
    expect(animator.getFrame()).toBe("j");
  });

  test("advances very large deltas arithmetically", () => {
    const animator = new SpriteAnimator("idle");
    animator.defineClip("run", { frames: ["a", "b", "c"], frameDuration: 1 });
    animator.play("run");

    animator.update(1_000_000_001);
    expect(animator.getFrame()).toBe("c");
  });

  test("handles finite inputs whose duration division would overflow", () => {
    const animator = new SpriteAnimator("idle");
    animator.defineClip("run", {
      frames: ["a", "b", "c"],
      frameDuration: Number.MIN_VALUE,
    });
    animator.play("run");

    animator.update(Number.MAX_VALUE);
    expect(["a", "b", "c"]).toContain(animator.getFrame());
    animator.update(Number.MIN_VALUE);
    expect(["a", "b", "c"]).toContain(animator.getFrame());
  });

  test("rejects non-finite frame durations", () => {
    const animator = new SpriteAnimator("idle");
    expect(() =>
      animator.defineClip("invalid", { frames: ["a", "b"], frameDuration: Infinity }),
    ).toThrow("finite and > 0");
  });
});
