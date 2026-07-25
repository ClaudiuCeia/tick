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
  private _contentExtent = 0;
  public scrollOffset = 0;
  public hoveredThumb = false;
  private lastViewportExtent: number | null = null;

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

  public get contentExtent(): number {
    return this._contentExtent;
  }

  public set contentExtent(extent: number) {
    this._contentExtent = Number.isFinite(extent) ? Math.max(0, extent) : 0;
    if (this.lastViewportExtent !== null) {
      this.clampScrollOffset(this.lastViewportExtent);
    }
  }

  public setContentExtent(extent: number, viewportExtent?: number): void {
    if (viewportExtent !== undefined) {
      this.lastViewportExtent = this.normalizeViewportExtent(viewportExtent);
    }
    this.contentExtent = extent;
  }

  public getMaxScroll(viewportExtent: number): number {
    const viewport = this.normalizeViewportExtent(viewportExtent);
    return Math.max(0, this.contentExtent - viewport);
  }

  public setScrollOffset(offset: number, viewportExtent: number): void {
    const viewport = this.normalizeViewportExtent(viewportExtent);
    this.lastViewportExtent = viewport;
    const safeOffset = Number.isFinite(offset) ? offset : 0;
    this.scrollOffset = Math.max(0, Math.min(safeOffset, this.getMaxScroll(viewport)));
  }

  public scrollBy(delta: number, viewportExtent: number): void {
    this.setScrollOffset(this.scrollOffset + delta, viewportExtent);
  }

  public getMetrics(hostRect: UiRect, viewportExtent: number): HudScrollAreaMetrics | null {
    const viewport = this.normalizeViewportExtent(viewportExtent);
    this.lastViewportExtent = viewport;
    this.clampScrollOffset(viewport);
    if (this.contentExtent <= viewport + 1) {
      return null;
    }

    const trackRect = {
      x: hostRect.x + hostRect.width - this.trackInsetRight,
      y: hostRect.y + this.trackInsetTop,
      width: Math.max(0, this.trackWidth),
      height: Math.max(0, hostRect.height - this.trackInsetTop - this.trackInsetBottom),
    };
    const ratio = Math.max(0, Math.min(1, viewport / this.contentExtent));
    const thumbHeight = Math.min(
      trackRect.height,
      Math.max(0, this.minThumbHeight, Math.floor(trackRect.height * ratio)),
    );
    const maxThumbOffset = Math.max(0, trackRect.height - thumbHeight);
    const maxScroll = this.getMaxScroll(viewport);
    const thumbOffset = maxScroll > 0 ? maxThumbOffset * (this.scrollOffset / maxScroll) : 0;
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

  private normalizeViewportExtent(viewportExtent: number): number {
    return Number.isFinite(viewportExtent) ? Math.max(0, viewportExtent) : 0;
  }

  private clampScrollOffset(viewportExtent: number): void {
    const safeOffset = Number.isFinite(this.scrollOffset) ? this.scrollOffset : 0;
    this.scrollOffset = Math.max(0, Math.min(safeOffset, this.getMaxScroll(viewportExtent)));
  }
}
