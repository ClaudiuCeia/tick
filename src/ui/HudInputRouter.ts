import type { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Vector2D } from "../math/Vector2D.ts";
import type { HudViewport } from "../render/HudViewport.ts";
import type { HudInputComponent } from "./HudInputComponent.ts";
import { HudInputEvent, type HudInputEventType, type HudPointerType } from "./HudInputEvent.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { RenderSystem } from "../render/RenderSystem.ts";

type RouterConfig = {
  canvasElement?: HTMLCanvasElement | null;
  hudViewport?: HudViewport | null;
  owner?: object | null;
};

type AttachedHandlers = {
  pointermove: (event: PointerEvent) => void;
  pointerdown: (event: PointerEvent) => void;
  pointerup: (event: PointerEvent) => void;
  pointercancel: (event: PointerEvent) => void;
  pointerleave: (event: PointerEvent) => void;
  lostpointercapture: (event: PointerEvent) => void;
  click: (event: MouseEvent) => void;
  wheel: (event: WheelEvent) => void;
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
  keyboardTarget: EventTarget | null;
  owner: object | null;
  activePointers: Map<number, HudInputComponent[]>;
  capturedPointerEvents: Set<
    Extract<HudInputEventType, "pointermove" | "pointerdown" | "pointerup" | "click" | "wheel">
  >;
};

type NativeConsumableEvent = Event & {
  stopImmediatePropagation?: () => void;
};

