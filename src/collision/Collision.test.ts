import { describe, test, expect, beforeEach } from "bun:test";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { TransformComponent } from "../transform/TransformComponent.ts";
import { Vector2D } from "../math/Vector2D.ts";
import { CollisionEntity } from "./CollisionEntity.ts";
import { RectangleCollisionShape } from "./shapes/RectangleCollisionShape.ts";
import { CircleCollisionShape } from "./shapes/CircleCollisionShape.ts";
import { CurveCollisionShape } from "./shapes/CurveCollisionShape.ts";
import { SpatialHashBroadphase } from "./SpatialHashBroadphase.ts";
import {
  delegateCollisionCheck,
  delegateCollisionMtv,
  type CollisionAnchor,
  type CollisionShape,
} from "./CollisionShape.ts";
import type { Transform } from "../transform/TransformComponent.ts";

beforeEach(() => {
  EcsRuntime.reset();
});

const tx = (x: number, y: number, rotation = 0, scale = 1) => ({
  position: new Vector2D(x, y),
  rotation,
  scale,
});

class DelegatingTestShape implements CollisionShape {
  constructor(private readonly handlesRectangles = false) {}

  getAABB(transform: Transform) {
    return { x: transform.position.x, y: transform.position.y, width: 1, height: 1 };
  }

  isCollidingWith(
    other: CollisionShape,
    transformA: Transform,
    anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): boolean {
    if (this.handlesRectangles && other instanceof RectangleCollisionShape) return true;
    return delegateCollisionCheck(this, other, transformA, anchorA, transformB, anchorB);
  }

  containsPoint(): boolean {
    return false;
  }

  resize(): void {}

  getCollisionNormal(
    other: CollisionShape,
    transformA: Transform,
    anchorA: CollisionAnchor,
    transformB: Transform,
    anchorB: CollisionAnchor,
  ): Vector2D | null {
    if (this.handlesRectangles && other instanceof RectangleCollisionShape) {
      return new Vector2D(2, 0);
    }
    return delegateCollisionMtv(this, other, transformA, anchorA, transformB, anchorB);
  }
}

