import { beforeEach, describe, expect, test } from "bun:test";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Entity } from "../ecs/Entity.ts";
import { Vector2D } from "../math/Vector2D.ts";
import type { ICamera } from "../render/ICamera.ts";
import { HudLayoutDebugRenderComponent } from "./HudLayoutDebugRenderComponent.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { resolveHudLayout } from "./HudLayoutResolver.ts";

class Node extends Entity {}

class CameraStub extends Entity implements ICamera {
  public toCanvas(worldPos: Vector2D): Vector2D {
    return worldPos;
  }
}

beforeEach(() => {
  EcsRuntime.reset();
});

describe("HudLayoutDebugRenderComponent", () => {
  test("draws visible layout frames and labels", () => {
    const root = new Node();
    const debugEntity = new Node();
    const target = new Node();

    target.addComponent(new HudLayoutNodeComponent({ width: 120, height: 60, anchor: "top-left" }));
    debugEntity.addComponent(new HudLayoutDebugRenderComponent());

    root.addChild(target);
    root.addChild(debugEntity);
    root.awake();

    resolveHudLayout(EcsRuntime.getCurrent(), { x: 0, y: 0, width: 400, height: 300 });

    const calls = {
      strokeRect: [] as number[][],
      fillText: [] as Array<[string, number, number]>,
      arc: [] as number[][],
    };

    const ctx = {
      strokeStyle: "",
      lineWidth: 0,
      fillStyle: "",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      strokeRect: (...args: number[]) => calls.strokeRect.push(args),
      fillText: (text: string, x: number, y: number) => calls.fillText.push([text, x, y]),
      beginPath: () => {},
      arc: (...args: number[]) => calls.arc.push(args),
      fill: () => {},
    } as unknown as CanvasRenderingContext2D;

    const comp = debugEntity.getComponent(HudLayoutDebugRenderComponent);
    comp.doRender(ctx, new CameraStub(), new Vector2D(400, 300));

    expect(calls.strokeRect).toContainEqual([0, 0, 120, 60]);
    expect(calls.fillText.some(([text]) => text.includes("Node"))).toBe(true);
    expect(calls.arc.length).toBeGreaterThan(0);
  });

  test("skips hidden nodes by default and can include them", () => {
    const hiddenNode = new Node();
    const hiddenLayout = new HudLayoutNodeComponent({ width: 50, height: 40, anchor: "top-left" });
    hiddenLayout.visible = false;
    hiddenNode.addComponent(hiddenLayout);
    hiddenNode.awake();

    resolveHudLayout(EcsRuntime.getCurrent(), { x: 0, y: 0, width: 200, height: 200 });

    const hiddenCalls: number[][] = [];
    const ctx = {
      strokeStyle: "",
      lineWidth: 0,
      fillStyle: "",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      strokeRect: (...args: number[]) => hiddenCalls.push(args),
      fillText: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
    } as unknown as CanvasRenderingContext2D;

    const host = new Node();
    const defaultComp = new HudLayoutDebugRenderComponent();
    host.addComponent(defaultComp);
    host.awake();
    defaultComp.doRender(ctx, new CameraStub(), new Vector2D(200, 200));
    expect(hiddenCalls).toEqual([]);

    hiddenCalls.length = 0;
    const includeComp = new HudLayoutDebugRenderComponent({ includeHidden: true });
    const host2 = new Node();
    host2.addComponent(includeComp);
    host2.awake();
    includeComp.doRender(ctx, new CameraStub(), new Vector2D(200, 200));

    expect(hiddenCalls).toContainEqual([0, 0, 50, 40]);
  });
});
