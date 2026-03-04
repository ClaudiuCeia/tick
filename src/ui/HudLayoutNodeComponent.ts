import { Component } from "../ecs/Component.ts";
import type { Entity } from "../ecs/Entity.ts";
import { Vector2D } from "../math/Vector2D.ts";
import type { UiAnchor, UiRect, UiSize } from "./types.ts";

export type HudLayoutNodeOptions = {
  width: UiSize;
  height: UiSize;
  anchor?: UiAnchor;
  offset?: Vector2D | { x: number; y: number };
  order?: number;
};

export class HudLayoutNodeComponent<T extends Entity = Entity> extends Component<T> {
  public width: UiSize;
  public height: UiSize;
  public anchor: UiAnchor;
  public order: number;
  public offset: Vector2D;

  private resolvedFrame: UiRect | null = null;

  constructor(options: HudLayoutNodeOptions) {
    super();
    this.width = options.width;
    this.height = options.height;
    this.anchor = options.anchor ?? "top-left";
    this.order = options.order ?? 0;

    const offset = options.offset;
    this.offset = offset ? new Vector2D(offset.x, offset.y) : Vector2D.zero;
  }

  public setSize(width: UiSize, height: UiSize): this {
    this.width = width;
    this.height = height;
    return this;
  }

  public setAnchor(anchor: UiAnchor): this {
    this.anchor = anchor;
    return this;
  }

  public setOffset(x: number, y: number): this {
    this.offset.set(x, y);
    return this;
  }

  public setOrder(order: number): this {
    this.order = order;
    return this;
  }

  public setResolvedFrame(frame: UiRect): void {
    this.resolvedFrame = frame;
  }

  public clearResolvedFrame(): void {
    this.resolvedFrame = null;
  }

  public getFrame(): UiRect | null {
    return this.resolvedFrame;
  }

  public containsHudPoint(point: Vector2D): boolean {
    const frame = this.resolvedFrame;
    if (!frame) return false;

    return (
      point.x >= frame.x &&
      point.x <= frame.x + frame.width &&
      point.y >= frame.y &&
      point.y <= frame.y + frame.height
    );
  }
}
