import {
  CollisionEntity,
  RenderComponent,
  RenderLayer,
  Vector2D,
  type ICamera,
} from "../../index.ts";

export class SharedRectRenderComponent extends RenderComponent {
  constructor(
    private readonly color: string,
    zIndex: RenderLayer = RenderLayer.World,
  ) {
    super(zIndex);
  }

  public override doRender(
    ctx: CanvasRenderingContext2D,
    camera: ICamera,
    canvasSize: Vector2D,
  ): void {
    const collider = this.ent.getChild(CollisionEntity);
    if (!collider) return;

    const bbox = collider.bbox();
    const topLeft = camera.toCanvas(new Vector2D(bbox.x, bbox.y), canvasSize);

    ctx.fillStyle = this.color;
    ctx.fillRect(topLeft.x, topLeft.y, bbox.width, bbox.height);
  }
}
