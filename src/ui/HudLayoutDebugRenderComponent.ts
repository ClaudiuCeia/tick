import type { Entity } from "../ecs/Entity.ts";
import type { ICamera } from "../render/ICamera.ts";
import { HudRenderComponent } from "../render/HudRenderComponent.ts";
import { RenderLayer } from "../render/RenderLayer.ts";
import type { Vector2D } from "../math/Vector2D.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { normalizeAnchor } from "./types.ts";

export type HudLayoutDebugOptions = {
  color?: string;
  hiddenColor?: string;
  labelColor?: string;
  anchorColor?: string;
  lineWidth?: number;
  anchorRadius?: number;
  font?: string;
  showLabels?: boolean;
  showAnchors?: boolean;
  includeHidden?: boolean;
};

/**
 * Debug HUD overlay that draws resolved layout frames for all HudLayoutNodeComponent nodes.
 */
export class HudLayoutDebugRenderComponent extends HudRenderComponent<Entity> {
  public color: string;
  public hiddenColor: string;
  public labelColor: string;
  public anchorColor: string;
  public lineWidth: number;
  public anchorRadius: number;
  public font: string;
  public showLabels: boolean;
  public showAnchors: boolean;
  public includeHidden: boolean;

  constructor(options: HudLayoutDebugOptions = {}, zIndex: RenderLayer = RenderLayer.HUD) {
    super(zIndex);
    this.color = options.color ?? "rgba(80, 205, 255, 0.9)";
    this.hiddenColor = options.hiddenColor ?? "rgba(255, 124, 124, 0.85)";
    this.labelColor = options.labelColor ?? "rgba(240, 248, 255, 0.95)";
    this.anchorColor = options.anchorColor ?? "rgba(255, 220, 120, 0.95)";
    this.lineWidth = options.lineWidth ?? 1.5;
    this.anchorRadius = options.anchorRadius ?? 3;
    this.font = options.font ?? "12px monospace";
    this.showLabels = options.showLabels ?? true;
    this.showAnchors = options.showAnchors ?? true;
    this.includeHidden = options.includeHidden ?? false;
  }

  public override doRender(
    ctx: CanvasRenderingContext2D,
    _camera: ICamera,
    _canvasSize: Vector2D,
  ): void {
    const nodes = this.ent.runtime.registry
      .findEntities((entity) => entity.isAwake && entity.hasComponent(HudLayoutNodeComponent))
      .map((entity) => ({ entity, node: entity.getComponent(HudLayoutNodeComponent) }))
      .sort((a, b) => a.entity.id.localeCompare(b.entity.id));

    for (const { entity, node } of nodes) {
      const frame = node.getFrame();
      if (!frame) continue;
      if (!node.visible && !this.includeHidden) continue;

      const strokeColor = node.visible ? this.color : this.hiddenColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = this.lineWidth;
      ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

      if (this.showAnchors) {
        const anchor = normalizeAnchor(node.anchor);
        const ax =
          anchor.x === "left"
            ? frame.x
            : anchor.x === "center"
              ? frame.x + frame.width / 2
              : frame.x + frame.width;
        const ay =
          anchor.y === "top"
            ? frame.y
            : anchor.y === "center"
              ? frame.y + frame.height / 2
              : frame.y + frame.height;

        ctx.fillStyle = this.anchorColor;
        ctx.beginPath();
        ctx.arc(ax, ay, this.anchorRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (this.showLabels) {
        ctx.fillStyle = this.labelColor;
        ctx.font = this.font;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        const label = `${entity.constructor.name}${node.visible ? "" : " (hidden)"}`;
        ctx.fillText(label, frame.x + 4, frame.y - 2);
      }
    }
  }
}