const asEventTarget = (value: unknown): EventTarget | null => {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  const candidate = value as Partial<EventTarget>;
  return typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
    ? (value as EventTarget)
    : null;
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
    pointerId?: number;
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
        keyboardTarget: null,
        owner: null,
        activePointers: new Map(),
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
      state.owner = config.owner ?? null;
      return;
    }

    this.detach(runtime);
    if (!canvas) return;

    const getPointerType = (event: PointerEvent): HudPointerType =>
      event.pointerType === "touch" || event.pointerType === "pen" ? event.pointerType : "mouse";
    const getHudType = (
      event: PointerEvent,
      mouseType: Extract<
        HudInputEventType,
        "pointermove" | "pointerdown" | "pointerup" | "pointercancel"
      >,
    ): Extract<
      HudInputEventType,
      | "pointermove"
      | "pointerdown"
      | "pointerup"
      | "pointercancel"
      | "touchstart"
      | "touchmove"
      | "touchend"
      | "touchcancel"
    > => {
      if (event.pointerType !== "touch") return mouseType;
      if (mouseType === "pointerdown") return "touchstart";
      if (mouseType === "pointermove") return "touchmove";
      if (mouseType === "pointerup") return "touchend";
      return "touchcancel";
    };
    const routeDomPointer = (
      event: PointerEvent,
      type: "pointermove" | "pointerdown" | "pointerup" | "pointercancel",
    ): void => {
      const clientPoint = new Vector2D(event.clientX, event.clientY);
      const hudPoint = this.clientToHud(runtime, clientPoint, canvas);
      const pointerType = getPointerType(event);
      if (type === "pointermove" && pointerType !== "touch") {
        this.updateHover(runtime, hudPoint, clientPoint, event);
      }
      this.routePointer(runtime, getHudType(event, type), hudPoint, clientPoint, {
        pointerType,
        pointerId: event.pointerId,
        touchId: pointerType === "touch" ? event.pointerId : undefined,
        nativeEvent: event,
      });
    };

    const handlers: AttachedHandlers = {
      pointermove: (event) => routeDomPointer(event, "pointermove"),
      pointerdown: (event) => {
        routeDomPointer(event, "pointerdown");
        if (state.activePointers.has(event.pointerId)) {
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {
            // Pointer capture can fail if the pointer is no longer active.
          }
        }
      },
      pointerup: (event) => {
        routeDomPointer(event, "pointerup");
        try {
          if (canvas.hasPointerCapture?.(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Capture may already have been released by the browser.
        }
      },
      pointercancel: (event) => {
        routeDomPointer(event, "pointercancel");
        try {
          if (canvas.hasPointerCapture?.(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Capture may already have been released by the browser.
        }
      },
      pointerleave: (event) => {
        if (!state.activePointers.has(event.pointerId)) {
          this.clearHover(runtime, event);
        }
      },
      lostpointercapture: (event) => {
        if (state.activePointers.has(event.pointerId)) {
          routeDomPointer(event, "pointercancel");
        }
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
      keydown: (event) => {
        this.routeKey(runtime, "keydown", event.key, event.code, event);
      },
      keyup: (event) => {
        this.routeKey(runtime, "keyup", event.key, event.code, event);
      },
    };

    canvas.addEventListener("pointermove", handlers.pointermove, { passive: false });
    canvas.addEventListener("pointerdown", handlers.pointerdown, { passive: false });
    canvas.addEventListener("pointerup", handlers.pointerup, { passive: false });
    canvas.addEventListener("pointercancel", handlers.pointercancel, { passive: false });
    canvas.addEventListener("pointerleave", handlers.pointerleave, { passive: false });
    canvas.addEventListener("lostpointercapture", handlers.lostpointercapture, { passive: false });
    canvas.addEventListener("click", handlers.click);
    canvas.addEventListener("wheel", handlers.wheel, { passive: false });

    const ownerWindow = canvas.ownerDocument?.defaultView;
    const globalWindow = typeof window === "undefined" ? undefined : window;
    const keyboardTarget = asEventTarget(ownerWindow) ?? asEventTarget(globalWindow);
    keyboardTarget?.addEventListener("keydown", handlers.keydown as EventListener, {
      capture: true,
    });
    keyboardTarget?.addEventListener("keyup", handlers.keyup as EventListener, { capture: true });

    state.canvasElement = canvas;
    state.handlers = handlers;
    state.keyboardTarget = keyboardTarget;
    state.owner = config.owner ?? null;
  }

  public detach(runtime: EcsRuntime, owner?: object): void {
    const state = this.getState(runtime);
    if (owner && state.owner !== owner) return;
    if (!state.canvasElement || !state.handlers) {
      state.canvasElement = null;
      state.handlers = null;
      state.keyboardTarget = null;
      state.owner = null;
      state.activePointers.clear();
      return;
    }

    const { canvasElement: canvas, handlers } = state;
    for (const pointerId of state.activePointers.keys()) {
      try {
        if (!canvas.hasPointerCapture || canvas.hasPointerCapture(pointerId)) {
          canvas.releasePointerCapture(pointerId);
        }
      } catch {
        // Capture may already have been released by the browser.
      }
    }
    canvas.removeEventListener("pointermove", handlers.pointermove);
    canvas.removeEventListener("pointerdown", handlers.pointerdown);
    canvas.removeEventListener("pointerup", handlers.pointerup);
    canvas.removeEventListener("pointercancel", handlers.pointercancel);
    canvas.removeEventListener("pointerleave", handlers.pointerleave);
    canvas.removeEventListener("lostpointercapture", handlers.lostpointercapture);
    canvas.removeEventListener("click", handlers.click);
    canvas.removeEventListener("wheel", handlers.wheel);

    state.keyboardTarget?.removeEventListener("keydown", handlers.keydown as EventListener, true);
    state.keyboardTarget?.removeEventListener("keyup", handlers.keyup as EventListener, true);

    state.canvasElement = null;
    state.handlers = null;
    state.keyboardTarget = null;
    state.owner = null;
    state.activePointers.clear();
  }

  public register(component: HudInputComponent, runtime: EcsRuntime): void {
    this.getState(runtime).components.add(component);
  }

  public unregister(component: HudInputComponent, runtime: EcsRuntime): void {
    const state = this.getState(runtime);
    if (state.focusedId === component.ent.id) {
      this.setFocused(state, null);
    }
    state.components.delete(component);
    state.hoveredIds.delete(component.ent.id);
    for (const [pointerId, targets] of state.activePointers) {
      const remaining = targets.filter((target) => target !== component);
      if (remaining.length > 0) {
        state.activePointers.set(pointerId, remaining);
      } else {
        state.activePointers.delete(pointerId);
      }
    }
  }

  public isFocused(component: HudInputComponent, runtime: EcsRuntime): boolean {
    const state = this.getState(runtime);
    this.revalidateFocus(state);
    return state.focusedId === component.ent.id;
  }

  public revalidate(runtime: EcsRuntime): void {
    this.revalidateFocus(this.getState(runtime));
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
      | "pointercancel"
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
      pointerId?: number;
      touchId?: number;
      wheelDelta?: Vector2D;
      nativeEvent?: Event;
    },
  ): void {
    const state = this.getState(runtime);
    this.revalidateFocus(state);
    const pointerId = options.pointerId ?? options.touchId ?? 1;
    const isStart = type === "pointerdown" || type === "touchstart";
    if (isStart) {
      state.activePointers.delete(pointerId);
    }
    const isEnd =
      type === "pointerup" ||
      type === "pointercancel" ||
      type === "touchend" ||
      type === "touchcancel";
    const isCancel = type === "pointercancel" || type === "touchcancel";
    const usesCapture =
      type === "pointermove" ||
      type === "pointerup" ||
      type === "pointercancel" ||
      type === "touchmove" ||
      type === "touchend" ||
      type === "touchcancel";
    const captured = usesCapture ? state.activePointers.get(pointerId) : undefined;
    const candidates = captured
      ? [...captured]
      : this.getPointerCandidates(runtime, hudPoint, options.pointerType);
    const cancelledHoverIds = isCancel
      ? candidates
          .map((component) => component.entity?.id)
          .filter((id): id is string => id !== undefined)
      : [];

    if (isStart && candidates.length === 0) {
      this.setFocused(state, null, options.nativeEvent, hudPoint, clientPoint, options.pointerType);
    }

    const delivered: HudInputComponent[] = [];
    let assignedFocus = false;
    for (const component of candidates) {
      if (
        !this.isPointerEligible(state, component, options.pointerType, captured ? null : hudPoint)
      ) {
        continue;
      }
      const event = makeEvent(type, {
        hudPoint,
        clientPoint,
        pointerType: options.pointerType,
        pointerId,
        touchId: options.touchId,
        wheelDelta: options.wheelDelta,
        nativeEvent: options.nativeEvent,
      });

      component.handleHudInput(event);
      delivered.push(component);
      this.revalidateFocus(state);

      if (
        isStart &&
        !assignedFocus &&
        component.focusable &&
        this.isBaseEligible(state, component)
      ) {
        this.setFocused(
          state,
          component,
          options.nativeEvent,
          hudPoint,
          clientPoint,
          options.pointerType,
        );
        assignedFocus = true;
        this.revalidateFocus(state);
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

    const activeTargets = delivered.filter((component) =>
      this.isPointerEligible(state, component, options.pointerType, null),
    );
    if (isStart && activeTargets.length > 0) {
      state.activePointers.set(pointerId, activeTargets);
    } else if (isStart) {
      state.activePointers.delete(pointerId);
      if (!assignedFocus) {
        this.setFocused(
          state,
          null,
          options.nativeEvent,
          hudPoint,
          clientPoint,
          options.pointerType,
        );
      }
    } else if (isEnd) {
      state.activePointers.delete(pointerId);
    }
    for (const id of cancelledHoverIds) {
      state.hoveredIds.delete(id);
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
    this.revalidateFocus(state);

    const all = Array.from(state.components).filter((component) =>
      this.isKeyboardEligible(state, component),
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
      if (!this.isKeyboardEligible(state, component)) continue;
      if (component === focused) {
        if (component.keyboardMode !== "focused") continue;
      } else if (component.keyboardMode !== "global") {
        continue;
      }
      const event = makeEvent(type, {
        hudPoint: null,
        key,
        code,
        nativeEvent,
      });
      component.handleHudInput(event);
      this.revalidateFocus(state);
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
    const nextId = next?.entity?.id ?? null;
    if (prevId === nextId) return;

    const prev =
      prevId === null
        ? null
        : (Array.from(state.components).find((component) => component.entity?.id === prevId) ??
          null);

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
      if (!this.isPointerEligible(state, component, "mouse", hudPoint)) continue;
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
      const component = Array.from(state.components).find((entry) => entry.entity?.id === id);
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

    state.hoveredIds = new Set(
      Array.from(nextIds).filter((id) =>
        Array.from(state.components).some(
          (component) =>
            component.entity?.id === id &&
            this.isPointerEligible(state, component, "mouse", hudPoint),
        ),
      ),
    );
  }

  private clearHover(runtime: EcsRuntime, nativeEvent?: Event): void {
    const state = this.getState(runtime);
    for (const id of state.hoveredIds) {
      const component = Array.from(state.components).find((entry) => entry.entity?.id === id);
      if (!component) continue;
      component.handleHudInput(
        makeEvent("pointerleave", {
          hudPoint: null,
          pointerType: "mouse",
          nativeEvent,
        }),
      );
    }
    state.hoveredIds.clear();
  }

  private getPointerCandidates(
    runtime: EcsRuntime,
    hudPoint: Vector2D,
    pointerType: HudPointerType,
  ): HudInputComponent[] {
    const state = this.getState(runtime);

    return Array.from(state.components)
      .filter((component) => this.isPointerEligible(state, component, pointerType, hudPoint))
      .sort((a, b) => this.sortByPriority(a, b));
  }

  private sortByPriority(a: HudInputComponent, b: HudInputComponent): number {
    const drawA = RenderSystem.getHudDrawOrder(a.ent, a.ent.runtime);
    const drawB = RenderSystem.getHudDrawOrder(b.ent, b.ent.runtime);
    if (drawA !== drawB) {
      if (drawA === null) return 1;
      if (drawB === null) return -1;
      return drawB - drawA;
    }
    if (a.priority !== b.priority) return b.priority - a.priority;
    return 0;
  }

  private isInteractiveInHierarchy(component: HudInputComponent): boolean {
    let entity = component.ent as typeof component.ent | null;
    while (entity) {
      if (entity.hasComponent(HudLayoutNodeComponent)) {
        const node = entity.getComponent(HudLayoutNodeComponent);
        if (!node.visible || !node.interactive) return false;
      }
      entity = entity.parent;
    }
    return true;
  }

  private isBaseEligible(state: RuntimeState, component: HudInputComponent): boolean {
    return (
      state.components.has(component) &&
      component.entity?.isAwake === true &&
      component.enabled &&
      component.interactive &&
      this.isInteractiveInHierarchy(component)
    );
  }

  private isPointerEligible(
    state: RuntimeState,
    component: HudInputComponent,
    pointerType: HudPointerType,
    point: Vector2D | null,
  ): boolean {
    if (!this.isBaseEligible(state, component)) return false;
    if (pointerType === "touch" ? !component.touchEnabled : !component.pointerEnabled) return false;
    if (!component.ent.hasComponent(HudLayoutNodeComponent)) return false;
    return (
      point === null || component.ent.getComponent(HudLayoutNodeComponent).containsHudPoint(point)
    );
  }

  private isKeyboardEligible(state: RuntimeState, component: HudInputComponent): boolean {
    return this.isBaseEligible(state, component) && component.keyboardEnabled;
  }

  private revalidateFocus(state: RuntimeState): void {
    if (state.focusedId === null) return;
    const focused = Array.from(state.components).find(
      (component) => component.entity?.id === state.focusedId,
    );
    if (!focused || !this.isBaseEligible(state, focused)) {
      this.setFocused(state, null);
    }
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
