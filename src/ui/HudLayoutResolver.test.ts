import { beforeEach, describe, expect, test } from "bun:test";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";
import { Entity } from "../ecs/Entity.ts";
import { HudDeckLayoutComponent } from "./HudDeckLayoutComponent.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { resolveHudLayout } from "./HudLayoutResolver.ts";
import { HudStackLayoutComponent } from "./HudStackLayoutComponent.ts";

class Node extends Entity {}

beforeEach(() => {
  EcsRuntime.reset();
});

describe("resolveHudLayout", () => {
  test("anchors node frames to root bounds", () => {
    const runtime = new EcsRuntime(new EntityRegistry());

    EcsRuntime.runWith(runtime, () => {
      const nodeEntity = new Node();
      const node = new HudLayoutNodeComponent({
        width: 100,
        height: 50,
        anchor: "bottom-right",
        offset: { x: -10, y: -20 },
      });
      nodeEntity.addComponent(node);
      nodeEntity.awake();

      resolveHudLayout(runtime, { x: 0, y: 0, width: 1000, height: 500 });

      expect(node.getFrame()).toEqual({ x: 890, y: 430, width: 100, height: 50 });
    });
  });

  test("lays out stack children in order with alignment", () => {
    const runtime = new EcsRuntime(new EntityRegistry());

    EcsRuntime.runWith(runtime, () => {
      const container = new Node();
      container.addComponent(
        new HudLayoutNodeComponent({ width: 300, height: 100, anchor: "top-left" }),
      );
      container.addComponent(
        new HudStackLayoutComponent({
          direction: "row",
          gap: 10,
          padding: { top: 10, right: 10, bottom: 10, left: 10 },
          crossAlign: "center",
        }),
      );

      const first = new Node();
      const firstNode = new HudLayoutNodeComponent({ width: 50, height: 20, order: 0 });
      first.addComponent(firstNode);
      container.addChild(first);

      const second = new Node();
      const secondNode = new HudLayoutNodeComponent({ width: 30, height: 40, order: 1 });
      second.addComponent(secondNode);
      container.addChild(second);

      container.awake();
      resolveHudLayout(runtime, { x: 0, y: 0, width: 500, height: 300 });

      expect(firstNode.getFrame()).toEqual({ x: 10, y: 40, width: 50, height: 20 });
      expect(secondNode.getFrame()).toEqual({ x: 70, y: 30, width: 30, height: 40 });
    });
  });

  test("applies min and max constraints on anchored nodes", () => {
    const runtime = new EcsRuntime(new EntityRegistry());

    EcsRuntime.runWith(runtime, () => {
      const nodeEntity = new Node();
      const node = new HudLayoutNodeComponent({
        width: "80%",
        minWidth: 120,
        maxWidth: 200,
        height: "fill",
        minHeight: 60,
        maxHeight: 100,
        anchor: "center",
      });
      nodeEntity.addComponent(node);
      nodeEntity.awake();

      resolveHudLayout(runtime, { x: 0, y: 0, width: 300, height: 160 });

      expect(node.getFrame()).toEqual({ x: 50, y: 30, width: 200, height: 100 });
    });
  });

  test("supports fill and percent sizing in stack layout", () => {
    const runtime = new EcsRuntime(new EntityRegistry());

    EcsRuntime.runWith(runtime, () => {
      const container = new Node();
      container.addComponent(
        new HudLayoutNodeComponent({ width: 500, height: 100, anchor: "top-left" }),
      );
      container.addComponent(
        new HudStackLayoutComponent({
          direction: "row",
          gap: 10,
          padding: { top: 10, right: 10, bottom: 10, left: 10 },
          crossAlign: "stretch",
        }),
      );

      const first = new Node();
      const firstNode = new HudLayoutNodeComponent({ width: "20%", height: "fill", order: 0 });
      first.addComponent(firstNode);
      container.addChild(first);

      const second = new Node();
      const secondNode = new HudLayoutNodeComponent({ width: "fill", height: "fill", order: 1 });
      second.addComponent(secondNode);
      container.addChild(second);

      const third = new Node();
      const thirdNode = new HudLayoutNodeComponent({ width: "fill", height: "fill", order: 2 });
      third.addComponent(thirdNode);
      container.addChild(third);

      container.awake();
      resolveHudLayout(runtime, { x: 0, y: 0, width: 1000, height: 600 });

      expect(firstNode.getFrame()).toEqual({ x: 10, y: 10, width: 96, height: 80 });
      expect(secondNode.getFrame()).toEqual({ x: 116, y: 10, width: 182, height: 80 });
      expect(thirdNode.getFrame()).toEqual({ x: 308, y: 10, width: 182, height: 80 });
    });
  });

  test("supports fill and percent sizing in deck layout", () => {
    const runtime = new EcsRuntime(new EntityRegistry());

    EcsRuntime.runWith(runtime, () => {
      const container = new Node();
      container.addComponent(
        new HudLayoutNodeComponent({ width: 400, height: 200, anchor: "top-left" }),
      );
      container.addComponent(new HudDeckLayoutComponent({ padding: 10 }));

      const nodeEntity = new Node();
      const node = new HudLayoutNodeComponent({
        width: "50%",
        height: "fill",
        anchor: "center",
      });
      nodeEntity.addComponent(node);
      container.addChild(nodeEntity);

      container.awake();
      resolveHudLayout(runtime, { x: 0, y: 0, width: 800, height: 600 });

      expect(node.getFrame()).toEqual({ x: 105, y: 10, width: 190, height: 180 });
    });
  });

  test("supports nested deck and stack containers", () => {
    const runtime = new EcsRuntime(new EntityRegistry());

    EcsRuntime.runWith(runtime, () => {
      const root = new Node();
      root.addComponent(
        new HudLayoutNodeComponent({ width: 400, height: 120, anchor: "bottom-center" }),
      );
      root.addComponent(new HudDeckLayoutComponent({ padding: 10 }));

      const row = new Node();
      const rowNode = new HudLayoutNodeComponent({ width: 360, height: 80, anchor: "center" });
      row.addComponent(rowNode);
      row.addComponent(new HudStackLayoutComponent({ direction: "row", gap: 10 }));
      root.addChild(row);

      const slotA = new Node();
      const slotANode = new HudLayoutNodeComponent({ width: 110, height: 80, order: 0 });
      slotA.addComponent(slotANode);
      row.addChild(slotA);

      const slotB = new Node();
      const slotBNode = new HudLayoutNodeComponent({ width: 110, height: 80, order: 1 });
      slotB.addComponent(slotBNode);
      row.addChild(slotB);

      const slotOverlay = new Node();
      slotOverlay.addComponent(
        new HudLayoutNodeComponent({
          width: 110,
          height: 80,
          anchor: "top-right",
          offset: { x: -6, y: 8 },
        }),
      );
      slotOverlay.addComponent(new HudDeckLayoutComponent({ padding: 4 }));
      slotA.addChild(slotOverlay);

      const badge = new Node();
      const badgeNode = new HudLayoutNodeComponent({
        width: 24,
        height: 16,
        anchor: "bottom-right",
      });
      badge.addComponent(badgeNode);
      slotOverlay.addChild(badge);

      root.awake();
      resolveHudLayout(runtime, { x: 0, y: 0, width: 1000, height: 600 });

      expect(rowNode.getFrame()).toEqual({ x: 320, y: 500, width: 360, height: 80 });
      expect(slotANode.getFrame()).toEqual({ x: 320, y: 500, width: 110, height: 80 });
      expect(slotBNode.getFrame()).toEqual({ x: 440, y: 500, width: 110, height: 80 });
      expect(badgeNode.getFrame()).toEqual({ x: 396, y: 568, width: 24, height: 16 });
    });
  });
});
