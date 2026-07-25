import type { Transform } from "../transform/TransformComponent.ts";
import type { Vector2D } from "../math/Vector2D.ts";

export type CollisionAnchor = "center" | "top-left";

export interface CollisionShape {
  getAABB(
    transform: Transform,
    anchor: CollisionAnchor,
  ): { x: number; y: number; width: number; height: number };

  isCollidingWith(
    other: CollisionShape,
    transformA: Transform,
    anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): boolean;

  containsPoint(point: Vector2D, transform: Transform, anchor: CollisionAnchor): boolean;

  resize(...args: number[]): void;

  /**
   * Returns the minimum-translation-vector (MTV) to push *this* out of `other`
   * in world-space, or null if no overlap. Normalize to get a collision normal.
   */
  getCollisionNormal(
    other: CollisionShape,
    transformA: Transform,
    anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): Vector2D | null;
}

const booleanDelegations = new WeakMap<CollisionShape, WeakSet<CollisionShape>>();
const mtvDelegations = new WeakMap<CollisionShape, WeakSet<CollisionShape>>();

const withDelegationGuard = <T>(
  guards: WeakMap<CollisionShape, WeakSet<CollisionShape>>,
  shapeA: CollisionShape,
  shapeB: CollisionShape,
  fallback: T,
  delegate: () => T,
): T => {
  let fromA = guards.get(shapeA);
  if (fromA?.has(shapeB)) return fallback;

  fromA ??= new WeakSet<CollisionShape>();
  let fromB = guards.get(shapeB);
  fromB ??= new WeakSet<CollisionShape>();
  guards.set(shapeA, fromA);
  guards.set(shapeB, fromB);
  fromA.add(shapeB);
  fromB.add(shapeA);
  try {
    return delegate();
  } finally {
    fromA.delete(shapeB);
    fromB.delete(shapeA);
  }
};

/**
 * Safely asks an unknown shape to handle a boolean collision check.
 * Returns false when both shapes delegate the same unsupported pair.
 */
export const delegateCollisionCheck = (
  shape: CollisionShape,
  other: CollisionShape,
  transform: Transform,
  anchor: CollisionAnchor,
  otherTransform: Transform,
  otherAnchor: CollisionAnchor,
): boolean =>
  withDelegationGuard(booleanDelegations, shape, other, false, () =>
    other.isCollidingWith(shape, otherTransform, otherAnchor, transform, anchor),
  );

/**
 * Safely asks an unknown shape for its MTV and converts it to move `shape` out.
 * Returns null when both shapes delegate the same unsupported pair.
 */
export const delegateCollisionMtv = (
  shape: CollisionShape,
  other: CollisionShape,
  transform: Transform,
  anchor: CollisionAnchor,
  otherTransform: Transform,
  otherAnchor: CollisionAnchor,
): Vector2D | null =>
  withDelegationGuard(mtvDelegations, shape, other, null, () => {
    const otherMtv = other.getCollisionNormal(
      shape,
      otherTransform,
      otherAnchor,
      transform,
      anchor,
    );
    return otherMtv ? otherMtv.negate() : null;
  });
