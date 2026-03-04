import { describe, expect, test } from "bun:test";
import { Vector2D } from "../math/Vector2D.ts";
import { HudViewport, type CanvasViewportTarget } from "./HudViewport.ts";

const makeCanvas = (
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number },
): CanvasViewportTarget =>
  ({
    width,
    height,
    getBoundingClientRect: () => rect as DOMRect,
  }) as CanvasViewportTarget;

describe("HudViewport", () => {
  test("contain fit keeps aspect and centers with letterboxing", () => {
    const viewport = new HudViewport(new Vector2D(1920, 1080), "contain", false);
    viewport.setCanvasSize(new Vector2D(1000, 1000));

    expect(viewport.scaleX).toBeCloseTo(1000 / 1920);
    expect(viewport.scaleY).toBeCloseTo(1000 / 1920);
    expect(viewport.ox).toBeCloseTo(0);
    expect(viewport.oy).toBeCloseTo(218.75);
  });

  test("cover fit keeps aspect and crops overflowing axis", () => {
    const viewport = new HudViewport(new Vector2D(1920, 1080), "cover", false);
    viewport.setCanvasSize(new Vector2D(1000, 1000));

    expect(viewport.scaleX).toBeCloseTo(1000 / 1080);
    expect(viewport.scaleY).toBeCloseTo(1000 / 1080);
    expect(viewport.ox).toBeCloseTo(-388.8888889);
    expect(viewport.oy).toBeCloseTo(0);
  });

  test("stretch fit uses independent x/y scales", () => {
    const viewport = new HudViewport(new Vector2D(200, 100), "stretch");
    viewport.setCanvasSize(new Vector2D(1000, 600));

    expect(viewport.scaleX).toBeCloseTo(5);
    expect(viewport.scaleY).toBeCloseTo(6);
    expect(viewport.ox).toBeCloseTo(0);
    expect(viewport.oy).toBe(0);
  });

  test("screenToHud and hudToScreen are inverse for contain fit", () => {
    const viewport = new HudViewport(new Vector2D(400, 200), "contain", false);
    viewport.setCanvasSize(new Vector2D(800, 600));

    const hud = new Vector2D(100, 50);
    const screen = viewport.hudToScreen(hud);
    const roundTrip = viewport.screenToHud(screen);

    expect(screen.x).toBeCloseTo(200);
    expect(screen.y).toBeCloseTo(200);
    expect(roundTrip.x).toBeCloseTo(hud.x);
    expect(roundTrip.y).toBeCloseTo(hud.y);
  });

  test("clientToScreen maps CSS pixels to canvas pixels", () => {
    const viewport = new HudViewport(new Vector2D(400, 200));
    const canvas = makeCanvas(1000, 500, { left: 100, top: 50, width: 500, height: 250 });

    const point = viewport.clientToScreen(new Vector2D(350, 175), canvas);
    expect(point.x).toBeCloseTo(500);
    expect(point.y).toBeCloseTo(250);
  });

  test("clientToHud converts from DOM client coordinates to HUD space", () => {
    const viewport = new HudViewport(new Vector2D(400, 200), "contain", false);
    viewport.setCanvasSize(new Vector2D(800, 600));
    const canvas = makeCanvas(800, 600, { left: 0, top: 0, width: 400, height: 300 });

    const hudPoint = viewport.clientToHud(new Vector2D(100, 100), canvas);
    expect(hudPoint.x).toBeCloseTo(100);
    expect(hudPoint.y).toBeCloseTo(50);
  });

  test("snapToPixel rounds contain-fit offsets", () => {
    const viewport = new HudViewport(new Vector2D(1920, 1080), "contain", true);
    viewport.setCanvasSize(new Vector2D(1000, 1000));

    expect(Object.is(viewport.ox, -0)).toBe(true);
    expect(viewport.oy).toBe(219);
  });

  test("clientToScreen returns zero when canvas rect is collapsed", () => {
    const viewport = new HudViewport(new Vector2D(400, 200));
    const canvas = makeCanvas(1000, 500, { left: 10, top: 20, width: 0, height: 0 });

    const point = viewport.clientToScreen(new Vector2D(100, 200), canvas);
    expect(point).toEqual(Vector2D.zero);
  });
});
