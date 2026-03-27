import { Component } from "../ecs/Component.ts";
import type { Entity } from "../ecs/Entity.ts";
import type { UiRect } from "./types.ts";

export type HudScrollAreaMetrics = {
  maxScroll: number;
  trackRect: UiRect;
  thumbRect: UiRect;
  thumbHitRect: UiRect;
};

export type HudScrollAreaOptions = {
  trackInsetRight?: number;
  trackInsetTop?: number;
  trackInsetBottom?: number;
  trackWidth?: number;
  minThumbHeight?: number;
  thumbHitPaddingX?: number;
  thumbHitPaddingY?: number;
};

export class HudScrollAreaComponent<T extends Entity = Entity> extends Component<T> {
  public contentExtent = 0;
  public scrollOffset = 0;
  public hoveredThumb = false;

  public readonly trackInsetRight: number;
  public readonly trackInsetTop: number;
  public readonly trackInsetBottom: number;
  public readonly trackWidth: number;
  public readonly minThumbHeight: number;
  public readonly thumbHitPaddingX: number;
  public readonly thumbHitPaddingY: number;

  public constructor(options: HudScrollAreaOptions = {}) {
    super();
    this.trackInsetRight = options.trackInsetRight ?? 10;
    this.trackInsetTop = options.trackInsetTop ?? 40;
    this.trackInsetBottom = options.trackInsetBottom ?? 8;
    this.trackWidth = options.trackWidth ?? 6;
    this.minThumbHeight = options.minThumbHeight ?? 18;
    this.thumbHitPaddingX = options.thumbHitPaddingX ?? 6;
    this.thumbHitPaddingY = options.thumbHitPaddingY ?? 1;
  }

  public setContentExtent(extent: number): void {
    this.contentExtent = Math.max(0, extent);
  }

  public getMaxScroll(viewportExtent: number): number {
    return Math.max(0, this.contentExtent - viewportExtent);
  }

  public setScrollOffset(offset: number, viewportExtent: number): void {
    this.scrollOffset = Math.max(0, Math.min(offset, this.getMaxScroll(viewportExtent)));
  }

  public scrollBy(delta: number, viewportExtent: number): void {
    this.setScrollOffset(this.scrollOffset + delta, viewportExtent);
  }

  public getMetrics(hostRect: UiRect, viewportExtent: number): HudScrollAreaMetrics | null {
    if (this.contentExtent <= viewportExtent + 1) {
      return null;
    }

    const trackRect = {
      x: hostRect.x + hostRect.width - this.trackInsetRight,
      y: hostRect.y + this.trackInsetTop,
      width: this.trackWidth,
      height: hostRect.height - this.trackInsetTop - this.trackInsetBottom,
    };
    const ratio = viewportExtent / this.contentExtent;
    const thumbHeight = Math.max(this.minThumbHeight, Math.floor(trackRect.height * ratio));
    const maxThumbOffset = trackRect.height - thumbHeight;
    const maxScroll = this.getMaxScroll(viewportExtent);
    const thumbOffset = maxThumbOffset * (this.scrollOffset / Math.max(1, maxScroll));
    const thumbRect = {
      x: trackRect.x,
      y: trackRect.y + thumbOffset,
      width: trackRect.width,
      height: thumbHeight,
    };

    return {
      maxScroll,
      trackRect,
      thumbRect,
      thumbHitRect: {
        x: thumbRect.x - this.thumbHitPaddingX,
        y: thumbRect.y - this.thumbHitPaddingY,
        width: thumbRect.width + this.thumbHitPaddingX * 2,
        height: thumbRect.height + this.thumbHitPaddingY * 2,
      },
    };
  }
}
