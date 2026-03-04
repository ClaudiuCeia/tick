import { describe, expect, test } from "bun:test";
import { Entity } from "../ecs/Entity.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { Vector2D } from "../math/Vector2D.ts";

class Node extends Entity {}

describe("HudLayoutNodeComponent", () => {
  test("stores and exposes resolved frame", () => {
    const entity = new Node();
    const node = new HudLayoutNodeComponent({ width: 100, height: 50 });
    entity.addComponent(node);

    node.setResolvedFrame({ x: 10, y: 20, width: 100, height: 50 });
    expect(node.getFrame()).toEqual({ x: 10, y: 20, width: 100, height: 50 });

    node.clearResolvedFrame();
    expect(node.getFrame()).toBeNull();
  });

  test("containsHudPoint checks point containment in frame", () => {
    const entity = new Node();
    const node = new HudLayoutNodeComponent({ width: 80, height: 40 });
    entity.addComponent(node);
    node.setResolvedFrame({ x: 100, y: 200, width: 80, height: 40 });

    expect(node.containsHudPoint(new Vector2D(100, 200))).toBe(true);
    expect(node.containsHudPoint(new Vector2D(180, 240))).toBe(true);
    expect(node.containsHudPoint(new Vector2D(99, 200))).toBe(false);
    expect(node.containsHudPoint(new Vector2D(181, 240))).toBe(false);
  });

  test("stores min and max size constraints", () => {
    const entity = new Node();
    const node = new HudLayoutNodeComponent({ width: "fill", height: "50%" });
    entity.addComponent(node);

    node.setMinMax({ minWidth: 120, maxWidth: 200, minHeight: 24, maxHeight: 60 });

    expect(node.minWidth).toBe(120);
    expect(node.maxWidth).toBe(200);
    expect(node.minHeight).toBe(24);
    expect(node.maxHeight).toBe(60);
  });
});
