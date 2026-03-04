import { Component } from "../ecs/Component.ts";
import type { Entity } from "../ecs/Entity.ts";
import {
  normalizeInsets,
  type UiAxisAlign,
  type UiCrossAlign,
  type UiInsetsInput,
} from "./types.ts";

export type HudStackDirection = "row" | "column";

export type HudStackLayoutOptions = {
  direction?: HudStackDirection;
  gap?: number;
  padding?: UiInsetsInput;
  mainAlign?: UiAxisAlign;
  crossAlign?: UiCrossAlign;
};

export class HudStackLayoutComponent<T extends Entity = Entity> extends Component<T> {
  public direction: HudStackDirection;
  public gap: number;
  public mainAlign: UiAxisAlign;
  public crossAlign: UiCrossAlign;

  private paddingValue: UiInsetsInput;

  constructor(options: HudStackLayoutOptions = {}) {
    super();
    this.direction = options.direction ?? "row";
    this.gap = options.gap ?? 0;
    this.mainAlign = options.mainAlign ?? "start";
    this.crossAlign = options.crossAlign ?? "start";
    this.paddingValue = options.padding ?? 0;
  }

  public setPadding(padding: UiInsetsInput): this {
    this.paddingValue = padding;
    return this;
  }

  public get padding() {
    return normalizeInsets(this.paddingValue);
  }
}
