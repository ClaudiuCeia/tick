import { Component } from "../ecs/Component.ts";
import type { Entity } from "../ecs/Entity.ts";
import type { Vector2D } from "../math/Vector2D.ts";
import { CollisionEntity } from "../collision/CollisionEntity.ts";
import { RenderLayer } from "./RenderLayer.ts";
import { RenderSystem } from "./RenderSystem.ts";
import type { ICamera } from "./ICamera.ts";

export abstract class RenderComponent<T extends Entity = Entity> extends Component<T> {
  private _zIndex: RenderLayer;
  protected elapsed: number = 0;

  public get zIndex(): RenderLayer {
    return this._zIndex;
  }

  public set zIndex(zIndex: RenderLayer) {
    if (this.entity?.isAwake && RenderSystem.deferZIndex(this, zIndex, this.entity.runtime)) {
      return;
    }
    if (this._zIndex === zIndex) return;
    this._zIndex = zIndex;
    if (this.entity?.isAwake) {
      RenderSystem.resort(this, this.entity.runtime);
    }
  }

  /** @internal Applied by RenderSystem at the next frame boundary. */
  public _commitZIndex(zIndex: RenderLayer): void {
    this._zIndex = zIndex;
  }

  public get isHudComponent(): boolean {
    return false;
  }

  constructor(zIndex: RenderLayer) {
    super();
    this._zIndex = zIndex;
  }

  /** Template method — do not override. Override doRender instead. */
  public render(ctx: CanvasRenderingContext2D, camera: ICamera, canvasSize: Vector2D): void {
    ctx.save();
    try {
      this.doRender(ctx, camera, canvasSize);
    } finally {
      ctx.restore();
    }
  }

  /**
   * Implement rendering here.
   * `camera` is typed as ICamera — cast to your concrete CameraEntity if needed.
   */
  public abstract doRender(
    ctx: CanvasRenderingContext2D,
    camera: ICamera,
    canvasSize: Vector2D,
  ): void;

  public override awake(): void {
    super.awake();
    RenderSystem.register(this, this.ent.runtime);
  }

  public override update(deltaTime: number): void {
    super.update(deltaTime);
    this.elapsed += deltaTime;
  }

  /**
   * Returns whether this component should be rendered this frame.
   * HUD-layer components always pass. World-layer components are culled
   * by checking if the entity's CollisionEntity overlaps the camera's.
   */
  public isVisible(camera: ICamera): boolean {
    if (!this.ent.isAwake) return false;
    if (this.zIndex >= RenderLayer.HUD) return true;

    const ownerCollider = this.ent.getChild(CollisionEntity);
    const cameraCollider = camera.getChild(CollisionEntity);

    if (!ownerCollider || !cameraCollider) return false;

    return ownerCollider.isColliding(cameraCollider);
  }

  public override destroy(): void {
    super.destroy();
    RenderSystem.unregister(this, this.ent.runtime);
  }
}
