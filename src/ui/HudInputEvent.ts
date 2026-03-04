import type { Vector2D } from "../math/Vector2D.ts";

export type HudPointerType = "mouse" | "touch";

export type HudInputEventType =
  | "pointermove"
  | "pointerdown"
  | "pointerup"
  | "pointerenter"
  | "pointerleave"
  | "click"
  | "wheel"
  | "touchstart"
  | "touchmove"
  | "touchend"
  | "touchcancel"
  | "keydown"
  | "keyup"
  | "focus"
  | "blur";

export type HudInputEventInit = {
  hudPoint: Vector2D | null;
  clientPoint?: Vector2D;
  pointerType?: HudPointerType;
  touchId?: number;
  key?: string;
  code?: string;
  wheelDelta?: Vector2D;
  nativeEvent?: Event;
};

export class HudInputEvent {
  public readonly hudPoint: Vector2D | null;
  public readonly clientPoint: Vector2D | null;
  public readonly pointerType: HudPointerType | null;
  public readonly touchId: number | null;
  public readonly key: string | null;
  public readonly code: string | null;
  public readonly wheelDelta: Vector2D | null;
  public readonly nativeEvent: Event | null;

  private stopped = false;

  constructor(
    public readonly type: HudInputEventType,
    init: HudInputEventInit,
  ) {
    this.hudPoint = init.hudPoint;
    this.clientPoint = init.clientPoint ?? null;
    this.pointerType = init.pointerType ?? null;
    this.touchId = init.touchId ?? null;
    this.key = init.key ?? null;
    this.code = init.code ?? null;
    this.wheelDelta = init.wheelDelta ?? null;
    this.nativeEvent = init.nativeEvent ?? null;
  }

  public stopPropagation(): void {
    this.stopped = true;
  }

  public get propagationStopped(): boolean {
    return this.stopped;
  }
}
