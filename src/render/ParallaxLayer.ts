import { TileScroller, type TileRepeatMode } from "./TileScroller.ts";

export type ParallaxViewport = {
  width: number;
  height: number;
};

export type ParallaxRenderOptions = {
  originX?: number;
  originY?: number;
  alpha?: number;
  tileWidth?: number;
  tileHeight?: number;
};

export type ParallaxLayerOptions = {
  image: HTMLImageElement;
  repeat?: TileRepeatMode;
  speedX?: number;
  speedY?: number;
  alpha?: number;
  overdrawTiles?: number;
  seamOverlapPx?: number;
};

export class ParallaxLayer {
  private readonly scroller: TileScroller;
  private readonly repeat: TileRepeatMode;
  private readonly overdrawTiles: number;
  private readonly alpha: number;
  private readonly seamOverlapPx: number;

  constructor(private readonly options: ParallaxLayerOptions) {
    this.scroller = new TileScroller(options.speedX ?? 0, options.speedY ?? 0);
    this.repeat = options.repeat ?? "x";
    this.overdrawTiles = Math.max(0, Math.floor(options.overdrawTiles ?? 1));
    this.alpha = options.alpha ?? 1;
    this.seamOverlapPx = Math.max(0, options.seamOverlapPx ?? 0);
  }

  public update(dt: number): void {
    this.scroller.update(dt);
  }

  public reset(): void {
    this.scroller.reset();
  }

  public render(
    ctx: CanvasRenderingContext2D,
    viewport: ParallaxViewport,
    options: ParallaxRenderOptions = {},
  ): void {
    const iw = this.options.image.naturalWidth || this.options.image.width;
    const ih = this.options.image.naturalHeight || this.options.image.height;
    const tw = options.tileWidth ?? iw;
    const th = options.tileHeight ?? ih;
    if (tw <= 0 || th <= 0) return;

    const alpha = options.alpha ?? this.alpha;
    const tiles = this.scroller.computeTiles({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      tileWidth: tw,
      tileHeight: th,
      originX: options.originX ?? 0,
      originY: options.originY ?? 0,
      repeat: this.repeat,
      overdrawTiles: this.overdrawTiles,
    });

    ctx.save();
    try {
      ctx.globalAlpha = alpha;
      for (const tile of tiles) {
        ctx.drawImage(
          this.options.image,
          tile.x,
          tile.y,
          tile.width + this.seamOverlapPx,
          tile.height + this.seamOverlapPx,
        );
      }
    } finally {
      ctx.restore();
    }
  }
}
