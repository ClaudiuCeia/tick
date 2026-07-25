import { describe, test, expect, beforeEach } from "bun:test";
import { Entity } from "../ecs/Entity.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { TransformComponent } from "./TransformComponent.ts";
import { Vector2D } from "../math/Vector2D.ts";

class Node extends Entity {}

beforeEach(() => {
  EcsRuntime.reset();
});

describe("TransformComponent", () => {
  test("globalTransform applies parent rotation and scale to local position", () => {
    const parent = new Node();
    const child = new Node();

    const parentTx = new TransformComponent({
      position: new Vector2D(10, 20),
      rotation: Math.PI / 2,
      scale: 2,
    });
    const childTx = new TransformComponent({
      position: new Vector2D(3, 0),
      rotation: 0.25,
      scale: 4,
    });

    parent.addComponent(parentTx);
    child.addComponent(childTx);
    parent.addChild(child);
    parent.awake();

    const global = childTx.globalTransform;
    expect(global.position.x).toBeCloseTo(10);
    expect(global.position.y).toBeCloseTo(26);
    expect(global.rotation).toBeCloseTo(Math.PI / 2 + 0.25);
    expect(global.scale).toBeCloseTo(8);
  });

  test("awake auto-wires parent transform from entity parent", () => {
    const parent = new Node();
    const child = new Node();

    const parentTx = new TransformComponent();
    const childTx = new TransformComponent();

    parent.addComponent(parentTx);
    child.addComponent(childTx);
    parent.addChild(child);

    parent.awake();

    expect(childTx.parent).toBe(parentTx);
  });

  test("setPosition overloads update coordinates", () => {
    const tx = new TransformComponent();

    tx.setPosition(3, 4);
    expect(tx.transform.position.x).toBe(3);
    expect(tx.transform.position.y).toBe(4);

    tx.setPosition(new Vector2D(7, 9));
    expect(tx.transform.position.x).toBe(7);
    expect(tx.transform.position.y).toBe(9);
  });

  test("setPosition(number) without y throws", () => {
    const tx = new TransformComponent();
    expect(() => tx.setPosition(2 as unknown as Vector2D)).toThrow();
  });

  test("chainable mutators return this and update transform", () => {
    const tx = new TransformComponent();

    const out = tx.translate(5, -2).rotate(0.5).scaleBy(3).setRotation(1.5).setScale(2);

    expect(out).toBe(tx);
    expect(tx.transform.position.x).toBe(5);
    expect(tx.transform.position.y).toBe(-2);
    expect(tx.transform.rotation).toBe(1.5);
    expect(tx.transform.scale).toBe(2);
  });

  test("anchorTo(entity) and unanchor work", () => {
    const parent = new Node();
    const child = new Node();
    const parentTx = new TransformComponent();
    const childTx = new TransformComponent();

    parent.addComponent(parentTx);
    child.addComponent(childTx);

    childTx.anchorTo(parent);
    expect(childTx.parent).toBe(parentTx);

    childTx.unanchor();
    expect(childTx.parent).toBeNull();
  });

  test("anchorTo(entity) throws if entity has no TransformComponent", () => {
    const parent = new Node();
    const childTx = new TransformComponent();

    expect(() => childTx.anchorTo(parent)).toThrow("Entity does not have a TransformComponent");
  });

  test("globalTransform always returns an independent snapshot", () => {
    const tx = new TransformComponent({
      position: new Vector2D(3, 4),
      rotation: 0.5,
      scale: 2,
    });

    const snapshot = tx.globalTransform;
    snapshot.position.set(100, 100);
    snapshot.rotation = 10;
    snapshot.scale = 10;

    expect(tx.globalTransform.position).toEqual(new Vector2D(3, 4));
    expect(tx.globalTransform.rotation).toBe(0.5);
    expect(tx.globalTransform.scale).toBe(2);
  });

  test("anchorTo rejects direct and indirect cycles", () => {
    const a = new TransformComponent();
    const b = new TransformComponent();
    const c = new TransformComponent();
    b.anchorTo(a);
    c.anchorTo(b);

    expect(() => a.anchorTo(a)).toThrow("cycle");
    expect(() => a.anchorTo(c)).toThrow("cycle");
    expect(() => {
      a.parent = c;
    }).toThrow("cycle");
  });

  test("translateWorld converts displacement through parent rotation and scale", () => {
    const parent = new TransformComponent({
      position: Vector2D.zero,
      rotation: Math.PI / 2,
      scale: 2,
    });
    const child = new TransformComponent();
    child.anchorTo(parent).translateWorld(10, 0);

    expect(child.globalTransform.position.x).toBeCloseTo(10);
    expect(child.globalTransform.position.y).toBeCloseTo(0);
  });

  test("rejects invalid scales", () => {
    expect(
      () => new TransformComponent({ position: Vector2D.zero, rotation: 0, scale: 0 }),
    ).toThrow("scale");
    expect(() => new TransformComponent().setScale(Number.NaN)).toThrow("scale");
    expect(() => new TransformComponent().scaleBy(-1)).toThrow("scale");
  });

  test("rejects non-finite positions and rotations at mutation and snapshot boundaries", () => {
    expect(
      () =>
        new TransformComponent({
          position: new Vector2D(Number.NaN, 0),
          rotation: 0,
          scale: 1,
        }),
    ).toThrow("position.x");
    expect(() => new TransformComponent().setPosition(Infinity, 0)).toThrow("position.x");
    expect(() => new TransformComponent().setRotation(Number.NaN)).toThrow("rotation");

    const transform = new TransformComponent();
    transform.transform.position.x = Number.NaN;
    expect(() => transform.globalTransform).toThrow("position.x");
  });
});
