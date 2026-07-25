import { Vector2D } from "../math/Vector2D.ts";

/**
 * Runtime-scoped input manager with per-frame state tracking.
 *
 * Call `init()` once at game boot, then `clearFrame()` at the end
 * of each frame to reset pressed/released state.
 *
 * - `isDown(key)` — key is currently held
 * - `isPressed(key)` — key became pressed this frame (single-frame)
 * - `isReleased(key)` — key was released this frame (single-frame)
 */
export class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();

  private mouseDown = new Set<number>();
  private mousePressed = new Set<number>();
  private mouseReleased = new Set<number>();
  private mouseClick = false;
  private mousePos = new Vector2D(0, 0);
  private mouseDelta = new Vector2D(0, 0);
  private wheelDeltaY = 0;
  private draggingButtons = new Set<number>();
  private dragStartByButton = new Map<number, Vector2D>();

  private initialized = false;
  private target: EventTarget | null = null;
  private releaseTarget: EventTarget | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.down.has(e.key)) {
      this.pressed.add(e.key);
    }
    this.down.add(e.key);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.down.delete(e.key)) {
      this.released.add(e.key);
    }
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const prevX = this.mousePos.x;
    const prevY = this.mousePos.y;
    this.mousePos.x = e.clientX;
    this.mousePos.y = e.clientY;

    this.mouseDelta.x += e.clientX - prevX;
    this.mouseDelta.y += e.clientY - prevY;

    this.releaseMissingMouseButtons(e.buttons);
    if (e.buttons === 0) return;
    if (e.clientX === prevX && e.clientY === prevY) return;

    for (const button of this.mouseDown) {
      this.draggingButtons.add(button);
      if (!this.dragStartByButton.has(button)) {
        this.dragStartByButton.set(button, new Vector2D(prevX, prevY));
      }
    }
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    this.updateMousePosition(e);
    if (!this.mouseDown.has(e.button)) {
      this.mousePressed.add(e.button);
      this.dragStartByButton.set(e.button, this.mousePos.clone());
    }
    this.mouseDown.add(e.button);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.updateMousePosition(e);
    if (this.mouseDown.delete(e.button)) {
      this.mouseReleased.add(e.button);
    }
    this.draggingButtons.delete(e.button);
    this.dragStartByButton.delete(e.button);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    this.updateMousePosition(e);
    this.wheelDeltaY += e.deltaY;
  };

  private readonly onClick = (e: MouseEvent): void => {
    this.updateMousePosition(e);
    this.mouseClick = true;
  };

  private readonly onBlur = (): void => {
    for (const key of this.down) this.released.add(key);
    this.down.clear();
    for (const button of this.mouseDown) this.mouseReleased.add(button);
    this.mouseDown.clear();
    this.draggingButtons.clear();
    this.dragStartByButton.clear();
  };

  public init(target: EventTarget = document.body): void {
    if (this.initialized) return;
    this.target = target;
    this.target.addEventListener("keydown", this.onKeyDown as EventListener);
    this.target.addEventListener("keyup", this.onKeyUp as EventListener);
    this.target.addEventListener("mousemove", this.onMouseMove as EventListener);
    this.target.addEventListener("mousedown", this.onMouseDown as EventListener);
    this.target.addEventListener("mouseup", this.onMouseUp as EventListener);
    this.target.addEventListener("wheel", this.onWheel as EventListener);
    this.target.addEventListener("click", this.onClick as EventListener);
    this.target.addEventListener("blur", this.onBlur as EventListener);

    const ownerWindow = (target as EventTarget & { ownerDocument?: { defaultView?: EventTarget } })
      .ownerDocument?.defaultView;
    const globalWindow = typeof window === "undefined" ? undefined : window;
    this.releaseTarget = ownerWindow ?? globalWindow ?? null;
    if (this.releaseTarget === this.target) this.releaseTarget = null;
    this.releaseTarget?.addEventListener("keyup", this.onKeyUp as EventListener);
    this.releaseTarget?.addEventListener("mouseup", this.onMouseUp as EventListener);
    this.releaseTarget?.addEventListener("blur", this.onBlur as EventListener);
    this.initialized = true;
  }

  public dispose(): void {
    if (!this.initialized || !this.target) return;
    this.target.removeEventListener("keydown", this.onKeyDown as EventListener);
    this.target.removeEventListener("keyup", this.onKeyUp as EventListener);
    this.target.removeEventListener("mousemove", this.onMouseMove as EventListener);
    this.target.removeEventListener("mousedown", this.onMouseDown as EventListener);
    this.target.removeEventListener("mouseup", this.onMouseUp as EventListener);
    this.target.removeEventListener("wheel", this.onWheel as EventListener);
    this.target.removeEventListener("click", this.onClick as EventListener);
    this.target.removeEventListener("blur", this.onBlur as EventListener);
    this.releaseTarget?.removeEventListener("keyup", this.onKeyUp as EventListener);
    this.releaseTarget?.removeEventListener("mouseup", this.onMouseUp as EventListener);
    this.releaseTarget?.removeEventListener("blur", this.onBlur as EventListener);
    this.releaseTarget = null;
    this.target = null;
    this.initialized = false;
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.mouseDown.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.draggingButtons.clear();
    this.dragStartByButton.clear();
    this.mouseClick = false;
    this.mousePos = new Vector2D(0, 0);
    this.mouseDelta = new Vector2D(0, 0);
    this.wheelDeltaY = 0;
  }

  public isDown(key: string): boolean {
    return this.down.has(key);
  }

  public isPressed(key: string): boolean {
    return this.pressed.has(key);
  }

  public isReleased(key: string): boolean {
    return this.released.has(key);
  }

  public isMouseDown(button?: number): boolean {
    if (button === undefined) return this.mouseDown.size > 0;
    return this.mouseDown.has(button);
  }

  public isMousePressed(button?: number): boolean {
    if (button === undefined) return this.mousePressed.size > 0;
    return this.mousePressed.has(button);
  }

  public isMouseReleased(button?: number): boolean {
    if (button === undefined) return this.mouseReleased.size > 0;
    return this.mouseReleased.has(button);
  }

  /** True only on the frame the user clicked. */
  public isMouseClick(): boolean {
    return this.mouseClick;
  }

  public getMousePos(): Vector2D {
    return this.mousePos.clone();
  }

  public getMouseDelta(): Vector2D {
    return this.mouseDelta.clone();
  }

  public getWheelDeltaY(): number {
    return this.wheelDeltaY;
  }

  public isDragging(button?: number): boolean {
    if (button === undefined) return this.draggingButtons.size > 0;
    return this.draggingButtons.has(button);
  }

  public getDragStartPos(button?: number): Vector2D | null {
    if (button !== undefined) {
      return this.dragStartByButton.get(button)?.clone() ?? null;
    }

    const first = this.dragStartByButton.values().next();
    if (first.done) return null;
    return first.value.clone();
  }

  /** Call once at the end of each frame to reset pressed/released state. */
  public clearFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.wheelDeltaY = 0;
    this.mouseClick = false;
  }

  private updateMousePosition(e: MouseEvent): void {
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      this.mousePos.set(e.clientX, e.clientY);
    }
  }

  private releaseMissingMouseButtons(buttons: number): void {
    for (const button of Array.from(this.mouseDown)) {
      const mask = button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 1 << button;
      if ((buttons & mask) !== 0) continue;
      this.mouseDown.delete(button);
      this.mouseReleased.add(button);
      this.draggingButtons.delete(button);
      this.dragStartByButton.delete(button);
    }
  }
}
