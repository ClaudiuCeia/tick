import {
  delegateCollisionCheck,
  delegateCollisionMtv,
  type CollisionAnchor,
  type CollisionShape,
} from "../CollisionShape.ts";
import { RectangleCollisionShape } from "./RectangleCollisionShape.ts";
import { CircleCollisionShape } from "./CircleCollisionShape.ts";
import type { Transform } from "../../transform/TransformComponent.ts";
import { Vector2D } from "../../math/Vector2D.ts";

export type CurveCollisionShapeOptions = {
  /** Finite thickness of the solid region below the surface. */
  depth?: number;
  /**
   * Guaranteed local-space extrema of `getYAt` over `[0, width]`.
   * Required when broadphase bounds must be conservative.
   */
  surfaceBounds?: { min: number; max: number };
  /** Throw unless explicit conservative `surfaceBounds` are supplied. */
  requireSurfaceBounds?: boolean;
  /** Samples used for the approximate AABB fallback. */
  boundsSamples?: number;
  /** Samples used for boolean collision and MTV calculations. */
  collisionSamples?: number;
};

type VerticalInterval = { top: number; bottom: number };

/**
 * A finite curved solid extending `depth` units below a height function.
 * Supply `surfaceBounds` for a guaranteed conservative broadphase AABB. Without
 * explicit bounds, the AABB is an approximation sampled at `boundsSamples + 1`
 * points and may miss narrower extrema. Narrowphase always evaluates the actual
 * `getYAt` values at `collisionSamples + 1` points and never clamps the surface.
 */
export class CurveCollisionShape implements CollisionShape {
  public depth: number;
  public readonly hasConservativeBounds: boolean;
  private readonly surfaceBounds: { min: number; max: number } | null;
  private readonly aabbSurfaceBounds: { min: number; max: number };
  private readonly boundsSamples: number;
  private readonly collisionSamples: number;

