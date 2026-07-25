import { describe, expect, test } from "bun:test";
import { HudScrollAreaComponent } from "./HudScrollAreaComponent.ts";

describe("HudScrollAreaComponent", () => {
  test("clamps thumb size and offset to a short track", () => {
    const scroll = new HudScrollAreaComponent({
      trackInsetTop: 8,
      trackInsetBottom: 8,
      minThumbHeight: 18,
    });
    scroll.setContentExtent(1000);
    scroll.scrollOffset = 10_000;

    const metrics = scroll.getMetrics({ x: 0, y: 0, width: 100, height: 20 }, 100);
    expect(metrics?.trackRect.height).toBe(4);
    expect(metrics?.thumbRect.height).toBe(4);
    expect(metrics?.thumbRect.y).toBe(8);
  });

  test("clamps invalid extents and offsets", () => {
    const scroll = new HudScrollAreaComponent();
    scroll.setContentExtent(Number.NaN);
    scroll.setScrollOffset(Number.POSITIVE_INFINITY, 100);
    expect(scroll.contentExtent).toBe(0);
    expect(scroll.scrollOffset).toBe(0);
    expect(scroll.getMetrics({ x: 0, y: 0, width: 100, height: 100 }, 100)).toBeNull();
  });

  test("clamps stored offset when content shrinks using the known viewport", () => {
    const scroll = new HudScrollAreaComponent();
    scroll.setContentExtent(1000);
    scroll.setScrollOffset(900, 100);

    scroll.setContentExtent(150);
    expect(scroll.scrollOffset).toBe(50);

    scroll.contentExtent = 80;
    expect(scroll.scrollOffset).toBe(0);

    scroll.setContentExtent(150, 100);
    expect(scroll.scrollOffset).toBe(0);
  });

  test("stores the clamped offset when calculating metrics", () => {
    const scroll = new HudScrollAreaComponent();
    scroll.setContentExtent(500);
    scroll.scrollOffset = 1000;

    scroll.getMetrics({ x: 0, y: 0, width: 100, height: 100 }, 100);
    expect(scroll.scrollOffset).toBe(400);
  });
});
