import {
  delegateCollisionCheck,
  delegateCollisionMtv,
  type CollisionAnchor,
  type CollisionShape,
} from "../CollisionShape.ts";
import type { Transform } from "../../transform/TransformComponent.ts";
import { Vector2D } from "../../math/Vector2D.ts";
import { CircleCollisionShape } from "./CircleCollisionShape.ts";
import { CurveCollisionShape } from "./CurveCollisionShape.ts";

const requirePositiveFinite = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and > 0`);
  return value;
};

const validateTransform = (transform: Transform): void => {
  if (
    !Number.isFinite(transform.position.x) ||
    !Number.isFinite(transform.position.y) ||
    !Number.isFinite(transform.rotation)
  ) {
    throw new Error("Rectangle transform position and rotation must be finite");
  }
  requirePositiveFinite(transform.scale, "Transform scale");
};

export class RectangleCollisionShape implements CollisionShape {
  constructor(
    public width: number,
    public height: number,
  ) {
    requirePositiveFinite(width, "Rectangle width");
    requirePositiveFinite(height, "Rectangle height");
  }

  getAABB(transform: Transform, anchor: CollisionAnchor) {
    requirePositiveFinite(this.width, "Rectangle width");
    requirePositiveFinite(this.height, "Rectangle height");
    validateTransform(transform);
    const scale = transform.scale;
    const w = this.width * scale;
    const h = this.height * scale;
    const left = anchor === "center" ? -w / 2 : 0;
    const top = anchor === "center" ? -h / 2 : 0;
    const right = left + w;
    const bottom = top + h;
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    const x1 = transform.position.x + left * cos - top * sin;
    const y1 = transform.position.y + left * sin + top * cos;
    const x2 = transform.position.x + right * cos - top * sin;
    const y2 = transform.position.y + right * sin + top * cos;
    const x3 = transform.position.x + right * cos - bottom * sin;
    const y3 = transform.position.y + right * sin + bottom * cos;
    const x4 = transform.position.x + left * cos - bottom * sin;
    const y4 = transform.position.y + left * sin + bottom * cos;
    const minX = Math.min(x1, x2, x3, x4);
    const maxX = Math.max(x1, x2, x3, x4);
    const minY = Math.min(y1, y2, y3, y4);
    const maxY = Math.max(y1, y2, y3, y4);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  isCollidingWith(
    other: CollisionShape,
    transformA: Transform,
    anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): boolean {
    if (other instanceof RectangleCollisionShape) {
      const a = this.getAABB(transformA, anchorA);
      const b = other.getAABB(transformB, anchorB);
      return (
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
      );
    }
    if (other instanceof CircleCollisionShape || other instanceof CurveCollisionShape) {
      return other.isCollidingWith(this, transformB, anchorB, transformA, anchorA);
    }
    return delegateCollisionCheck(this, other, transformA, anchorA, transformB, anchorB);
  }

  containsPoint(point: Vector2D, transform: Transform, anchor: CollisionAnchor): boolean {
    requirePositiveFinite(this.width, "Rectangle width");
    requirePositiveFinite(this.height, "Rectangle height");
    validateTransform(transform);
    const width = this.width * transform.scale;
    const height = this.height * transform.scale;
    let px = point.x - transform.position.x;
    let py = point.y - transform.position.y;

    if (transform.rotation !== 0) {
      const cos = Math.cos(-transform.rotation);
      const sin = Math.sin(-transform.rotation);
      const dx = px;
      const dy = py;
      px = dx * cos - dy * sin;
      py = dx * sin + dy * cos;
    }

    if (anchor === "center") {
      px += width / 2;
      py += height / 2;
    }

    return px >= 0 && px <= width && py >= 0 && py <= height;
  }

  resize(width: number, height?: number): void {
    this.width = requirePositiveFinite(width, "Rectangle width");
    if (height !== undefined) {
      this.height = requirePositiveFinite(height, "Rectangle height");
    }
  }

  /** Returns the MTV to push *this* out of `other` (rectangle only). */
  getCollisionNormal(
    other: CollisionShape,
    transformA: Transform,
    anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): Vector2D | null {
    if (other instanceof CircleCollisionShape) {
      const mtvCircle = other.getCollisionNormal(this, transformB, anchorB, transformA, anchorA);
      return mtvCircle ? mtvCircle.negate() : null;
    }

    if (other instanceof CurveCollisionShape) {
      const curveMtv = other.getCollisionNormal(this, transformB, anchorB, transformA, anchorA);
      return curveMtv ? curveMtv.negate() : null;
    }

    if (!(other instanceof RectangleCollisionShape)) {
      return delegateCollisionMtv(this, other, transformA, anchorA, transformB, anchorB);
    }

    const aabbA = this.getAABB(transformA, anchorA);
    const aabbB = other.getAABB(transformB, anchorB);

    const cxA = aabbA.x + aabbA.width / 2;
    const cyA = aabbA.y + aabbA.height / 2;
    const cxB = aabbB.x + aabbB.width / 2;
    const cyB = aabbB.y + aabbB.height / 2;

    const dx = cxB - cxA;
    const dy = cyB - cyA;
    const halfW = (aabbA.width + aabbB.width) / 2;
    const halfH = (aabbA.height + aabbB.height) / 2;
    const overlapX = halfW - Math.abs(dx);
    const overlapY = halfH - Math.abs(dy);

    if (overlapX > 0 && overlapY > 0) {
      if (overlapX < overlapY) {
        return new Vector2D(dx > 0 ? -overlapX : overlapX, 0);
      } else {
        return new Vector2D(0, dy > 0 ? -overlapY : overlapY);
      }
    }

    return null;
  }
}
