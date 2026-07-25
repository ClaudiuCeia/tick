import { Entity } from "../ecs/Entity.ts";
import { Component } from "../ecs/Component.ts";
import { Vector2D } from "../math/Vector2D.ts";

type radians = number;

export type Transform = {
  position: Vector2D;
  rotation: radians;
  scale: number;
};

const requirePositiveFinite = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be finite and > 0`);
  }
  return value;
};

const requireFinite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
};

const validateTransform = (transform: Transform): void => {
  requireFinite(transform.position.x, "Transform position.x");
  requireFinite(transform.position.y, "Transform position.y");
  requireFinite(transform.rotation, "Transform rotation");
  requirePositiveFinite(transform.scale, "Transform scale");
};

export class TransformComponent extends Component {
  private _parent: TransformComponent | null = null;

  constructor(
    private _transform: Transform = {
      position: new Vector2D(0, 0),
      rotation: 0,
      scale: 1,
    },
    parent: TransformComponent | null = null,
  ) {
    super();
    validateTransform(_transform);
    this.parent = parent;
  }

  public get transform(): Transform {
    return this._transform;
  }

  public get parent(): TransformComponent | null {
    return this._parent;
  }

  public set parent(target: TransformComponent | null) {
    if (!target) {
      this._parent = null;
      return;
    }

    const visited = new Set<TransformComponent>();
    let current: TransformComponent | null = target;
    while (current) {
      if (current === this) throw new Error("Transform cannot be anchored into a cycle");
      if (visited.has(current))
        throw new Error("Target transform already contains an anchor cycle");
      visited.add(current);
      current = current.parent;
    }
    this._parent = target;
  }

  /** World-space transform, accounting for parent rotation and scale. */
  public get globalTransform(): Transform {
    const visited = new Set<TransformComponent>();
    let current: TransformComponent | null = this.parent;
    while (current) {
      if (visited.has(current)) throw new Error("Transform anchor cycle detected");
      visited.add(current);
      current = current.parent;
    }
    return this.calculateGlobalTransform();
  }

  private calculateGlobalTransform(): Transform {
    const local = this._transform;
    validateTransform(local);
    if (!this.parent) {
      return {
        position: local.position.clone(),
        rotation: local.rotation,
        scale: local.scale,
      };
    }

    const parent = this.parent.calculateGlobalTransform();
    const cos = Math.cos(parent.rotation);
    const sin = Math.sin(parent.rotation);
    const localX = local.position.x * parent.scale;
    const localY = local.position.y * parent.scale;
    const result = {
      position: new Vector2D(
        parent.position.x + localX * cos - localY * sin,
        parent.position.y + localX * sin + localY * cos,
      ),
      rotation: parent.rotation + local.rotation,
      scale: parent.scale * local.scale,
    };
    validateTransform(result);
    return result;
  }

  public override awake(): void {
    if (!this.parent) {
      const entParent = this.entity?.parent;
      if (entParent && entParent.hasComponent(TransformComponent)) {
        this.anchorTo(entParent.getComponent(TransformComponent));
      }
    }
  }

  public override update(_deltaTime: number): void {}

  public translate(x: number, y: number): TransformComponent {
    requireFinite(x, "Transform translation.x");
    requireFinite(y, "Transform translation.y");
    requireFinite(this._transform.position.x + x, "Transform position.x");
    requireFinite(this._transform.position.y + y, "Transform position.y");
    this._transform.position.x += x;
    this._transform.position.y += y;
    return this;
  }

  /** Applies a world-space displacement, converting it through the parent transform. */
  public translateWorld(x: number, y: number): TransformComponent {
    requireFinite(x, "World translation.x");
    requireFinite(y, "World translation.y");
    if (!this.parent) return this.translate(x, y);

    const parent = this.parent.globalTransform;
    requirePositiveFinite(parent.scale, "Parent transform scale");
    const cos = Math.cos(parent.rotation);
    const sin = Math.sin(parent.rotation);
    return this.translate((x * cos + y * sin) / parent.scale, (-x * sin + y * cos) / parent.scale);
  }

  public rotate(angle: radians): TransformComponent {
    this._transform.rotation = requireFinite(
      this._transform.rotation + angle,
      "Transform rotation",
    );
    return this;
  }

  public scaleBy(factor: number): TransformComponent {
    this._transform.scale = requirePositiveFinite(
      this._transform.scale * factor,
      "Transform scale",
    );
    return this;
  }

  public setPosition(position: Vector2D): TransformComponent;
  public setPosition(x: number, y: number): TransformComponent;
  public setPosition(xOrPosition: number | Vector2D, y?: number): TransformComponent {
    if (typeof xOrPosition === "number") {
      if (y === undefined) throw new Error("y must be provided when x is a number");
      requireFinite(xOrPosition, "Transform position.x");
      requireFinite(y, "Transform position.y");
      this._transform.position.x = xOrPosition;
      this._transform.position.y = y;
    } else {
      requireFinite(xOrPosition.x, "Transform position.x");
      requireFinite(xOrPosition.y, "Transform position.y");
      this._transform.position.x = xOrPosition.x;
      this._transform.position.y = xOrPosition.y;
    }
    return this;
  }

  public setRotation(angle: radians): TransformComponent {
    this._transform.rotation = requireFinite(angle, "Transform rotation");
    return this;
  }

  public setScale(scale: number): TransformComponent {
    this._transform.scale = requirePositiveFinite(scale, "Transform scale");
    return this;
  }

  /**
   * Returns the world-space position.
   * Uses globalTransform, which correctly accounts for parent rotation.
   */
  public getGlobalPosition(): Vector2D {
    return this.globalTransform.position;
  }

  public anchorTo(entity: Entity): TransformComponent;
  public anchorTo(transform: TransformComponent): TransformComponent;
  public anchorTo(entityOrTransform: Entity | TransformComponent): TransformComponent {
    let target: TransformComponent;
    if (entityOrTransform instanceof Entity) {
      if (!entityOrTransform.hasComponent(TransformComponent)) {
        throw new Error("Entity does not have a TransformComponent");
      }
      target = entityOrTransform.getComponent(TransformComponent);
    } else {
      target = entityOrTransform;
    }

    this.parent = target;
    return this;
  }

  public unanchor(): TransformComponent {
    this.parent = null;
    return this;
  }

  public printAnchorChain(): void {
    let current: TransformComponent | null = this.parent;
    const chain: string[] = [];
    {
      const { position, rotation, scale } = this._transform;
      chain.push(`(${position.x}, ${position.y}) r=${rotation} s=${scale}`);
    }
    while (current) {
      const { position, rotation, scale } = current._transform;
      chain.push(`(${position.x}, ${position.y}) r=${rotation} s=${scale}`);
      current = current.parent;
    }
    console.log("Anchor chain:", chain.reverse().join(" -> "));
  }
}
