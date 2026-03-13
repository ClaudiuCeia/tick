import type { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Vector2D } from "../math/Vector2D.ts";
import type { HudViewport } from "../render/HudViewport.ts";
import type { HudInputComponent } from "./HudInputComponent.ts";
import { HudInputEvent, type HudInputEventType, type HudPointerType } from "./HudInputEvent.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";

type RouterConfig = {
  canvasElement?: HTMLCanvasElement | null;
  hudViewport?: HudViewport | null;
};

type AttachedHandlers = {
  mousemove: (event: MouseEvent) => void;
  mousedown: (event: MouseEvent) => void;
  mouseup: (event: MouseEvent) => void;
  click: (event: MouseEvent) => void;
  wheel: (event: WheelEvent) => void;
  touchstart: (event: TouchEvent) => void;
  touchmove: (event: TouchEvent) => void;
  touchend: (event: TouchEvent) => void;
  touchcancel: (event: TouchEvent) => void;
  keydown: (event: KeyboardEvent) => void;
  keyup: (event: KeyboardEvent) => void;
};

type RuntimeState = {
  components: Set<HudInputComponent>;
  focusedId: string | null;
  hoveredIds: Set<string>;
  hudViewport: HudViewport | null;
  canvasElement: HTMLCanvasElement | null;
  handlers: AttachedHandlers | null;
  capturedPointerEvents: Set<
    Extract<HudInputEventType, "pointermove" | "pointerdown" | "pointerup" | "click" | "wheel">
  >;
};

type NativeConsumableEvent = Event & {
  stopImmediatePropagation?: () => void;
};

const clientToCanvas = (point: Vector2D, canvas: HTMLCanvasElement): Vector2D => {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return Vector2D.zero;
  }

  return new Vector2D(
    ((point.x - rect.left) / rect.width) * canvas.width,
    ((point.y - rect.top) / rect.height) * canvas.height,
  );
};

const makeEvent = (
  type: HudInputEventType,
  params: {
    hudPoint: Vector2D | null;
    clientPoint?: Vector2D;
    pointerType?: HudPointerType;
    touchId?: number;
    key?: string;
    code?: string;
    wheelDelta?: Vector2D;
    nativeEvent?: Event;
  },
): HudInputEvent => new HudInputEvent(type, params);

class HudInputRouterImpl {
  private states = new WeakMap<EcsRuntime, RuntimeState>();

  private consumeNativeEvent(event?: Event): void {
    if (!event) return;

    const nativeEvent = event as NativeConsumableEvent;
    event.preventDefault();
    event.stopPropagation();
    nativeEvent.stopImmediatePropagation?.();
  }

  private getState(runtime: EcsRuntime): RuntimeState {
    let state = this.states.get(runtime);
    if (!state) {
      state = {
        components: new Set(),
        focusedId: null,
        hoveredIds: new Set(),
        hudViewport: null,
        canvasElement: null,
        handlers: null,
        capturedPointerEvents: new Set(),
      };
      this.states.set(runtime, state);
    }
    return state;
  }

