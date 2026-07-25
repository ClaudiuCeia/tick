import { describe, test, expect } from "bun:test";
import { InputManager } from "./Input.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";

type HandlerMap = Record<string, Array<(event: any) => void>>;

const makeTarget = (handlers: HandlerMap): EventTarget =>
  ({
    addEventListener(type: string, fn: EventListenerOrEventListenerObject) {
      handlers[type] ??= [];
      handlers[type].push(fn as (event: any) => void);
    },
    removeEventListener(type: string, fn: EventListenerOrEventListenerObject) {
      const list = handlers[type];
      if (!list) return;
      const i = list.indexOf(fn as (event: any) => void);
      if (i !== -1) list.splice(i, 1);
    },
  }) as unknown as EventTarget;

const emit = (handlers: HandlerMap, type: string, event: any): void => {
  for (const fn of handlers[type] ?? []) {
    fn(event);
  }
};

describe("InputManager", () => {
  test("tracks key down / pressed / released transitions", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));

    emit(handlers, "keydown", { key: "Space" });
    expect(input.isDown("Space")).toBe(true);
    expect(input.isPressed("Space")).toBe(true);

    input.clearFrame();
    expect(input.isPressed("Space")).toBe(false);
    expect(input.isDown("Space")).toBe(true);

    emit(handlers, "keyup", { key: "Space" });
    expect(input.isDown("Space")).toBe(false);
    expect(input.isReleased("Space")).toBe(true);
  });

  test("mouse button down / pressed / released transitions are tracked", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));

    emit(handlers, "mousedown", { button: 0 });
    expect(input.isMouseDown()).toBe(true);
    expect(input.isMouseDown(0)).toBe(true);
    expect(input.isMousePressed()).toBe(true);
    expect(input.isMousePressed(0)).toBe(true);
    expect(input.isMousePressed(2)).toBe(false);

    input.clearFrame();
    expect(input.isMousePressed()).toBe(false);
    expect(input.isMouseDown(0)).toBe(true);

    emit(handlers, "mouseup", { button: 0 });
    expect(input.isMouseDown(0)).toBe(false);
    expect(input.isMouseReleased()).toBe(true);
    expect(input.isMouseReleased(0)).toBe(true);
  });

  test("mouse move updates position and frame delta", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));

    emit(handlers, "mousemove", { clientX: 111, clientY: 222, buttons: 0 });
    expect(input.getMouseDelta().x).toBe(111);
    expect(input.getMouseDelta().y).toBe(222);

    emit(handlers, "mousemove", { clientX: 120, clientY: 225, buttons: 0 });
    expect(input.getMousePos().x).toBe(120);
    expect(input.getMousePos().y).toBe(225);
    expect(input.getMouseDelta().x).toBe(120);
    expect(input.getMouseDelta().y).toBe(225);

    input.clearFrame();
    expect(input.getMouseDelta().x).toBe(0);
    expect(input.getMouseDelta().y).toBe(0);
    expect(input.getMousePos().x).toBe(120);
    expect(input.getMousePos().y).toBe(225);
  });

  test("mouse click remains tracked and clears per frame", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));

    emit(handlers, "click", {});
    expect(input.isMouseClick()).toBe(true);

    input.clearFrame();
    expect(input.isMouseClick()).toBe(false);
  });

  test("wheel delta accumulates in frame and resets in clearFrame", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));

    emit(handlers, "wheel", { deltaY: 5 });
    emit(handlers, "wheel", { deltaY: -2 });
    expect(input.getWheelDeltaY()).toBe(3);

    input.clearFrame();
    expect(input.getWheelDeltaY()).toBe(0);
  });

  test("dragging starts only after movement while a button is down", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));

    emit(handlers, "mousemove", { clientX: 10, clientY: 20, buttons: 0 });
    emit(handlers, "mousedown", { button: 0 });

    expect(input.isDragging()).toBe(false);
    expect(input.isDragging(0)).toBe(false);
    expect(input.getDragStartPos(0)?.x).toBe(10);
    expect(input.getDragStartPos(0)?.y).toBe(20);

    emit(handlers, "mousemove", { clientX: 14, clientY: 26, buttons: 1 });
    expect(input.isDragging()).toBe(true);
    expect(input.isDragging(0)).toBe(true);
    expect(input.getDragStartPos(0)?.x).toBe(10);
    expect(input.getDragStartPos(0)?.y).toBe(20);

    emit(handlers, "mouseup", { button: 0 });
    expect(input.isDragging()).toBe(false);
    expect(input.getDragStartPos(0)).toBeNull();
  });

  test("mouse button events use their own client coordinates", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));

    emit(handlers, "mousedown", { button: 0, clientX: 40, clientY: 50 });
    expect(input.getMousePos().x).toBe(40);
    expect(input.getMousePos().y).toBe(50);
    expect(input.getDragStartPos(0)?.x).toBe(40);
    expect(input.getDragStartPos(0)?.y).toBe(50);

    emit(handlers, "mouseup", { button: 0, clientX: 60, clientY: 70 });
    expect(input.getMousePos().x).toBe(60);
    expect(input.getMousePos().y).toBe(70);
  });

  test("blur releases held keys and mouse buttons and ends dragging", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));
    emit(handlers, "keydown", { key: "a" });
    emit(handlers, "mousedown", { button: 0, clientX: 1, clientY: 2 });
    emit(handlers, "mousemove", { clientX: 2, clientY: 3, buttons: 1 });

    emit(handlers, "blur", {});

    expect(input.isDown("a")).toBe(false);
    expect(input.isReleased("a")).toBe(true);
    expect(input.isMouseDown(0)).toBe(false);
    expect(input.isMouseReleased(0)).toBe(true);
    expect(input.isDragging(0)).toBe(false);
  });

  test("mouseup on the owning window releases a button pressed on the target", () => {
    const handlers: HandlerMap = {};
    const outsideHandlers: HandlerMap = {};
    const target = makeTarget(handlers) as EventTarget & {
      ownerDocument: { defaultView: EventTarget };
    };
    target.ownerDocument = { defaultView: makeTarget(outsideHandlers) };
    const input = new InputManager();
    input.init(target);

    emit(handlers, "mousedown", { button: 0, clientX: 4, clientY: 5 });
    emit(outsideHandlers, "mouseup", { button: 0, clientX: 8, clientY: 9 });

    expect(input.isMouseDown(0)).toBe(false);
    expect(input.isMouseReleased(0)).toBe(true);
    expect(input.getMousePos().x).toBe(8);
    expect(input.getMousePos().y).toBe(9);
  });

  test("ignores a window-like global without event listener methods", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
      writable: true,
    });

    try {
      const input = new InputManager();
      input.init(makeTarget({}));
      input.dispose();
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
  });

  test("returned vectors cannot mutate internal input state", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));
    emit(handlers, "mousemove", { clientX: 10, clientY: 20, buttons: 0 });
    emit(handlers, "mousedown", { button: 0, clientX: 10, clientY: 20 });

    input.getMousePos().set(100, 200);
    input.getMouseDelta().set(100, 200);
    input.getDragStartPos(0)?.set(100, 200);

    expect(input.getMousePos().x).toBe(10);
    expect(input.getMousePos().y).toBe(20);
    expect(input.getMouseDelta().x).toBe(10);
    expect(input.getMouseDelta().y).toBe(20);
    expect(input.getDragStartPos(0)?.x).toBe(10);
    expect(input.getDragStartPos(0)?.y).toBe(20);
  });

  test("mousemove with no reported buttons repairs a missed outside mouseup", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));
    emit(handlers, "mousedown", { button: 0, clientX: 1, clientY: 1 });

    emit(handlers, "mousemove", { clientX: 2, clientY: 2, buttons: 0 });

    expect(input.isMouseDown(0)).toBe(false);
    expect(input.isMouseReleased(0)).toBe(true);
  });

  test("dispose removes listeners and clears state", () => {
    const handlers: HandlerMap = {};
    const input = new InputManager();
    input.init(makeTarget(handlers));

    emit(handlers, "keydown", { key: "a" });
    emit(handlers, "mousedown", { button: 0 });
    emit(handlers, "wheel", { deltaY: 10 });
    expect(input.isDown("a")).toBe(true);
    expect(input.isMouseDown(0)).toBe(true);
    expect(input.getWheelDeltaY()).toBe(10);

    input.dispose();
    expect(input.isDown("a")).toBe(false);
    expect(input.isMouseDown(0)).toBe(false);
    expect(input.getWheelDeltaY()).toBe(0);

    const keydownCount = handlers.keydown?.length ?? 0;
    const mousedownCount = handlers.mousedown?.length ?? 0;
    const wheelCount = handlers.wheel?.length ?? 0;
    expect(keydownCount).toBe(0);
    expect(mousedownCount).toBe(0);
    expect(wheelCount).toBe(0);
  });

  test("is runtime-scoped via EcsRuntime", () => {
    const runtimeA = new EcsRuntime(new EntityRegistry());
    const runtimeB = new EcsRuntime(new EntityRegistry());

    expect(runtimeA.input).not.toBe(runtimeB.input);

    const handlersA: HandlerMap = {};
    const handlersB: HandlerMap = {};

    runtimeA.input.init(makeTarget(handlersA));
    runtimeB.input.init(makeTarget(handlersB));

    emit(handlersA, "keydown", { key: "x" });
    emit(handlersA, "mousedown", { button: 2 });
    expect(runtimeA.input.isDown("x")).toBe(true);
    expect(runtimeB.input.isDown("x")).toBe(false);
    expect(runtimeA.input.isMouseDown(2)).toBe(true);
    expect(runtimeB.input.isMouseDown(2)).toBe(false);
  });
});
