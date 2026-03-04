import { Vector2D } from "../math/Vector2D.ts";

export type HudFit = "contain" | "cover" | "stretch";

export type CanvasViewportTarget = Pick<
  HTMLCanvasElement,
  "width" | "height" | "getBoundingClientRect"
>;

/**
 * Maps a fixed HUD design space (refSize) to current canvas pixels.
 *
 * Typical usage:
 * - Configure once with design resolution (for example 1920x1080)
 * - Update with current canvas size on resize/frame
 * - Apply transform before rendering HUD
 * - Convert pointer positions from client/screen to HUD coordinates
 */
export class HudViewport {
  public canvasSize = new Vector2D(1, 1);
  public scaleX = 1;
  public scaleY = 1;
  public ox = 0;
  public oy = 0;

  constructor(
    public readonly refSize: Vector2D,
    public fit: HudFit = "contain",
    public snapToPixel = true,
  ) {
    this.recompute();
  }

  public setCanvasSize(size: Vector2D): void {
    this.canvasSize = size;
    this.recompute();
  }

  public recompute(): void {
    const cw = this.canvasSize.x;
    const ch = this.canvasSize.y;
    const rw = this.refSize.x;
    const rh = this.refSize.y;

    if (cw <= 0 || ch <= 0 || rw <= 0 || rh <= 0) {
      this.scaleX = 1;
      this.scaleY = 1;
      this.ox = 0;
      this.oy = 0;
      return;
    }

    const sx = cw / rw;
    const sy = ch / rh;

    if (this.fit === "stretch") {
      this.scaleX = sx;
      this.scaleY = sy;
      this.ox = 0;
      this.oy = 0;
      return;
    }

    const scale = this.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
    this.scaleX = scale;
    this.scaleY = scale;
    this.ox = (cw - rw * scale) / 2;
    this.oy = (ch - rh * scale) / 2;

    if (this.snapToPixel) {
      this.ox = Math.round(this.ox);
      this.oy = Math.round(this.oy);
    }
  }

  /** Apply design-space -> screen transform to the current context. */
  public applyTo(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, this.ox, this.oy);
  }

  /** Convert canvas pixel coordinates to HUD design-space coordinates. */
  public screenToHud(point: Vector2D): Vector2D {
    return new Vector2D((point.x - this.ox) / this.scaleX, (point.y - this.oy) / this.scaleY);
  }

  /** Convert HUD design-space coordinates to canvas pixel coordinates. */
  public hudToScreen(point: Vector2D): Vector2D {
    return new Vector2D(point.x * this.scaleX + this.ox, point.y * this.scaleY + this.oy);
  }

  /**
   * Convert DOM client coordinates (MouseEvent.clientX/Y) to canvas pixel coordinates.
   */
  public clientToScreen(point: Vector2D, canvas: CanvasViewportTarget): Vector2D {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return Vector2D.zero;
    }

    return new Vector2D(
      ((point.x - rect.left) / rect.width) * canvas.width,
      ((point.y - rect.top) / rect.height) * canvas.height,
    );
  }

  /**
   * Convert DOM client coordinates directly to HUD design-space coordinates.
   */
  public clientToHud(point: Vector2D, canvas: CanvasViewportTarget): Vector2D {
    return this.screenToHud(this.clientToScreen(point, canvas));
  }
}