describe("collision shapes", () => {
  test("RectangleCollisionShape AABB with center anchor offsets by half size", () => {
    const rect = new RectangleCollisionShape(10, 20);
    expect(rect.getAABB(tx(5, 8), "center")).toEqual({
      x: 0,
      y: -2,
      width: 10,
      height: 20,
    });
  });

  test("RectangleCollisionShape collisions and MTV work", () => {
    const a = new RectangleCollisionShape(10, 10);
    const b = new RectangleCollisionShape(10, 10);

    const colliding = a.isCollidingWith(b, tx(0, 0), "top-left", tx(8, 0), "top-left");
    expect(colliding).toBe(true);

    const mtv = a.getCollisionNormal(b, tx(0, 0), "top-left", tx(8, 0), "top-left");
    expect(mtv).not.toBeNull();
    expect(mtv?.x).toBeLessThan(0);
    expect(mtv?.y).toBe(0);
  });

  test("RectangleCollisionShape containsPoint honors rotation", () => {
    const rect = new RectangleCollisionShape(10, 4);
    const inside = rect.containsPoint(new Vector2D(0, 2), tx(0, 0, Math.PI / 2), "top-left");
    const outside = rect.containsPoint(new Vector2D(10, 10), tx(0, 0, Math.PI / 2), "top-left");

    expect(inside).toBe(true);
    expect(outside).toBe(false);
  });

  test("rotated rectangle AABBs enclose every transformed corner for both anchors", () => {
    const rect = new RectangleCollisionShape(10, 4);
    const transform = tx(20, -5, 0.73, 1.5);

    for (const anchor of ["center", "top-left"] as const) {
      const bounds = rect.getAABB(transform, anchor);
      const w = rect.width * transform.scale;
      const h = rect.height * transform.scale;
      const left = anchor === "center" ? -w / 2 : 0;
      const top = anchor === "center" ? -h / 2 : 0;
      for (const [x, y] of [
        [left, top],
        [left + w, top],
        [left + w, top + h],
        [left, top + h],
      ]) {
        const worldX =
          transform.position.x +
          x! * Math.cos(transform.rotation) -
          y! * Math.sin(transform.rotation);
        const worldY =
          transform.position.y +
          x! * Math.sin(transform.rotation) +
          y! * Math.cos(transform.rotation);
        expect(worldX).toBeGreaterThanOrEqual(bounds.x - 1e-10);
        expect(worldX).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-10);
        expect(worldY).toBeGreaterThanOrEqual(bounds.y - 1e-10);
        expect(worldY).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-10);
      }
    }
  });

  test("rectangle AABB varies continuously around zero rotation", () => {
    const rect = new RectangleCollisionShape(10, 4);
    for (const anchor of ["center", "top-left"] as const) {
      const zero = rect.getAABB(tx(3, 7, 0), anchor);
      const tiny = rect.getAABB(tx(3, 7, 1e-10), anchor);
      expect(Math.abs(tiny.x - zero.x)).toBeLessThan(1e-8);
      expect(Math.abs(tiny.y - zero.y)).toBeLessThan(1e-8);
    }
  });

  test("CurveCollisionShape collides with rectangles and rejects resize", () => {
    const curve = new CurveCollisionShape((x) => 10 + x * 0.1);
    const rect = new RectangleCollisionShape(10, 6);

    const hit = curve.isCollidingWith(rect, tx(0, 0), "top-left", tx(0, 6), "top-left");
    const miss = curve.isCollidingWith(rect, tx(0, 0), "top-left", tx(0, -30), "top-left");

    expect(hit).toBe(true);
    expect(miss).toBe(false);
    expect(() => curve.resize(1)).toThrow("does not support resizing");
  });

  test("CircleCollisionShape getCollisionNormal returns MTV for circle-circle", () => {
    const circle = new CircleCollisionShape(5);
    const other = new CircleCollisionShape(3);

    const mtv = circle.getCollisionNormal(other, tx(0, 0), "center", tx(6, 0), "center");
    expect(mtv).not.toBeNull();
    expect(mtv?.x).toBeLessThan(0);
    expect(mtv?.y).toBe(0);
  });

  test("CircleCollisionShape center-anchor contains its center point", () => {
    const circle = new CircleCollisionShape(10);
    const contains = circle.containsPoint(new Vector2D(100, 100), tx(100, 100), "center");
    expect(contains).toBe(true);
  });

  test("CircleCollisionShape circle-circle collision respects each scale", () => {
    const a = new CircleCollisionShape(5);
    const b = new CircleCollisionShape(5);

    const colliding = a.isCollidingWith(b, tx(0, 0, 0, 1), "center", tx(17, 0, 0, 3), "center");
    expect(colliding).toBe(true);
  });

  test("CircleCollisionShape and RectangleCollisionShape normals are available for both sides", () => {
    const circle = new CircleCollisionShape(6);
    const rect = new RectangleCollisionShape(12, 12);

    const circleMtv = circle.getCollisionNormal(rect, tx(0, 0), "center", tx(8, 0), "center");
    const rectMtv = rect.getCollisionNormal(circle, tx(8, 0), "center", tx(0, 0), "center");

    expect(circleMtv).not.toBeNull();
    expect(rectMtv).not.toBeNull();
    expect(circleMtv?.x).toBeCloseTo(-(rectMtv?.x ?? 0), 5);
    expect(circleMtv?.y).toBeCloseTo(-(rectMtv?.y ?? 0), 5);
  });

  test("CurveCollisionShape supports circle collision and normal", () => {
    const curve = new CurveCollisionShape(() => 10);
    const circle = new CircleCollisionShape(4);

    const hit = curve.isCollidingWith(circle, tx(0, 0), "top-left", tx(2, 8), "center");
    expect(hit).toBe(true);

    const mtv = curve.getCollisionNormal(circle, tx(0, 0), "top-left", tx(2, 8), "center");
    expect(mtv).not.toBeNull();
    expect(mtv?.x).toBe(0);
    expect(mtv?.y).toBeGreaterThan(0);
  });

  test("curve collisions and MTVs are translated and symmetric for circles and rectangles", () => {
    const curve = new CurveCollisionShape((x) => 10 + x * 0.5, 30);
    const curveTransform = tx(100, 50);
    const shapes = [
      { shape: new CircleCollisionShape(4), transform: tx(106, 60), anchor: "center" as const },
      {
        shape: new RectangleCollisionShape(8, 6),
        transform: tx(106, 60),
        anchor: "center" as const,
      },
    ];

    for (const item of shapes) {
      expect(
        curve.isCollidingWith(item.shape, curveTransform, "top-left", item.transform, item.anchor),
      ).toBe(true);
      expect(
        item.shape.isCollidingWith(curve, item.transform, item.anchor, curveTransform, "top-left"),
      ).toBe(true);
      const curveMtv = curve.getCollisionNormal(
        item.shape,
        curveTransform,
        "top-left",
        item.transform,
        item.anchor,
      );
      const shapeMtv = item.shape.getCollisionNormal(
        curve,
        item.transform,
        item.anchor,
        curveTransform,
        "top-left",
      );
      expect(curveMtv).not.toBeNull();
      expect(shapeMtv?.x).toBeCloseTo(-(curveMtv?.x ?? 0), 8);
      expect(shapeMtv?.y).toBeCloseTo(-(curveMtv?.y ?? 0), 8);
    }
  });

  test("curve detection and MTV use the same samples across a rectangle", () => {
    const curve = new CurveCollisionShape((x) => (x - 5) ** 2, 10);
    const rect = new RectangleCollisionShape(10, 5);
    const curveTransform = tx(20, 30);
    const rectTransform = tx(20, 30, 0, 1);

    expect(curve.isCollidingWith(rect, curveTransform, "top-left", rectTransform, "top-left")).toBe(
      true,
    );
    expect(
      curve.getCollisionNormal(rect, curveTransform, "top-left", rectTransform, "top-left")?.y,
    ).toBeCloseTo(5);
  });

  test("curve AABB includes negative peaks and finite depth", () => {
    const curve = new CurveCollisionShape((x) => -20 + (x - 5) ** 2, 10, {
      depth: 20,
      surfaceBounds: { min: -20, max: 5 },
    });

    expect(curve.getAABB(tx(100, 50), "top-left")).toEqual({
      x: 100,
      y: 30,
      width: 10,
      height: 45,
    });
    expect(curve.containsPoint(new Vector2D(105, 31), tx(100, 50), "top-left")).toBe(true);
    expect(curve.containsPoint(new Vector2D(105, 51), tx(100, 50), "top-left")).toBe(false);
  });

  test("curve direct collision agrees with broadphase for negative translated surfaces", () => {
    const curveEntity = new CollisionEntity(
      new CurveCollisionShape((x) => -20 + (x - 5) ** 2, 10, {
        depth: 20,
        surfaceBounds: { min: -20, max: 5 },
      }),
      "top-left",
    );
    const rectangleEntity = new CollisionEntity(new RectangleCollisionShape(2, 10), "center");
    curveEntity.awake();
    rectangleEntity.awake();
    curveEntity.getComponent(TransformComponent).setPosition(100, 50);
    rectangleEntity.getComponent(TransformComponent).setPosition(105, 35);

    expect(curveEntity.isColliding(rectangleEntity)).toBe(true);
    expect(new SpatialHashBroadphase(16).queryPairs([curveEntity, rectangleEntity])).toEqual([
      [curveEntity, rectangleEntity],
    ]);

    rectangleEntity.getComponent(TransformComponent).setPosition(105, 90);
    expect(curveEntity.isColliding(rectangleEntity)).toBe(false);
    expect(new SpatialHashBroadphase(16).queryPairs([curveEntity, rectangleEntity])).toHaveLength(
      0,
    );
  });

  test("configured curve samples detect adversarial narrow features without clamping", () => {
    const narrowFeature = (x: number): number => (Math.abs(x - 5) < 0.01 ? -10 : 10);
    const coarseCollision = new CurveCollisionShape(narrowFeature, 10, {
      depth: 20,
      boundsSamples: 1,
      collisionSamples: 1,
    });
    const fineCollision = new CurveCollisionShape(narrowFeature, 10, {
      depth: 20,
      boundsSamples: 1,
      collisionSamples: 2,
    });
    const fineBounds = new CurveCollisionShape(narrowFeature, 10, {
      depth: 20,
      boundsSamples: 2,
      collisionSamples: 2,
    });
    const rectangle = new RectangleCollisionShape(2, 2);
    const rectangleTransform = tx(4, -9);

    expect(
      coarseCollision.isCollidingWith(
        rectangle,
        tx(0, 0),
        "top-left",
        rectangleTransform,
        "top-left",
      ),
    ).toBe(false);
    expect(
      fineCollision.isCollidingWith(
        rectangle,
        tx(0, 0),
        "top-left",
        rectangleTransform,
        "top-left",
      ),
    ).toBe(true);
    expect(fineCollision.getAABB(tx(0, 0), "top-left").y).toBe(10);
    expect(fineBounds.getAABB(tx(0, 0), "top-left").y).toBe(-10);
  });

  test("explicit curve bounds restore conservative broadphase for narrow features", () => {
    const narrowFeature = (x: number): number => (Math.abs(x - 5) < 0.01 ? -10 : 10);
    const approximateCurve = new CollisionEntity(
      new CurveCollisionShape(narrowFeature, 10, {
        depth: 20,
        boundsSamples: 1,
        collisionSamples: 2,
      }),
      "top-left",
    );
    const boundedCurve = new CollisionEntity(
      new CurveCollisionShape(narrowFeature, 10, {
        depth: 20,
        surfaceBounds: { min: -10, max: 10 },
        requireSurfaceBounds: true,
        collisionSamples: 2,
      }),
      "top-left",
    );
    const rectangle = new CollisionEntity(new RectangleCollisionShape(2, 2), "top-left");
    approximateCurve.awake();
    boundedCurve.awake();
    rectangle.awake();
    rectangle.getComponent(TransformComponent).setPosition(4, -9);

    expect(approximateCurve.isColliding(rectangle)).toBe(true);
    expect(new SpatialHashBroadphase(16).queryPairs([approximateCurve, rectangle])).toHaveLength(0);
    expect(boundedCurve.isColliding(rectangle)).toBe(true);
    expect(new SpatialHashBroadphase(16).queryPairs([boundedCurve, rectangle])).toEqual([
      [boundedCurve, rectangle],
    ]);
  });

  test("guarded double dispatch is symmetric for built-in and custom shapes", () => {
    const rectangle = new RectangleCollisionShape(1, 1);
    const custom = new DelegatingTestShape(true);
    const transform = tx(0, 0);

    expect(rectangle.isCollidingWith(custom, transform, "center", transform, "center")).toBe(true);
    expect(custom.isCollidingWith(rectangle, transform, "center", transform, "center")).toBe(true);

    const rectangleMtv = rectangle.getCollisionNormal(
      custom,
      transform,
      "center",
      transform,
      "center",
    );
    const customMtv = custom.getCollisionNormal(
      rectangle,
      transform,
      "center",
      transform,
      "center",
    );
    expect(rectangleMtv).toEqual(new Vector2D(-2, 0));
    expect(customMtv).toEqual(new Vector2D(2, 0));
  });

  test("two unsupported delegating custom shapes terminate", () => {
    const a = new DelegatingTestShape();
    const b = new DelegatingTestShape();
    const transform = tx(0, 0);

    expect(a.isCollidingWith(b, transform, "center", transform, "center")).toBe(false);
    expect(b.isCollidingWith(a, transform, "center", transform, "center")).toBe(false);
    expect(a.getCollisionNormal(b, transform, "center", transform, "center")).toBeNull();
    expect(b.getCollisionNormal(a, transform, "center", transform, "center")).toBeNull();
  });

  test("collision dimensions, resize values, and broadphase cell sizes must be positive and finite", () => {
    expect(() => new RectangleCollisionShape(0, 1)).toThrow();
    expect(() => new CircleCollisionShape(Number.NaN)).toThrow();
    expect(() => new CurveCollisionShape(() => 0, -1)).toThrow();
    expect(() => new CurveCollisionShape(() => 0, 1, { depth: 0 })).toThrow("depth");
    expect(
      () =>
        new CurveCollisionShape(() => 0, 1, {
          surfaceBounds: { min: 1, max: -1 },
        }),
    ).toThrow("surfaceBounds");
    expect(() => new CurveCollisionShape(() => 0, 1, { requireSurfaceBounds: true })).toThrow(
      "surfaceBounds",
    );
    expect(() => new CurveCollisionShape(() => 0, 1, { collisionSamples: 0 })).toThrow(
      "collisionSamples",
    );
    expect(() => new RectangleCollisionShape(1, 1).resize(-1, 2)).toThrow();
    expect(() => new CircleCollisionShape(1).resize(0)).toThrow();
    expect(() => new SpatialHashBroadphase(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => new RectangleCollisionShape(1, 1).getAABB(tx(NaN, 0), "center")).toThrow("finite");
    expect(() => new CircleCollisionShape(1).getAABB(tx(0, 0, Infinity), "center")).toThrow(
      "finite",
    );
    expect(() =>
      new CurveCollisionShape(() => 0).containsPoint(new Vector2D(0, 0), tx(0, 0, 0, 2), "center"),
    ).toThrow("scaling");
  });
});

