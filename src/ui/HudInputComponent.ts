import { Component } from "../ecs/Component.ts";
import type { Entity } from "../ecs/Entity.ts";
import type { HudInputEvent } from "./HudInputEvent.ts";
import { HudInputRouter } from "./HudInputRouter.ts";

export type HudKeyboardMode = "focused" | "global";

export class HudInputComponent<T extends Entity = Entity> extends Component<T> {
  public enabled = true;
  public interactive = true;
  public pointerEnabled = true;
  public touchEnabled = true;
  public keyboardEnabled = true;
  public focusable = false;
  public keyboardMode: HudKeyboardMode = "focused";
  public priority = 0;

  public override awake(): void {
    super.awake();
    HudInputRouter.register(this, this.ent.runtime);
  }

  public override destroy(): void {
    HudInputRouter.unregister(this, this.ent.runtime);
    super.destroy();
  }

  public get hasFocus(): boolean {
    return HudInputRouter.isFocused(this, this.ent.runtime);
  }

  public handleHudInput(event: HudInputEvent): void {
    this.onInput(event);

    switch (event.type) {
      case "pointermove":
        this.onPointerMove(event);
        break;
      case "pointerdown":
        this.onPointerDown(event);
        break;
      case "pointerup":
        this.onPointerUp(event);
        break;
      case "pointerenter":
        this.onPointerEnter(event);
        break;
      case "pointerleave":
        this.onPointerLeave(event);
        break;
      case "click":
        this.onClick(event);
        break;
      case "wheel":
        this.onWheel(event);
        break;
      case "touchstart":
        this.onTouchStart(event);
        this.onPointerDown(event);
        break;
      case "touchmove":
        this.onTouchMove(event);
        this.onPointerMove(event);
        break;
      case "touchend":
        this.onTouchEnd(event);
        this.onPointerUp(event);
        break;
      case "touchcancel":
        this.onTouchCancel(event);
        this.onPointerLeave(event);
        break;
      case "keydown":
        this.onKeyDown(event);
        break;
      case "keyup":
        this.onKeyUp(event);
        break;
      case "focus":
        this.onFocus(event);
        break;
      case "blur":
        this.onBlur(event);
        break;
    }
  }

  protected onInput(_event: HudInputEvent): void {}
  protected onPointerMove(_event: HudInputEvent): void {}
  protected onPointerDown(_event: HudInputEvent): void {}
  protected onPointerUp(_event: HudInputEvent): void {}
  protected onPointerEnter(_event: HudInputEvent): void {}
  protected onPointerLeave(_event: HudInputEvent): void {}
  protected onClick(_event: HudInputEvent): void {}
  protected onWheel(_event: HudInputEvent): void {}
  protected onTouchStart(_event: HudInputEvent): void {}
  protected onTouchMove(_event: HudInputEvent): void {}
  protected onTouchEnd(_event: HudInputEvent): void {}
  protected onTouchCancel(_event: HudInputEvent): void {}
  protected onKeyDown(_event: HudInputEvent): void {}
  protected onKeyUp(_event: HudInputEvent): void {}
  protected onFocus(_event: HudInputEvent): void {}
  protected onBlur(_event: HudInputEvent): void {}
}
