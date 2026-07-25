import type { ICamera } from "./ICamera.ts";
import type { RenderComponent } from "./RenderComponent.ts";
import { RenderLayer } from "./RenderLayer.ts";
import type { Vector2D } from "../math/Vector2D.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import type { HudViewport } from "./HudViewport.ts";
import { resolveHudLayout } from "../ui/HudLayoutResolver.ts";
import { HudLayoutNodeComponent } from "../ui/HudLayoutNodeComponent.ts";
import { HudInputRouter } from "../ui/HudInputRouter.ts";
import type { Entity } from "../ecs/Entity.ts";

export interface ICanvas {
  context: CanvasRenderingContext2D;
  size: Vector2D;
}

/**
 * Central rendering orchestrator.
 *
 * RenderComponents self-register/unregister via their awake/destroy lifecycle.
 * Call `renderSystem.render()` once per frame.
 *
 * Rendering order:
 *   1. World components (Background → Foreground), filtered by isVisible()
 *   2. HUD components (always on top, never culled)
 *      - HudRenderComponent can optionally render through HudViewport design-space transform
 */
export class RenderSystem {
  private static renderablesByRuntime = new WeakMap<EcsRuntime, RenderComponent[]>();
  private static activeRenderablesByRuntime = new WeakMap<EcsRuntime, Set<RenderComponent>>();
  private static registrationOrderByRuntime = new WeakMap<
    EcsRuntime,
    Map<RenderComponent, number>
  >();
  private static nextRegistrationOrderByRuntime = new WeakMap<EcsRuntime, number>();
  private static committedRenderablesByRuntime = new WeakMap<EcsRuntime, RenderComponent[]>();
  private static renderingRuntimes = new WeakSet<EcsRuntime>();
  private static pendingZIndicesByRuntime = new WeakMap<
    EcsRuntime,
    Map<RenderComponent, RenderLayer>
  >();
  private static pendingSortRuntimes = new WeakSet<EcsRuntime>();
  private disposed = false;

  constructor(
    private canvas: ICanvas,
    private activeCamera: ICamera,
    private runtime: EcsRuntime = EcsRuntime.getCurrent(),
    private hudViewport: HudViewport | null = null,
  ) {}

  public setHudViewport(hudViewport: HudViewport | null): this {
    this.hudViewport = hudViewport;
    return this;
  }

  private static getRenderables(runtime: EcsRuntime): RenderComponent[] {
    let list = RenderSystem.renderablesByRuntime.get(runtime);
    if (!list) {
      list = [];
      RenderSystem.renderablesByRuntime.set(runtime, list);
    }
    return list;
  }

  private static getRegistrationOrder(runtime: EcsRuntime): Map<RenderComponent, number> {
    let order = RenderSystem.registrationOrderByRuntime.get(runtime);
    if (!order) {
      order = new Map();
      RenderSystem.registrationOrderByRuntime.set(runtime, order);
    }
    return order;
  }

  private static getActiveRenderables(runtime: EcsRuntime): Set<RenderComponent> {
    let active = RenderSystem.activeRenderablesByRuntime.get(runtime);
    if (!active) {
      active = new Set();
      RenderSystem.activeRenderablesByRuntime.set(runtime, active);
    }
    return active;
  }

  private static compareRenderables(
    a: RenderComponent,
    b: RenderComponent,
    order: Map<RenderComponent, number>,
  ): number {
    return a.zIndex - b.zIndex || (order.get(a) ?? 0) - (order.get(b) ?? 0);
  }

  private static sortRenderables(runtime: EcsRuntime): void {
    const order = RenderSystem.getRegistrationOrder(runtime);
    RenderSystem.getRenderables(runtime).sort((a, b) =>
      RenderSystem.compareRenderables(a, b, order),
    );
  }

