import { Component } from "../ecs/Component.ts";
import type { Entity } from "../ecs/Entity.ts";
import { normalizeInsets, type UiInsetsInput } from "./types.ts";

export type HudDeckLayoutOptions = {
  padding?: UiInsetsInput;
};

export class HudDeckLayoutComponent<T extends Entity = Entity> extends Component<T> {
  private paddingValue: UiInsetsInput;

  constructor(options: HudDeckLayoutOptions = {}) {
    super();
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
