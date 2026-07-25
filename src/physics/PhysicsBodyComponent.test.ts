import { describe, expect, test } from "bun:test";
import { PhysicsBodyComponent } from "./PhysicsBodyComponent.ts";
import { PhysicsBodyType } from "./PhysicsBodyType.ts";
import { Vector2D } from "../math/Vector2D.ts";

describe("PhysicsBodyComponent", () => {
  test("dynamic body derives inverse mass", () => {
    const body = new PhysicsBodyComponent({ mass: 2 });
    expect(body.type).toBe(PhysicsBodyType.Dynamic);
    expect(body.invMass).toBeCloseTo(0.5, 8);
  });

  test("static and kinematic bodies have infinite effective mass", () => {
    const staticBody = new PhysicsBodyComponent({ type: PhysicsBodyType.Static, mass: 10 });
    const kinematicBody = new PhysicsBodyComponent({ type: PhysicsBodyType.Kinematic, mass: 10 });

    expect(staticBody.invMass).toBe(0);
    expect(kinematicBody.invMass).toBe(0);
  });

  test("addForce/applyImpulse are no-ops for non-dynamic bodies", () => {
    const body = new PhysicsBodyComponent({ type: PhysicsBodyType.Kinematic });
    body.addForce(new Vector2D(10, 0));
    body.applyImpulse(new Vector2D(10, 0));
    expect(body.getVelocity().x).toBe(0);
    expect(body.consumeForces().x).toBe(0);
  });

  test("impulses wake sleeping dynamic body", () => {
    const body = new PhysicsBodyComponent({ canSleep: true });
    body.sleep();
    expect(body.isSleeping).toBe(true);

    body.applyImpulse(new Vector2D(2, 0));
    expect(body.isSleeping).toBe(false);
    expect(body.getVelocity().x).toBeGreaterThan(0);
  });

  test("setBodyType clears sleeping state and disables sleeping for non-dynamic", () => {
    const body = new PhysicsBodyComponent({ canSleep: true });
    body.sleep();
    body.setBodyType(PhysicsBodyType.Static);

    expect(body.isSleeping).toBe(false);
    expect(body.canSleep).toBe(false);
  });

  test("getVelocity does not expose mutable internal state", () => {
    const body = new PhysicsBodyComponent();
    body.setVelocity(new Vector2D(3, 4));
    body.getVelocity().set(100, 100);

    expect(body.getVelocity()).toEqual(new Vector2D(3, 4));
  });

  test("rejects invalid mass and non-finite vectors", () => {
    expect(() => new PhysicsBodyComponent({ mass: 0 })).toThrow("mass");
    expect(() => new PhysicsBodyComponent().setMass(Number.NaN)).toThrow("mass");
    expect(() => new PhysicsBodyComponent().setVelocity(new Vector2D(Infinity, 0))).toThrow(
      "Velocity.x",
    );
  });
});
