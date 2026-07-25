import { describe, test, expect } from "bun:test";
import { Vector2D } from "./Vector2D.ts";

describe("Vector2D — construction", () => {
  test("stores x and y", () => {
    const v = new Vector2D(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  test("zero has x=0 y=0", () => {
    const z = Vector2D.zero;
    expect(z.x).toBe(0);
    expect(z.y).toBe(0);
  });

  test("one has x=1 y=1", () => {
    const o = Vector2D.one;
    expect(o.x).toBe(1);
    expect(o.y).toBe(1);
  });
});

describe("Vector2D — arithmetic", () => {
  test("add", () => {
    const r = new Vector2D(1, 2).add(new Vector2D(3, 4));
    expect(r.x).toBe(4);
    expect(r.y).toBe(6);
  });

  test("subtract", () => {
    const r = new Vector2D(5, 7).subtract(new Vector2D(2, 3));
    expect(r.x).toBe(3);
    expect(r.y).toBe(4);
  });

  test("multiply by scalar", () => {
    const r = new Vector2D(2, 3).multiply(4);
    expect(r.x).toBe(8);
    expect(r.y).toBe(12);
  });

  test("multiply by vector (component-wise)", () => {
    const r = new Vector2D(2, 3).multiply(new Vector2D(4, 5));
    expect(r.x).toBe(8);
    expect(r.y).toBe(15);
  });

  test("divide by scalar", () => {
    const r = new Vector2D(10, 6).divide(2);
    expect(r.x).toBe(5);
    expect(r.y).toBe(3);
  });

  test("divide by vector", () => {
    const r = new Vector2D(10, 6).divide(new Vector2D(2, 3));
    expect(r.x).toBe(5);
    expect(r.y).toBe(2);
  });

  test("negate", () => {
    const r = new Vector2D(3, -5).negate();
    expect(r.x).toBe(-3);
    expect(r.y).toBe(5);
  });

  test("scale", () => {
    const r = new Vector2D(2, 4).scale(3);
    expect(r.x).toBe(6);
    expect(r.y).toBe(12);
  });
});

describe("Vector2D — dot product", () => {
  test("dot of perpendicular vectors is 0", () => {
    expect(new Vector2D(1, 0).dot(new Vector2D(0, 1))).toBe(0);
  });

  test("dot of parallel vectors equals product of magnitudes", () => {
    expect(new Vector2D(3, 0).dot(new Vector2D(5, 0))).toBe(15);
  });

  test("dot of antiparallel vectors is negative", () => {
    expect(new Vector2D(1, 0).dot(new Vector2D(-1, 0))).toBeLessThan(0);
  });
});

describe("Vector2D — magnitude & normalize", () => {
  test("magnitude of (3,4) is 5", () => {
    expect(new Vector2D(3, 4).magnitude).toBeCloseTo(5);
  });

  test("magnitude of zero vector is 0", () => {
    expect(new Vector2D(0, 0).magnitude).toBe(0);
  });

  test("normalize produces unit vector", () => {
    const n = new Vector2D(3, 4).normalize();
    expect(n.magnitude).toBeCloseTo(1);
  });

  test("normalize of zero returns zero vector", () => {
    const n = new Vector2D(0, 0).normalize();
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
  });
});

describe("Vector2D — lerp", () => {
  test("t=0 returns start", () => {
    const r = new Vector2D(0, 0).lerp(new Vector2D(10, 10), 0);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  test("t=1 returns end", () => {
    const r = new Vector2D(0, 0).lerp(new Vector2D(10, 20), 1);
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
  });

  test("t=0.5 returns midpoint", () => {
    const r = new Vector2D(0, 0).lerp(new Vector2D(10, 20), 0.5);
    expect(r.x).toBe(5);
    expect(r.y).toBe(10);
  });
});

describe("Vector2D — distanceTo & angleTo", () => {
  test("distanceTo self is 0", () => {
    const v = new Vector2D(3, 7);
    expect(v.distanceTo(v)).toBe(0);
  });

  test("distanceTo is symmetric", () => {
    const a = new Vector2D(0, 0);
    const b = new Vector2D(3, 4);
    expect(a.distanceTo(b)).toBeCloseTo(b.distanceTo(a));
  });

  test("distanceTo (0,0) → (3,4) is 5", () => {
    expect(new Vector2D(0, 0).distanceTo(new Vector2D(3, 4))).toBeCloseTo(5);
  });

  test("angleTo points from this vector toward the target", () => {
    const angle = new Vector2D(0, 0).angleTo(new Vector2D(1, 0));
    expect(angle).toBeCloseTo(0);
  });

  test("angleFrom preserves the legacy reverse direction explicitly", () => {
    expect(new Vector2D(0, 0).angleFrom(new Vector2D(1, 0))).toBeCloseTo(Math.PI);
  });
});

describe("Vector2D — clone & set", () => {
  test("clone produces independent copy", () => {
    const v = new Vector2D(1, 2);
    const c = v.clone();
    c.x = 99;
    expect(v.x).toBe(1);
  });

  test("set mutates in place", () => {
    const v = new Vector2D(1, 2);
    v.set(10, 20);
    expect(v.x).toBe(10);
    expect(v.y).toBe(20);
  });
});

describe("Vector2D — fromAngle", () => {
  test("fromAngle(0) points right", () => {
    const v = Vector2D.fromAngle(0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  test("fromAngle(π/2) points up", () => {
    const v = Vector2D.fromAngle(Math.PI / 2);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  test("fromAngle returns unit vector", () => {
    expect(Vector2D.fromAngle(1.23).magnitude).toBeCloseTo(1);
  });
});

describe("Vector2D — allocation", () => {
  test("arithmetic operations return new instances", () => {
    const a = new Vector2D(1, 2);
    const b = new Vector2D(3, 4);
    const r = a.add(b);
    expect(r).not.toBe(a);
    expect(r).not.toBe(b);
  });

  test("zero and one getters return new instances each call", () => {
    // These are getters that allocate — verify they return distinct objects
    expect(Vector2D.zero).not.toBe(Vector2D.zero);
    expect(Vector2D.one).not.toBe(Vector2D.one);
  });
});