  public configure(runtime: EcsRuntime, config: RouterConfig): void {
    const state = this.getState(runtime);
    state.hudViewport = config.hudViewport ?? null;

    const canvas = config.canvasElement ?? null;
    if (canvas === state.canvasElement) {
      return;
    }

    this.detach(runtime);
    if (!canvas) return;

    const handlers: AttachedHandlers = {
      mousemove: (event) => {
        const clientPoint = new Vector2D(event.clientX, event.clientY);
        const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
        this.updateHover(runtime, hudPoint, clientPoint, event);
        this.routePointer(runtime, "pointermove", hudPoint, clientPoint, {
          pointerType: "mouse",
          nativeEvent: event,
        });
      },
      mousedown: (event) => {
        const clientPoint = new Vector2D(event.clientX, event.clientY);
        const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
        this.routePointer(runtime, "pointerdown", hudPoint, clientPoint, {
          pointerType: "mouse",
          nativeEvent: event,
        });
      },
      mouseup: (event) => {
        const clientPoint = new Vector2D(event.clientX, event.clientY);
        const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
        this.routePointer(runtime, "pointerup", hudPoint, clientPoint, {
          pointerType: "mouse",
          nativeEvent: event,
        });
      },
      click: (event) => {
        const clientPoint = new Vector2D(event.clientX, event.clientY);
        const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
        this.routePointer(runtime, "click", hudPoint, clientPoint, {
          pointerType: "mouse",
          nativeEvent: event,
        });
      },
      wheel: (event) => {
        const clientPoint = new Vector2D(event.clientX, event.clientY);
        const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
        this.routePointer(runtime, "wheel", hudPoint, clientPoint, {
          pointerType: "mouse",
          wheelDelta: new Vector2D(event.deltaX, event.deltaY),
          nativeEvent: event,
        });
      },
      touchstart: (event) => {
        for (let i = 0; i < event.changedTouches.length; i++) {
          const touch = event.changedTouches[i];
          if (!touch) continue;
          const clientPoint = new Vector2D(touch.clientX, touch.clientY);
          const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
          this.routePointer(runtime, "touchstart", hudPoint, clientPoint, {
            pointerType: "touch",
            touchId: touch.identifier,
            nativeEvent: event,
          });
        }
      },
      touchmove: (event) => {
        for (let i = 0; i < event.changedTouches.length; i++) {
          const touch = event.changedTouches[i];
          if (!touch) continue;
          const clientPoint = new Vector2D(touch.clientX, touch.clientY);
          const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
          this.routePointer(runtime, "touchmove", hudPoint, clientPoint, {
            pointerType: "touch",
            touchId: touch.identifier,
            nativeEvent: event,
          });
        }
      },
      touchend: (event) => {
        for (let i = 0; i < event.changedTouches.length; i++) {
          const touch = event.changedTouches[i];
          if (!touch) continue;
          const clientPoint = new Vector2D(touch.clientX, touch.clientY);
          const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
          this.routePointer(runtime, "touchend", hudPoint, clientPoint, {
            pointerType: "touch",
            touchId: touch.identifier,
            nativeEvent: event,
          });
        }
      },
      touchcancel: (event) => {
        for (let i = 0; i < event.changedTouches.length; i++) {
          const touch = event.changedTouches[i];
          if (!touch) continue;
          const clientPoint = new Vector2D(touch.clientX, touch.clientY);
          const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
          this.routePointer(runtime, "touchcancel", hudPoint, clientPoint, {
            pointerType: "touch",
            touchId: touch.identifier,
            nativeEvent: event,
          });
        }
      },
      keydown: (event) => {
        this.routeKey(runtime, "keydown", event.key, event.code, event);
      },
      keyup: (event) => {
        this.routeKey(runtime, "keyup", event.key, event.code, event);
      },
    };

    canvas.addEventListener("mousemove", handlers.mousemove);
    canvas.addEventListener("mousedown", handlers.mousedown);
    canvas.addEventListener("mouseup", handlers.mouseup);
    canvas.addEventListener("click", handlers.click);
    canvas.addEventListener("wheel", handlers.wheel);
    canvas.addEventListener("touchstart", handlers.touchstart, { passive: true });
    canvas.addEventListener("touchmove", handlers.touchmove, { passive: true });
    canvas.addEventListener("touchend", handlers.touchend, { passive: true });
    canvas.addEventListener("touchcancel", handlers.touchcancel, { passive: true });

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handlers.keydown, { capture: true });
      window.addEventListener("keyup", handlers.keyup, { capture: true });
    }

    state.canvasElement = canvas;
    state.handlers = handlers;
  }

  public detach(runtime: EcsRuntime): void {
    const state = this.getState(runtime);
    if (!state.canvasElement || !state.handlers) {
      state.canvasElement = null;
      state.handlers = null;
      return;
    }

    const { canvasElement: canvas, handlers } = state;
    canvas.removeEventListener("mousemove", handlers.mousemove);
    canvas.removeEventListener("mousedown", handlers.mousedown);
    canvas.removeEventListener("mouseup", handlers.mouseup);
    canvas.removeEventListener("click", handlers.click);
    canvas.removeEventListener("wheel", handlers.wheel);
    canvas.removeEventListener("touchstart", handlers.touchstart);
    canvas.removeEventListener("touchmove", handlers.touchmove);
    canvas.removeEventListener("touchend", handlers.touchend);
    canvas.removeEventListener("touchcancel", handlers.touchcancel);

    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", handlers.keydown, true);
      window.removeEventListener("keyup", handlers.keyup, true);
    }

    state.canvasElement = null;
    state.handlers = null;
  }

  public register(component: HudInputComponent, runtime: EcsRuntime): void {
    this.getState(runtime).components.add(component);
  }

  public unregister(component: HudInputComponent, runtime: EcsRuntime): void {
    const state = this.getState(runtime);
    state.components.delete(component);
    state.hoveredIds.delete(component.ent.id);
    if (state.focusedId === component.ent.id) {
      state.focusedId = null;
    }
  }

  public isFocused(component: HudInputComponent, runtime: EcsRuntime): boolean {
    return this.getState(runtime).focusedId === component.ent.id;
  }

  public consumePointerCapture(
    runtime: EcsRuntime,
    type: Extract<
      HudInputEventType,
      "pointermove" | "pointerdown" | "pointerup" | "click" | "wheel"
    >,
  ): boolean {
    const state = this.getState(runtime);
    const captured = state.capturedPointerEvents.has(type);
    state.capturedPointerEvents.delete(type);
    return captured;
  }

  public routePointer(
    runtime: EcsRuntime,
    type: Extract<
      HudInputEventType,
      | "pointermove"
      | "pointerdown"
      | "pointerup"
      | "click"
      | "wheel"
      | "touchstart"
      | "touchmove"
      | "touchend"
      | "touchcancel"
    >,
    hudPoint: Vector2D,
    clientPoint: Vector2D,
    options: {
      pointerType: HudPointerType;
      touchId?: number;
      wheelDelta?: Vector2D;
      nativeEvent?: Event;
    },
  ): void {
    const state = this.getState(runtime);
    const candidates = this.getPointerCandidates(runtime, hudPoint, options.pointerType);

    if ((type === "pointerdown" || type === "touchstart") && candidates.length === 0) {
      this.setFocused(state, null, options.nativeEvent, hudPoint, clientPoint, options.pointerType);
    }

    for (const component of candidates) {
      const event = makeEvent(type, {
        hudPoint,
        clientPoint,
        pointerType: options.pointerType,
        touchId: options.touchId,
        wheelDelta: options.wheelDelta,
        nativeEvent: options.nativeEvent,
      });

      component.handleHudInput(event);

      if ((type === "pointerdown" || type === "touchstart") && component.focusable) {
        this.setFocused(
          state,
          component,
          options.nativeEvent,
          hudPoint,
          clientPoint,
          options.pointerType,
        );
      }

      if (event.propagationStopped) {
        this.consumeNativeEvent(options.nativeEvent);
        if (
          type === "pointermove" ||
          type === "pointerdown" ||
          type === "pointerup" ||
          type === "click" ||
          type === "wheel"
        ) {
          state.capturedPointerEvents.add(type);
        }
        break;
      }
    }
  }

  public routeKey(
    runtime: EcsRuntime,
    type: Extract<HudInputEventType, "keydown" | "keyup">,
    key: string,
    code: string,
    nativeEvent?: Event,
  ): void {
    const state = this.getState(runtime);

    const all = Array.from(state.components).filter(
      (component) =>
        component.ent.isAwake &&
        component.enabled &&
        component.interactive &&
        component.keyboardEnabled,
    );

    const focused =
      state.focusedId === null
        ? null
        : (all.find(
            (component) =>
              component.ent.id === state.focusedId && component.keyboardMode === "focused",
          ) ?? null);

    const globals = all
      .filter((component) => component.keyboardMode === "global" && component !== focused)
      .sort((a, b) => this.sortByPriority(a, b));

    const targets = focused ? [focused, ...globals] : globals;

    for (const component of targets) {
      const event = makeEvent(type, {
        hudPoint: null,
        key,
        code,
        nativeEvent,
      });
      component.handleHudInput(event);
      if (event.propagationStopped) {
        this.consumeNativeEvent(nativeEvent);
        break;
      }
    }
  }

  private setFocused(
    state: RuntimeState,
    next: HudInputComponent | null,
    nativeEvent?: Event,
    hudPoint: Vector2D | null = null,
    clientPoint: Vector2D | null = null,
    pointerType: HudPointerType = "mouse",
  ): void {
    const prevId = state.focusedId;
    const nextId = next?.ent.id ?? null;
    if (prevId === nextId) return;

    const prev =
      prevId === null
        ? null
        : (Array.from(state.components).find((component) => component.ent.id === prevId) ?? null);

    state.focusedId = nextId;

    if (prev) {
      prev.handleHudInput(
        makeEvent("blur", {
          hudPoint,
          clientPoint: clientPoint ?? undefined,
          pointerType,
          nativeEvent,
        }),
      );
    }

    if (next) {
      next.handleHudInput(
        makeEvent("focus", {
          hudPoint,
          clientPoint: clientPoint ?? undefined,
          pointerType,
          nativeEvent,
        }),
      );
    }
  }

  private updateHover(
    runtime: EcsRuntime,
    hudPoint: Vector2D,
    clientPoint: Vector2D,
    nativeEvent?: Event,
  ): void {
    const state = this.getState(runtime);
    const hits = this.getPointerCandidates(runtime, hudPoint, "mouse");
    const nextIds = new Set(hits.map((component) => component.ent.id));

    for (const component of hits) {
      if (state.hoveredIds.has(component.ent.id)) continue;
      component.handleHudInput(
        makeEvent("pointerenter", {
          hudPoint,
          clientPoint,
          pointerType: "mouse",
          nativeEvent,
        }),
      );
    }

    for (const id of state.hoveredIds) {
      if (nextIds.has(id)) continue;
      const component = Array.from(state.components).find((entry) => entry.ent.id === id);
      if (!component) continue;
      component.handleHudInput(
        makeEvent("pointerleave", {
          hudPoint,
          clientPoint,
          pointerType: "mouse",
          nativeEvent,
        }),
      );
    }

    state.hoveredIds = nextIds;
  }

  private getPointerCandidates(
    runtime: EcsRuntime,
    hudPoint: Vector2D,
    pointerType: HudPointerType,
  ): HudInputComponent[] {
    const state = this.getState(runtime);

    return Array.from(state.components)
      .filter((component) => component.ent.isAwake)
      .filter((component) => component.enabled && component.interactive)
      .filter((component) =>
        pointerType === "touch" ? component.touchEnabled : component.pointerEnabled,
      )
      .filter((component) => {
        if (!component.ent.hasComponent(HudLayoutNodeComponent)) {
          return false;
        }
        const node = component.ent.getComponent(HudLayoutNodeComponent);
        if (!node.visible || !node.interactive) return false;
        return node.containsHudPoint(hudPoint);
      })
      .sort((a, b) => this.sortByPriority(a, b));
  }

  private sortByPriority(a: HudInputComponent, b: HudInputComponent): number {
    const zA = this.getHudZIndex(a);
    const zB = this.getHudZIndex(b);
    if (zA !== zB) return zB - zA;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.ent.id.localeCompare(a.ent.id);
  }

  private getHudZIndex(component: HudInputComponent): number {
    let max = Number.NEGATIVE_INFINITY;
    for (const entry of component.ent.components) {
      const zIndex = (entry as { zIndex?: unknown }).zIndex;
      if (typeof zIndex === "number") {
        max = Math.max(max, zIndex);
      }
    }
    return Number.isFinite(max) ? max : 0;
  }

  private clientToHud(
    runtime: EcsRuntime,
    clientPoint: Vector2D,
    canvas: HTMLCanvasElement,
  ): Vector2D {
    const state = this.getState(runtime);
    if (state.hudViewport) {
      return state.hudViewport.clientToHud(clientPoint, canvas);
    }
    return clientToCanvas(clientPoint, canvas);
  }
}

export const HudInputRouter = new HudInputRouterImpl();
