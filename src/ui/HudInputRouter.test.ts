import { beforeEach, describe, expect, test } from "bun:test";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Entity } from "../ecs/Entity.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";
import { Vector2D } from "../math/Vector2D.ts";
import { HudInputComponent } from "./HudInputComponent.ts";
import type { HudInputEvent } from "./HudInputEvent.ts";
import { HudInputRouter } from "./HudInputRouter.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { resolveHudLayout } from "./HudLayoutResolver.ts";

class Node extends Entity {}

class RecorderInput extends HudInputComponent<Node> {
  constructor(
    private readonly id: string,
    private readonly log: string[],
  ) {
    super();
  }

  public stopOn: string | null = null;

  protected override onPointerDown(event: HudInputEvent): void {
    this.log.push(`${this.id}:pointerdown`);
    if (this.stopOn === "pointerdown") event.stopPropagation();
  }

  protected override onTouchStart(event: HudInputEvent): void {
    this.log.push(`${this.id}:touchstart`);
    if (this.stopOn === "touchstart") event.stopPropagation();
  }

  protected override onKeyDown(event: HudInputEvent): void {
    this.log.push(`${this.id}:keydown:${event.key}`);
    if (this.stopOn === "keydown") event.stopPropagation();
  }

  protected override onFocus(): void {
    this.log.push(`${this.id}:focus`);
  }

  protected override onBlur(): void {
    this.log.push(`${this.id}:blur`);
  }
}

const point = new Vector2D(100, 100);

beforeEach(() => {
  EcsRuntime.reset();
});

describe("HudInputRouter", () => {
  test("routes pointer events by priority and supports stopPropagation", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const bottom = new Node();
      bottom.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const bottomInput = new RecorderInput("bottom", log);
      bottomInput.priority = 1;
      bottom.addComponent(bottomInput);

      const top = new Node();
      top.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const topInput = new RecorderInput("top", log);
      topInput.priority = 10;
      topInput.stopOn = "pointerdown";
      top.addComponent(topInput);

      bottom.awake();
      top.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });

    expect(log).toEqual(["top:pointerdown"]);
  });

  test("respects layout visibility and interactivity flags", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    const nodeAndInput = EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      const node = new HudLayoutNodeComponent({ width: 200, height: 200 });
      const input = new RecorderInput("node", log);
      entity.addComponent(node);
      entity.addComponent(input);
      entity.awake();
      return { node, input };
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });

    nodeAndInput.node.visible = false;
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });

    nodeAndInput.node.visible = true;
    nodeAndInput.node.interactive = false;
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });

    nodeAndInput.node.interactive = true;
    nodeAndInput.input.interactive = false;
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });

    nodeAndInput.input.interactive = true;
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });

    expect(log).toEqual(["node:pointerdown"]);
  });

  test("routes keyboard to focused and global handlers", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const focusedEntity = new Node();
      focusedEntity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const focusedInput = new RecorderInput("focused", log);
      focusedInput.focusable = true;
      focusedInput.keyboardMode = "focused";
      focusedEntity.addComponent(focusedInput);
      focusedEntity.awake();

      const globalEntity = new Node();
      globalEntity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const globalInput = new RecorderInput("global", log);
      globalInput.keyboardMode = "global";
      globalEntity.addComponent(globalInput);
      globalEntity.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });

    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });
    log.length = 0;
    HudInputRouter.routeKey(runtime, "keydown", "a", "KeyA");
    HudInputRouter.routePointer(
      runtime,
      "pointerdown",
      new Vector2D(500, 500),
      new Vector2D(500, 500),
      { pointerType: "mouse" },
    );
    HudInputRouter.routeKey(runtime, "keydown", "b", "KeyB");

    expect(log).toEqual([
      "focused:keydown:a",
      "global:keydown:a",
      "focused:blur",
      "global:keydown:b",
    ]);
  });

  test("routes touch events", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      entity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      entity.addComponent(new RecorderInput("touch", log));
      entity.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routePointer(runtime, "touchstart", point, point, {
      pointerType: "touch",
      touchId: 1,
    });

    expect(log).toEqual(["touch:touchstart", "touch:pointerdown"]);
  });
});
