import type { Entity } from "../ecs/Entity.ts";
import { RenderLayer } from "./RenderLayer.ts";
import { RenderComponent } from "./RenderComponent.ts";
import type { ICamera } from "./ICamera.ts";
import type { Vector2D } from "../math/Vector2D.ts";

/**
 * Base class for HUD elements. Enforces zIndex >= RenderLayer.HUD.
 * HUD components always pass visibility culling regardless of camera position.
 */
export abstract class HudRenderComponent<T extends Entity = Entity> extends RenderComponent<T> {
  public override get isHudComponent(): boolean {
    return true;
  }

  constructor(zIndex: RenderLayer = RenderLayer.HUD) {
    super(zIndex);
    if (zIndex < RenderLayer.HUD) {
      throw new Error(
        `HudRenderComponent zIndex must be >= RenderLayer.HUD (${RenderLayer.HUD}), got ${zIndex}`,
      );
    }
  }

  public abstract override doRender(
    ctx: CanvasRenderingContext2D,
    camera: ICamera,
    canvasSize: Vector2D,
  ): void;
}
