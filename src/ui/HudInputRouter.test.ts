import { beforeEach, describe, expect, test } from "bun:test";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Entity } from "../ecs/Entity.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";
import { InputManager } from "../input/Input.ts";
import { Vector2D } from "../math/Vector2D.ts";
import { HudInputComponent } from "./HudInputComponent.ts";
import type { HudInputEvent } from "./HudInputEvent.ts";
import { HudInputRouter } from "./HudInputRouter.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { resolveHudLayout } from "./HudLayoutResolver.ts";
import { HudRenderComponent } from "../render/HudRenderComponent.ts";
import { RenderLayer } from "../render/RenderLayer.ts";

class Node extends Entity {}

class RecorderInput extends HudInputComponent<Node> {
  constructor(
    private readonly id: string,
    private readonly log: string[],
  ) {
    super();
  }

  public stopOn: string | null = null;
  public beforePointerDown: (() => void) | null = null;
  public beforeKeyDown: (() => void) | null = null;

  protected override onPointerDown(event: HudInputEvent): void {
    this.log.push(`${this.id}:pointerdown`);
    this.beforePointerDown?.();
    if (this.stopOn === "pointerdown") event.stopPropagation();
  }

  protected override onPointerUp(): void {
    this.log.push(`${this.id}:pointerup`);
  }

  protected override onPointerCancel(): void {
    this.log.push(`${this.id}:pointercancel`);
  }

  protected override onPointerEnter(): void {
    this.log.push(`${this.id}:pointerenter`);
  }

  protected override onPointerLeave(): void {
    this.log.push(`${this.id}:pointerleave`);
  }

  protected override onTouchStart(event: HudInputEvent): void {
    this.log.push(`${this.id}:touchstart`);
    if (this.stopOn === "touchstart") event.stopPropagation();
  }

  protected override onTouchCancel(): void {
    this.log.push(`${this.id}:touchcancel`);
  }

  protected override onKeyDown(event: HudInputEvent): void {
    this.log.push(`${this.id}:keydown:${event.key}`);
    this.beforeKeyDown?.();
    if (this.stopOn === "keydown") event.stopPropagation();
  }

  protected override onFocus(): void {
    this.log.push(`${this.id}:focus`);
  }

  protected override onBlur(): void {
    this.log.push(`${this.id}:blur`);
  }
}

type ListenerEntry = {
  listener: EventListener;
  capture: boolean;
  passive: boolean;
};

const toEventListener = (listener: EventListenerOrEventListenerObject): EventListener =>
  typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);

class FakeEventTarget {
  private listeners = new Map<string, ListenerEntry[]>();

  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    const passive = typeof options === "boolean" ? false : (options?.passive ?? false);
    const fn = toEventListener(listener);

    const entries = this.listeners.get(type) ?? [];
    entries.push({ listener: fn, capture, passive });
    this.listeners.set(type, entries);
  }

  public removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    const entries = this.listeners.get(type);
    if (!entries) return;

    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    const fn = toEventListener(listener);

    const index = entries.findIndex((entry) => entry.listener === fn && entry.capture === capture);
    if (index === -1) return;

    entries.splice(index, 1);
    if (entries.length === 0) {
      this.listeners.delete(type);
    }
  }

  public dispatch(type: string, event: FakeDomEvent): void {
    const entries = [...(this.listeners.get(type) ?? [])];
    const captured = entries.filter((entry) => entry.capture);
    const bubbled = entries.filter((entry) => !entry.capture);

    for (const entry of [...captured, ...bubbled]) {
      entry.listener(event as unknown as Event);
      if (event.immediatePropagationStopped) {
        break;
      }
    }
  }

  public getListeners(type: string): ListenerEntry[] {
    return [...(this.listeners.get(type) ?? [])];
  }
}

class FakeDomEvent {
  public defaultPrevented = false;
  public propagationStopped = false;
  public immediatePropagationStopped = false;

  constructor(readonly init: Record<string, unknown> = {}) {
    Object.assign(this, init);
  }

  public preventDefault(): void {
    this.defaultPrevented = true;
  }

  public stopPropagation(): void {
    this.propagationStopped = true;
  }

  public stopImmediatePropagation(): void {
    this.immediatePropagationStopped = true;
    this.propagationStopped = true;
  }
}

const makeCanvas = (): HTMLCanvasElement =>
  ({
    width: 400,
    height: 300,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: 400,
        height: 300,
      } as DOMRect;
    },
  }) as unknown as HTMLCanvasElement;

class FakeCanvas extends FakeEventTarget {
  public width = 400;
  public height = 300;
  public capturedPointers = new Set<number>();

  public getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: 400, height: 300 } as DOMRect;
  }

  public setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  public hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  public releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }
}