  constructor(
    public getYAt: (x: number) => number,
    public width = 9999,
    depthOrOptions: number | CurveCollisionShapeOptions = 10000,
  ) {
    const options = typeof depthOrOptions === "number" ? { depth: depthOrOptions } : depthOrOptions;
    this.depth = options.depth ?? 10000;
    this.boundsSamples = options.boundsSamples ?? 64;
    this.collisionSamples = options.collisionSamples ?? 8;
    this.surfaceBounds = options.surfaceBounds ? { ...options.surfaceBounds } : null;
    this.hasConservativeBounds = this.surfaceBounds !== null;
    this.validateDimensions();
    if (!Number.isSafeInteger(this.boundsSamples) || this.boundsSamples < 1) {
      throw new Error("Curve boundsSamples must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.collisionSamples) || this.collisionSamples < 1) {
      throw new Error("Curve collisionSamples must be a positive safe integer");
    }
    if (options.requireSurfaceBounds && !this.surfaceBounds) {
      throw new Error("Curve surfaceBounds are required for conservative broadphase bounds");
    }
    if (this.surfaceBounds) {
      if (
        !Number.isFinite(this.surfaceBounds.min) ||
        !Number.isFinite(this.surfaceBounds.max) ||
        this.surfaceBounds.min > this.surfaceBounds.max
      ) {
        throw new Error("Curve surfaceBounds must be finite and ordered");
      }
    }
    this.aabbSurfaceBounds = this.sampleLocalSurfaceBounds();
  }

  private validateDimensions(): void {
    if (!Number.isFinite(this.width) || this.width <= 0) {
      throw new Error("Curve width must be finite and > 0");
    }
    if (!Number.isFinite(this.depth) || this.depth <= 0) {
      throw new Error("Curve depth must be finite and > 0");
    }
  }

  private validateTransform(transform: Transform): void {
    this.validateDimensions();
    if (
      !Number.isFinite(transform.position.x) ||
      !Number.isFinite(transform.position.y) ||
      !Number.isFinite(transform.rotation) ||
      !Number.isFinite(transform.scale)
    ) {
      throw new Error("Curve transform must be finite");
    }
    if (transform.rotation !== 0) {
      throw new Error("CurveCollisionShape does not support rotation");
    }
    if (transform.scale !== 1) {
      throw new Error("CurveCollisionShape does not support scaling");
    }
  }

  private rawLocalSurfaceY(localX: number): number {
    const y = this.getYAt(localX);
    if (!Number.isFinite(y)) throw new Error("Curve height function must return a finite value");
    return y;
  }

  private localSurfaceY(localX: number): number {
    const y = this.rawLocalSurfaceY(localX);
    if (this.surfaceBounds && (y < this.surfaceBounds.min || y > this.surfaceBounds.max)) {
      throw new Error("Curve height function returned a value outside surfaceBounds");
    }
    return y;
  }

  private sampleY(transform: Transform, worldX: number): number {
    return transform.position.y + this.localSurfaceY(worldX - transform.position.x);
  }

  private sampleLocalSurfaceBounds(): { min: number; max: number } {
    if (this.surfaceBounds) return this.surfaceBounds;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= this.boundsSamples; i++) {
      const y = this.rawLocalSurfaceY((this.width * i) / this.boundsSamples);
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
    return { min, max };
  }

  /** Returns the MTV on the other shape, along the vertical axis. */
  private getOtherMtvY(
    other: RectangleCollisionShape | CircleCollisionShape,
    curveTransform: Transform,
    otherTransform: Transform,
    otherAnchor: CollisionAnchor,
  ): number | null {
    this.validateTransform(curveTransform);
    const curveLeft = curveTransform.position.x;
    const curveRight = curveLeft + this.width;
    const bounds = other.getAABB(otherTransform, otherAnchor);
    const left = Math.max(bounds.x, curveLeft);
    const right = Math.min(bounds.x + bounds.width, curveRight);
    if (left >= right) return null;

    let intervalAt: (x: number) => VerticalInterval;
    if (other instanceof RectangleCollisionShape) {
      const interval = { top: bounds.y, bottom: bounds.y + bounds.height };
      intervalAt = () => interval;
    } else {
      const radius = bounds.width / 2;
      const centerX = bounds.x + radius;
      const centerY = bounds.y + radius;
      intervalAt = (x) => {
        const extent = Math.sqrt(Math.max(0, radius * radius - (x - centerX) ** 2));
        return { top: centerY - extent, bottom: centerY + extent };
      };
    }

    let colliding = false;
    let moveUp = 0;
    let moveDown = 0;
    for (let i = 0; i <= this.collisionSamples; i++) {
      const x = left + ((right - left) * i) / this.collisionSamples;
      const surface = this.sampleY(curveTransform, x);
      const solidBottom = surface + this.depth;
      const otherInterval = intervalAt(x);
      if (otherInterval.top >= solidBottom || otherInterval.bottom <= surface) continue;

      colliding = true;
      moveUp = Math.max(moveUp, otherInterval.bottom - surface);
      moveDown = Math.max(moveDown, solidBottom - otherInterval.top);
    }

    if (!colliding) return null;
    return moveUp <= moveDown ? -moveUp : moveDown;
  }

  getAABB(transform: Transform, _anchor: CollisionAnchor) {
    this.validateTransform(transform);
    const bounds = this.aabbSurfaceBounds;
    return {
      x: transform.position.x,
      y: transform.position.y + bounds.min,
      width: this.width,
      height: bounds.max - bounds.min + this.depth,
    };
  }

  isCollidingWith(
    other: CollisionShape,
    transformA: Transform,
    _anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): boolean {
    if (other instanceof RectangleCollisionShape || other instanceof CircleCollisionShape) {
      return this.getOtherMtvY(other, transformA, transformB, anchorB) !== null;
    }
    return delegateCollisionCheck(this, other, transformA, _anchorA, transformB, anchorB);
  }

  containsPoint(
    point: { x: number; y: number },
    transform: Transform,
    _anchor: CollisionAnchor,
  ): boolean {
    this.validateTransform(transform);
    if (point.x < transform.position.x || point.x > transform.position.x + this.width) return false;
    const surface = this.sampleY(transform, point.x);
    return point.y >= surface && point.y <= surface + this.depth;
  }

  resize(..._args: number[]): void {
    throw new Error("CurveCollisionShape does not support resizing");
  }

  getCollisionNormal(
    other: CollisionShape,
    transformA: Transform,
    _anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): Vector2D | null {
    if (other instanceof RectangleCollisionShape || other instanceof CircleCollisionShape) {
      const otherMtvY = this.getOtherMtvY(other, transformA, transformB, anchorB);
      return otherMtvY === null ? null : new Vector2D(0, -otherMtvY);
    }
    return delegateCollisionMtv(this, other, transformA, _anchorA, transformB, anchorB);
  }
}
