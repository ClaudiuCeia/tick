import type { ICamera } from "./ICamera.ts";
import type { RenderComponent } from "./RenderComponent.ts";
import { RenderLayer } from "./RenderLayer.ts";
import type { Vector2D } from "../math/Vector2D.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import type { HudViewport } from "./HudViewport.ts";

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

  public static register(
    component: RenderComponent,
    runtime: EcsRuntime = EcsRuntime.getCurrent(),
  ): void {
    const renderables = RenderSystem.getRenderables(runtime);

    // Insert sorted by zIndex (ascending) for correct draw order
    let insertAt = renderables.length;
    for (let i = 0; i < renderables.length; i++) {
      const current = renderables[i];
      if (current && current.zIndex > component.zIndex) {
        insertAt = i;
        break;
      }
    }
    renderables.splice(insertAt, 0, component);
  }

  public static unregister(
    component: RenderComponent,
    runtime: EcsRuntime = EcsRuntime.getCurrent(),
  ): void {
    const renderables = RenderSystem.getRenderables(runtime);
    const index = renderables.indexOf(component);
    if (index !== -1) {
      renderables.splice(index, 1);
    }
  }

  private static get renderables(): RenderComponent[] {
    return RenderSystem.getRenderables(EcsRuntime.getCurrent());
  }

  private static set renderables(value: RenderComponent[]) {
    RenderSystem.renderablesByRuntime.set(EcsRuntime.getCurrent(), value);
  }

  public render(): void {
    const { context: ctx } = this.canvas;
    const canvasSize = this.canvas.size;
    this.hudViewport?.setCanvasSize(canvasSize);

    const hud: RenderComponent[] = [];
    const renderables = RenderSystem.getRenderables(this.runtime);

    for (const comp of renderables) {
      if (!comp.ent.isAwake) continue;
      if (!comp.isVisible(this.activeCamera)) continue;

      if (comp.zIndex >= RenderLayer.HUD) {
        hud.push(comp);
        continue;
      }
      comp.render(ctx, this.activeCamera, canvasSize);
    }

    for (const comp of hud) {
      if (this.hudViewport && comp.isHudComponent) {
        ctx.save();
        this.hudViewport.applyTo(ctx);
        comp.render(ctx, this.activeCamera, this.hudViewport.refSize);
        ctx.restore();
        continue;
      }
      comp.render(ctx, this.activeCamera, canvasSize);
    }
  }
}