class InputHud extends HudRenderComponent<Node> {
  constructor() {
    super(RenderLayer.HUD);
  }

  override doRender(): void {}
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

  test("consumes native pointer and keyboard events when propagation is stopped", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      entity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const input = new RecorderInput("node", log);
      input.stopOn = "pointerdown";
      input.focusable = true;
      input.keyboardMode = "focused";
      entity.addComponent(input);
      entity.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });

    const pointerEvent = new FakeDomEvent({ clientX: 100, clientY: 100 }) as unknown as MouseEvent;
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, {
      pointerType: "mouse",
      nativeEvent: pointerEvent,
    });

    const keyboardEvent = new FakeDomEvent({
      key: "Enter",
      code: "Enter",
    }) as unknown as KeyboardEvent;
    const inputComponent = Array.from(runtime.registry.getEntitiesByType(Node))[0]?.getComponent(
      RecorderInput,
    );
    if (!inputComponent) throw new Error("Missing input component");
    inputComponent.stopOn = "keydown";
    HudInputRouter.routeKey(runtime, "keydown", "Enter", "Enter", keyboardEvent);

    expect((pointerEvent as unknown as FakeDomEvent).defaultPrevented).toBe(true);
    expect((pointerEvent as unknown as FakeDomEvent).propagationStopped).toBe(true);
    expect((pointerEvent as unknown as FakeDomEvent).immediatePropagationStopped).toBe(true);
    expect((keyboardEvent as unknown as FakeDomEvent).defaultPrevented).toBe(true);
    expect((keyboardEvent as unknown as FakeDomEvent).propagationStopped).toBe(true);
    expect((keyboardEvent as unknown as FakeDomEvent).immediatePropagationStopped).toBe(true);
  });

  test("does not consume native events when HUD propagation continues", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      entity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const input = new RecorderInput("node", log);
      input.focusable = true;
      input.keyboardMode = "focused";
      entity.addComponent(input);
      entity.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });

    const pointerEvent = new FakeDomEvent({ clientX: 100, clientY: 100 }) as unknown as MouseEvent;
    HudInputRouter.routePointer(runtime, "click", point, point, {
      pointerType: "mouse",
      nativeEvent: pointerEvent,
    });

    const keyboardEvent = new FakeDomEvent({ key: "a", code: "KeyA" }) as unknown as KeyboardEvent;
    HudInputRouter.routeKey(runtime, "keydown", "a", "KeyA", keyboardEvent);

    expect((pointerEvent as unknown as FakeDomEvent).defaultPrevented).toBe(false);
    expect((pointerEvent as unknown as FakeDomEvent).propagationStopped).toBe(false);
    expect((keyboardEvent as unknown as FakeDomEvent).defaultPrevented).toBe(false);
    expect((keyboardEvent as unknown as FakeDomEvent).propagationStopped).toBe(false);
  });

  test("consumed HUD keyboard events do not reach InputManager", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const fakeWindow = new FakeEventTarget() as unknown as Window;

    EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      entity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const input = new RecorderInput("node", []);
      input.focusable = true;
      input.keyboardMode = "focused";
      input.stopOn = "keydown";
      entity.addComponent(input);
      entity.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });

    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      value: fakeWindow,
      configurable: true,
      writable: true,
    });

    try {
      HudInputRouter.configure(runtime, { canvasElement: makeCanvas() });
      const input = new InputManager();
      input.init(fakeWindow as unknown as EventTarget);

      (fakeWindow as unknown as FakeEventTarget).dispatch(
        "keydown",
        new FakeDomEvent({ key: "Enter", code: "Enter" }),
      );

      expect(input.isDown("Enter")).toBe(false);

      const hudInput = Array.from(runtime.registry.getEntitiesByType(Node))[0]?.getComponent(
        RecorderInput,
      );
      if (!hudInput) throw new Error("Missing HUD input component");
      hudInput.stopOn = null;

      (fakeWindow as unknown as FakeEventTarget).dispatch(
        "keydown",
        new FakeDomEvent({ key: "a", code: "KeyA" }),
      );

      expect(input.isDown("a")).toBe(true);
      input.dispose();
    } finally {
      HudInputRouter.detach(runtime);
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
  });

  test("uses exact reverse equal-z draw order and focuses only the topmost target", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const first = new Node();
      first.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      first.addComponent(new InputHud());
      const firstInput = new RecorderInput("first", log);
      firstInput.priority = 100;
      firstInput.focusable = true;
      first.addComponent(firstInput);
      first.awake();

      const last = new Node();
      last.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      last.addComponent(new InputHud());
      const lastInput = new RecorderInput("last", log);
      lastInput.priority = -100;
      lastInput.focusable = true;
      last.addComponent(lastInput);
      last.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, {
      pointerType: "mouse",
      pointerId: 7,
    });

    expect(log).toEqual(["last:pointerdown", "last:focus", "first:pointerdown"]);
  });

  test("inherits hidden and noninteractive state from container ancestors", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    const rootNode = EcsRuntime.runWith(runtime, () => {
      const root = new Node();
      const layout = new HudLayoutNodeComponent({ width: 300, height: 300 });
      root.addComponent(layout);
      const child = new Node();
      child.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      child.addComponent(new RecorderInput("child", log));
      root.addChild(child);
      root.awake();
      return layout;
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    rootNode.visible = false;
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });
    rootNode.visible = true;
    rootNode.interactive = false;
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });
    expect(log).toEqual([]);
  });

  test("captures pointer release outside and routes cancellation", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];
    const canvas = new FakeCanvas();

    EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      entity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      entity.addComponent(new RecorderInput("node", log));
      entity.awake();
    });
    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.configure(runtime, { canvasElement: canvas as unknown as HTMLCanvasElement });

    canvas.dispatch(
      "pointerdown",
      new FakeDomEvent({ clientX: 100, clientY: 100, pointerId: 4, pointerType: "mouse" }),
    );
    canvas.dispatch(
      "pointerup",
      new FakeDomEvent({ clientX: 500, clientY: 500, pointerId: 4, pointerType: "mouse" }),
    );
    canvas.dispatch(
      "pointerdown",
      new FakeDomEvent({ clientX: 100, clientY: 100, pointerId: 5, pointerType: "mouse" }),
    );
    canvas.dispatch(
      "pointercancel",
      new FakeDomEvent({ clientX: 500, clientY: 500, pointerId: 5, pointerType: "mouse" }),
    );

    expect(log).toEqual([
      "node:pointerdown",
      "node:pointerup",
      "node:pointerdown",
      "node:pointercancel",
      "node:pointerleave",
    ]);
    expect(canvas.capturedPointers.size).toBe(0);
    expect(canvas.getListeners("pointerdown")[0]?.passive).toBe(false);
    expect(canvas.getListeners("wheel")[0]?.passive).toBe(false);
    HudInputRouter.detach(runtime);
  });

  test("detach is idempotent and respects router ownership", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const canvas = new FakeCanvas();
    const owner = {};
    HudInputRouter.configure(runtime, {
      canvasElement: canvas as unknown as HTMLCanvasElement,
      owner,
    });

    HudInputRouter.detach(runtime, {});
    expect(canvas.getListeners("pointerdown")).toHaveLength(1);
    HudInputRouter.detach(runtime, owner);
    HudInputRouter.detach(runtime, owner);
    expect(canvas.getListeners("pointerdown")).toHaveLength(0);
  });

  test("revalidates pointer targets before each callback", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const bottom = new Node();
      bottom.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const bottomInput = new RecorderInput("bottom", log);
      bottom.addComponent(bottomInput);
      bottom.awake();

      const top = new Node();
      top.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const topInput = new RecorderInput("top", log);
      topInput.priority = 1;
      topInput.beforePointerDown = () => {
        bottomInput.enabled = false;
      };
      top.addComponent(topInput);
      top.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });
    expect(log).toEqual(["top:pointerdown"]);
  });

  test("skips pointer targets destroyed by an earlier callback", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const bottom = new Node();
      bottom.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      bottom.addComponent(new RecorderInput("bottom", log));
      bottom.awake();

      const top = new Node();
      top.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const topInput = new RecorderInput("top", log);
      topInput.priority = 1;
      topInput.beforePointerDown = () => bottom.destroy();
      top.addComponent(topInput);
      top.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });
    expect(log).toEqual(["top:pointerdown"]);
  });

  test("revalidates keyboard targets before each callback", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];

    EcsRuntime.runWith(runtime, () => {
      const bottom = new Node();
      const bottomLayout = new HudLayoutNodeComponent({ width: 200, height: 200 });
      bottom.addComponent(bottomLayout);
      const bottomInput = new RecorderInput("bottom", log);
      bottomInput.keyboardMode = "global";
      bottom.addComponent(bottomInput);
      bottom.awake();

      const top = new Node();
      top.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const topInput = new RecorderInput("top", log);
      topInput.keyboardMode = "global";
      topInput.priority = 1;
      topInput.beforeKeyDown = () => {
        bottomLayout.visible = false;
      };
      top.addComponent(topInput);
      top.awake();
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routeKey(runtime, "keydown", "a", "KeyA");
    expect(log).toEqual(["top:keydown:a"]);
  });

  test("blurs focus when an ancestor becomes hidden or noninteractive", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const log: string[] = [];
    const { rootLayout, input } = EcsRuntime.runWith(runtime, () => {
      const root = new Node();
      const rootLayout = new HudLayoutNodeComponent({ width: 300, height: 300 });
      root.addComponent(rootLayout);
      const child = new Node();
      child.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      const input = new RecorderInput("child", log);
      input.focusable = true;
      child.addComponent(input);
      root.addChild(child);
      root.awake();
      return { rootLayout, input };
    });

    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });
    log.length = 0;
    rootLayout.visible = false;
    HudInputRouter.revalidate(runtime);
    expect(log).toEqual(["child:blur"]);
    expect(input.hasFocus).toBe(false);

    rootLayout.visible = true;
    HudInputRouter.routePointer(runtime, "pointerdown", point, point, { pointerType: "mouse" });
    log.length = 0;
    rootLayout.interactive = false;
    HudInputRouter.revalidate(runtime);
    expect(log).toEqual(["child:blur"]);
    expect(input.hasFocus).toBe(false);
  });

  test("detach releases all active browser pointer captures", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const canvas = new FakeCanvas();
    EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      entity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      entity.addComponent(new RecorderInput("node", []));
      entity.awake();
    });
    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.configure(runtime, { canvasElement: canvas as unknown as HTMLCanvasElement });

    canvas.dispatch(
      "pointerdown",
      new FakeDomEvent({ clientX: 100, clientY: 100, pointerId: 10, pointerType: "mouse" }),
    );
    canvas.dispatch(
      "pointerdown",
      new FakeDomEvent({ clientX: 100, clientY: 100, pointerId: 11, pointerType: "mouse" }),
    );
    expect(canvas.capturedPointers).toEqual(new Set([10, 11]));

    HudInputRouter.detach(runtime);
    expect(canvas.capturedPointers.size).toBe(0);
  });

  test("delivers pointerleave after hovered targets become ineligible", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const canvas = new FakeCanvas();
    const log: string[] = [];
    const { layout, input } = EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      const layout = new HudLayoutNodeComponent({ width: 200, height: 200 });
      const input = new RecorderInput("node", log);
      entity.addComponent(layout);
      entity.addComponent(input);
      entity.awake();
      return { layout, input };
    });
    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.configure(runtime, { canvasElement: canvas as unknown as HTMLCanvasElement });
    const move = () =>
      canvas.dispatch(
        "pointermove",
        new FakeDomEvent({ clientX: 100, clientY: 100, pointerId: 1, pointerType: "mouse" }),
      );

    move();
    input.enabled = false;
    move();
    input.enabled = true;
    move();
    layout.visible = false;
    move();
    layout.visible = true;
    move();
    layout.interactive = false;
    move();

    expect(log).toEqual([
      "node:pointerenter",
      "node:pointerleave",
      "node:pointerenter",
      "node:pointerleave",
      "node:pointerenter",
      "node:pointerleave",
    ]);
    HudInputRouter.detach(runtime);
  });

  test("cancellation clears hover so the next in-bounds move re-enters", () => {
    const runtime = new EcsRuntime(new EntityRegistry());
    const canvas = new FakeCanvas();
    const log: string[] = [];
    EcsRuntime.runWith(runtime, () => {
      const entity = new Node();
      entity.addComponent(new HudLayoutNodeComponent({ width: 200, height: 200 }));
      entity.addComponent(new RecorderInput("node", log));
      entity.awake();
    });
    resolveHudLayout(runtime, { x: 0, y: 0, width: 400, height: 300 });
    HudInputRouter.configure(runtime, { canvasElement: canvas as unknown as HTMLCanvasElement });
    const pointer = (type: string, pointerId: number, pointerType = "mouse") =>
      canvas.dispatch(
        type,
        new FakeDomEvent({ clientX: 100, clientY: 100, pointerId, pointerType }),
      );

    pointer("pointermove", 1);
    pointer("pointerdown", 1);
    pointer("pointercancel", 1);
    pointer("pointermove", 1);

    pointer("pointerdown", 2);
    canvas.capturedPointers.delete(2);
    pointer("lostpointercapture", 2);
    pointer("pointermove", 2);

    pointer("pointerdown", 3, "touch");
    pointer("pointercancel", 3, "touch");
    pointer("pointermove", 4);

    expect(log).toEqual([
      "node:pointerenter",
      "node:pointerdown",
      "node:pointercancel",
      "node:pointerleave",
      "node:pointerenter",
      "node:pointerdown",
      "node:pointercancel",
      "node:pointerleave",
      "node:pointerenter",
      "node:touchstart",
      "node:pointerdown",
      "node:touchcancel",
      "node:pointerleave",
      "node:pointerenter",
    ]);
    HudInputRouter.detach(runtime);
  });
});