describe("CollisionEntity", () => {
  test("awake adds transform and collision shape components", () => {
    const e = new CollisionEntity(new RectangleCollisionShape(10, 20));
    e.awake();

    expect(e.hasComponent(TransformComponent)).toBe(true);
    expect(e.bbox()).toEqual({ x: -5, y: -10, width: 10, height: 20 });
  });

  test("isColliding / containsPoint / resize work", () => {
    const a = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left");
    const b = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left");

    a.awake();
    b.awake();

    a.getComponent(TransformComponent).setPosition(0, 0);
    b.getComponent(TransformComponent).setPosition(9, 0);

    expect(a.isColliding(b)).toBe(true);
    expect(a.containsPoint(new Vector2D(3, 3))).toBe(true);

    a.resize(4, 4);
    expect(a.bbox().width).toBe(4);
  });

  test("anchor point can be changed at runtime", () => {
    const e = new CollisionEntity(new RectangleCollisionShape(10, 10), "center");
    e.awake();

    e.setAnchorPoint("top-left");
    expect(e.getAnchorPoint()).toBe("top-left");
  });

  test("layer/mask filtering blocks collisions when masks do not match", () => {
    const a = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left", 0b0001, 0b0010);
    const b = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left", 0b0100, 0b0001);

    a.awake();
    b.awake();
    a.getComponent(TransformComponent).setPosition(0, 0);
    b.getComponent(TransformComponent).setPosition(0, 0);

    expect(a.canCollideWith(b)).toBe(false);
    expect(a.isColliding(b)).toBe(false);
    expect(a.getCollisionNormal(b)).toBeNull();
  });

  test("SpatialHashBroadphase returns unique overlapping pairs with mask filtering", () => {
    const a = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left", 0b0001, 0b1111);
    const b = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left", 0b0010, 0b1111);
    const c = new CollisionEntity(new RectangleCollisionShape(10, 10), "top-left", 0b0100, 0b0000);

    a.awake();
    b.awake();
    c.awake();

    a.getComponent(TransformComponent).setPosition(0, 0);
    b.getComponent(TransformComponent).setPosition(8, 0);
    c.getComponent(TransformComponent).setPosition(8, 0);

    const broadphase = new SpatialHashBroadphase(16);
    const pairs = broadphase.queryPairs([a, b, c]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.includes(a)).toBe(true);
    expect(pairs[0]?.includes(b)).toBe(true);
  });
});