  private static insertRenderable(runtime: EcsRuntime, component: RenderComponent): void {
    const renderables = RenderSystem.getRenderables(runtime);
    const order = RenderSystem.getRegistrationOrder(runtime);
    let low = 0;
    let high = renderables.length;

    while (low < high) {
      const middle = (low + high) >>> 1;
      const current = renderables[middle]!;
      if (RenderSystem.compareRenderables(current, component, order) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    renderables.splice(low, 0, component);
  }

  private static commitRenderables(runtime: EcsRuntime): void {
    RenderSystem.committedRenderablesByRuntime.set(runtime, [
      ...RenderSystem.getRenderables(runtime),
    ]);
  }

  private static prepareFrame(runtime: EcsRuntime): RenderComponent[] {
    const pendingZIndices = RenderSystem.pendingZIndicesByRuntime.get(runtime);
    if (pendingZIndices) {
      for (const [component, zIndex] of pendingZIndices) {
        if (RenderSystem.getActiveRenderables(runtime).has(component)) {
          component._commitZIndex(zIndex);
        }
      }
      pendingZIndices.clear();
    }
    if (RenderSystem.pendingSortRuntimes.has(runtime)) {
      RenderSystem.sortRenderables(runtime);
      RenderSystem.pendingSortRuntimes.delete(runtime);
    }
    RenderSystem.commitRenderables(runtime);
    return [...RenderSystem.getRenderables(runtime)];
  }

  public static register(
    component: RenderComponent,
    runtime: EcsRuntime = EcsRuntime.getCurrent(),
  ): void {
    const active = RenderSystem.getActiveRenderables(runtime);
    if (active.has(component)) return;

    const nextOrder = (RenderSystem.nextRegistrationOrderByRuntime.get(runtime) ?? 0) + 1;
    RenderSystem.nextRegistrationOrderByRuntime.set(runtime, nextOrder);
    RenderSystem.getRegistrationOrder(runtime).set(component, nextOrder);
    active.add(component);
    RenderSystem.insertRenderable(runtime, component);
    if (!RenderSystem.renderingRuntimes.has(runtime)) {
      RenderSystem.commitRenderables(runtime);
    }
  }

  public static unregister(
    component: RenderComponent,
    runtime: EcsRuntime = EcsRuntime.getCurrent(),
  ): void {
    const active = RenderSystem.getActiveRenderables(runtime);
    if (!active.delete(component)) return;
    const renderables = RenderSystem.getRenderables(runtime);
    const index = renderables.indexOf(component);
    if (index !== -1) {
      renderables.splice(index, 1);
    }
    RenderSystem.getRegistrationOrder(runtime).delete(component);
    if (!RenderSystem.renderingRuntimes.has(runtime)) {
      RenderSystem.commitRenderables(runtime);
    }
  }

  public static resort(
    component: RenderComponent,
    runtime: EcsRuntime = EcsRuntime.getCurrent(),
  ): void {
    if (!RenderSystem.getActiveRenderables(runtime).has(component)) return;
    if (RenderSystem.renderingRuntimes.has(runtime)) {
      RenderSystem.pendingSortRuntimes.add(runtime);
      return;
    }
    RenderSystem.sortRenderables(runtime);
    RenderSystem.commitRenderables(runtime);
  }

  public static deferZIndex(
    component: RenderComponent,
    zIndex: RenderLayer,
    runtime: EcsRuntime,
  ): boolean {
    if (!RenderSystem.renderingRuntimes.has(runtime)) return false;
    let pending = RenderSystem.pendingZIndicesByRuntime.get(runtime);
    if (!pending) {
      pending = new Map();
      RenderSystem.pendingZIndicesByRuntime.set(runtime, pending);
    }
    pending.set(component, zIndex);
    RenderSystem.pendingSortRuntimes.add(runtime);
    return true;
  }

  /** Returns the draw index of an entity's topmost HUD renderer. */
  public static getHudDrawOrder(entity: Entity, runtime: EcsRuntime): number | null {
    const renderables =
      RenderSystem.committedRenderablesByRuntime.get(runtime) ??
      RenderSystem.getRenderables(runtime);
    for (let i = renderables.length - 1; i >= 0; i--) {
      const component = renderables[i];
      if (component && component.zIndex >= RenderLayer.HUD && component.entity === entity) {
        return i;
      }
    }
    return null;
  }

  private static get renderables(): RenderComponent[] {
    return RenderSystem.getRenderables(EcsRuntime.getCurrent());
  }

  private static set renderables(value: RenderComponent[]) {
    const runtime = EcsRuntime.getCurrent();
    RenderSystem.renderablesByRuntime.set(runtime, value);
    RenderSystem.activeRenderablesByRuntime.set(runtime, new Set(value));
    RenderSystem.commitRenderables(runtime);
  }

  public render(): void {
    if (this.disposed) return;
    const renderables = RenderSystem.prepareFrame(this.runtime);
    RenderSystem.renderingRuntimes.add(this.runtime);

    try {
      this.renderFrame(renderables);
    } finally {
      RenderSystem.renderingRuntimes.delete(this.runtime);
    }
  }

  private renderFrame(renderables: RenderComponent[]): void {
    const { context: ctx } = this.canvas;
    const canvasSize = this.canvas.size;
    this.hudViewport?.setCanvasSize(canvasSize);

    let canvasElement: HTMLCanvasElement | null = null;
    if (typeof HTMLCanvasElement !== "undefined" && "canvas" in ctx) {
      const maybeCanvas = (ctx as CanvasRenderingContext2D).canvas;
      if (maybeCanvas instanceof HTMLCanvasElement) {
        canvasElement = maybeCanvas;
      }
    }

    HudInputRouter.configure(this.runtime, {
      canvasElement,
      hudViewport: this.hudViewport,
      owner: this,
    });

    resolveHudLayout(this.runtime, {
      x: 0,
      y: 0,
      width: this.hudViewport ? this.hudViewport.refSize.x : canvasSize.x,
      height: this.hudViewport ? this.hudViewport.refSize.y : canvasSize.y,
    });
    HudInputRouter.revalidate(this.runtime);

    const hud: RenderComponent[] = [];
    const activeRenderables = RenderSystem.getActiveRenderables(this.runtime);

    for (const comp of renderables) {
      if (!activeRenderables.has(comp)) continue;
      if (!comp.ent.isAwake) continue;
      if (!comp.isVisible(this.activeCamera)) continue;

      if (comp.zIndex >= RenderLayer.HUD) {
        hud.push(comp);
        continue;
      }
      comp.render(ctx, this.activeCamera, canvasSize);
    }

    for (const comp of hud) {
      if (!activeRenderables.has(comp)) continue;
      if (!this.isHudVisible(comp.ent)) continue;

      if (this.hudViewport && comp.isHudComponent) {
        ctx.save();
        try {
          this.hudViewport.applyTo(ctx);
          comp.render(ctx, this.activeCamera, this.hudViewport.refSize);
        } finally {
          ctx.restore();
        }
        continue;
      }
      comp.render(ctx, this.activeCamera, canvasSize);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    HudInputRouter.detach(this.runtime, this);
  }

  private isHudVisible(entity: Entity): boolean {
    let current: Entity | null = entity;
    while (current) {
      if (
        current.hasComponent(HudLayoutNodeComponent) &&
        !current.getComponent(HudLayoutNodeComponent).visible
      ) {
        return false;
      }
      current = current.parent;
    }
    return true;
  }
}
