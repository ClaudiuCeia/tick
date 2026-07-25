import {
  delegateCollisionCheck,
  delegateCollisionMtv,
  type CollisionAnchor,
  type CollisionShape,
} from "../CollisionShape.ts";
import type { Transform } from "../../transform/TransformComponent.ts";
import { Vector2D } from "../../math/Vector2D.ts";
import { RectangleCollisionShape } from "./RectangleCollisionShape.ts";
import { CurveCollisionShape } from "./CurveCollisionShape.ts";

export class CircleCollisionShape implements CollisionShape {
  constructor(public radius: number) {
    this.radius = this.requireRadius(radius);
  }

  private requireRadius(radius: number): number {
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new Error("Circle radius must be finite and > 0");
    }
    return radius;
  }

  private getCenter(transform: Transform, anchor: CollisionAnchor): Vector2D {
    this.requireRadius(this.radius);
    if (
      !Number.isFinite(transform.position.x) ||
      !Number.isFinite(transform.position.y) ||
      !Number.isFinite(transform.rotation) ||
      !Number.isFinite(transform.scale)
    ) {
      throw new Error("Circle transform must be finite");
    }
    if (transform.scale <= 0) {
      throw new Error("Transform scale must be > 0");
    }
    const r = this.radius * transform.scale;
    if (anchor === "center") return transform.position.clone();
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    return new Vector2D(
      transform.position.x + r * cos - r * sin,
      transform.position.y + r * sin + r * cos,
    );
  }

  getAABB(transform: Transform, anchor: CollisionAnchor) {
    const r = this.radius * transform.scale;
    const center = this.getCenter(transform, anchor);
    return { x: center.x - r, y: center.y - r, width: r * 2, height: r * 2 };
  }

  isCollidingWith(
    other: CollisionShape,
    transformA: Transform,
    anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): boolean {
    if (other instanceof CircleCollisionShape) {
      const cA = this.getCenter(transformA, anchorA);
      const cB = other.getCenter(transformB, anchorB);
      const dx = cA.x - cB.x;
      const dy = cA.y - cB.y;
      const radiusA = this.radius * transformA.scale;
      const radiusB = other.radius * transformB.scale;
      const radiusSum = radiusA + radiusB;
      return dx * dx + dy * dy < radiusSum * radiusSum;
    }
    if (other instanceof RectangleCollisionShape) {
      const cA = this.getCenter(transformA, anchorA);
      const rA = this.radius * transformA.scale;
      const rect = other.getAABB(transformB, anchorB);
      const closestX = Math.max(rect.x, Math.min(cA.x, rect.x + rect.width));
      const closestY = Math.max(rect.y, Math.min(cA.y, rect.y + rect.height));
      const dx = cA.x - closestX;
      const dy = cA.y - closestY;
      return dx * dx + dy * dy < rA * rA;
    }
    if (other instanceof CurveCollisionShape) {
      return other.isCollidingWith(this, transformB, anchorB, transformA, anchorA);
    }
    return delegateCollisionCheck(this, other, transformA, anchorA, transformB, anchorB);
  }

  resize(radius: number): void {
    this.radius = this.requireRadius(radius);
  }

  containsPoint(
    point: { x: number; y: number },
    transform: Transform,
    anchor: CollisionAnchor,
  ): boolean {
    const center = this.getCenter(transform, anchor);
    const r = this.radius * transform.scale;
    const px = point.x - center.x;
    const py = point.y - center.y;
    return px * px + py * py <= r * r;
  }

  getCollisionNormal(
    other: CollisionShape,
    transformA: Transform,
    anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): Vector2D | null {
    if (other instanceof CircleCollisionShape) {
      const cA = this.getCenter(transformA, anchorA);
      const cB = other.getCenter(transformB, anchorB);
      const dx = cA.x - cB.x;
      const dy = cA.y - cB.y;
      const distSq = dx * dx + dy * dy;
      const rA = this.radius * transformA.scale;
      const rB = other.radius * transformB.scale;
      const overlap = rA + rB - Math.sqrt(distSq);
      if (overlap <= 0) return null;

      if (distSq === 0) {
        return new Vector2D(overlap, 0);
      }

      const dist = Math.sqrt(distSq);
      return new Vector2D((dx / dist) * overlap, (dy / dist) * overlap);
    }

    if (other instanceof RectangleCollisionShape) {
      const cA = this.getCenter(transformA, anchorA);
      const rA = this.radius * transformA.scale;
      const rect = other.getAABB(transformB, anchorB);

      const closestX = Math.max(rect.x, Math.min(cA.x, rect.x + rect.width));
      const closestY = Math.max(rect.y, Math.min(cA.y, rect.y + rect.height));
      const dx = cA.x - closestX;
      const dy = cA.y - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq > 0) {
        const dist = Math.sqrt(distSq);
        const overlap = rA - dist;
        if (overlap <= 0) return null;
        return new Vector2D((dx / dist) * overlap, (dy / dist) * overlap);
      }

      // Center is inside/edge of rectangle: push along shallowest axis.
      const left = cA.x - rect.x;
      const right = rect.x + rect.width - cA.x;
      const top = cA.y - rect.y;
      const bottom = rect.y + rect.height - cA.y;
      const minX = Math.min(left, right);
      const minY = Math.min(top, bottom);

      if (minX < minY) {
        return new Vector2D(left < right ? -(rA + left) : rA + right, 0);
      }
      return new Vector2D(0, top < bottom ? -(rA + top) : rA + bottom);
    }

    if (other instanceof CurveCollisionShape) {
      const curveMtv = other.getCollisionNormal(this, transformB, anchorB, transformA, anchorA);
      return curveMtv ? curveMtv.negate() : null;
    }

    return delegateCollisionMtv(this, other, transformA, anchorA, transformB, anchorB);
  }
}
