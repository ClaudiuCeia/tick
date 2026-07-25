import { describe, expect, test } from "bun:test";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Entity } from "../ecs/Entity.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";
import { SystemPhase, SystemTickMode } from "./System.ts";
import { World } from "./World.ts";

describe("World", () => {
  test("validates numeric options", () => {
    expect(() => new World({ fixedDeltaTime: 0 })).toThrow(/fixedDeltaTime/);
    expect(() => new World({ fixedDeltaTime: Number.NaN })).toThrow(/fixedDeltaTime/);
    expect(() => new World({ maxSubSteps: 1.5 })).toThrow(/maxSubSteps/);
    expect(() => new World({ maxSubSteps: 0 })).toThrow(/maxSubSteps/);
    expect(() => new World({ maxFrameDelta: 0 })).toThrow(/maxFrameDelta/);
    expect(() => new World({ maxFrameDelta: -1 })).toThrow(/maxFrameDelta/);
    expect(() => new World({ maxFrameDelta: Number.POSITIVE_INFINITY })).toThrow(/maxFrameDelta/);
  });

  test("runs fixed systems using fixed timestep and returns alpha", () => {
    const world = new World({ fixedDeltaTime: 0.02, maxSubSteps: 10 });
    const deltas: number[] = [];

    world.addSystem({
      tickMode: SystemTickMode.Fixed,
      phase: SystemPhase.Simulation,
      update(dt) {
        deltas.push(dt);
      },
    });

    const result = world.step(0.05);

    expect(deltas).toEqual([0.02, 0.02]);
    expect(result.fixedSteps).toBe(2);
    expect(result.alpha).toBeCloseTo(0.5, 5);
  });

  test("respects maxSubSteps limit", () => {
    const world = new World({ fixedDeltaTime: 0.01, maxSubSteps: 3 });
    let calls = 0;

    world.addSystem({
      tickMode: SystemTickMode.Fixed,
      update() {
        calls++;
      },
    });

    const result = world.step(1.0);
    expect(calls).toBe(3);
    expect(result.fixedSteps).toBe(3);
    expect(result.alpha).toBeGreaterThanOrEqual(0);
    expect(result.alpha).toBeLessThan(1);
    expect(world.step(0).fixedSteps).toBe(0);
  });

  test("rejects duplicate system instances without awakening twice", () => {
    const world = new World();
    let awakeCalls = 0;
    const system = { awake: () => awakeCalls++ };

    world.addSystem(system);
    expect(() => world.addSystem(system)).toThrow(/same system/i);
    expect(awakeCalls).toBe(1);
  });

  test("failed system awake runs best-effort destroy and removes the system", () => {
    const world = new World();
    let destroyCalls = 0;
    let updateCalls = 0;
    const system = {
      awake() {
        throw new Error("system awake failed");
      },
      update() {
        updateCalls++;
      },
      destroy() {
        destroyCalls++;
        throw new Error("system destroy failed");
      },
    };

    expect(() => world.addSystem(system)).toThrow("system awake failed");
    expect(destroyCalls).toBe(1);
    expect(world.removeSystem(system)).toBe(false);
    world.step(1 / 60);
    expect(updateCalls).toBe(0);
  });

  test("system mutations do not skip or prematurely run systems", () => {
    const world = new World({ fixedDeltaTime: 0.01 });
    const trace: string[] = [];
    let mutated = false;
    const added = {
      update() {
        trace.push("added");
      },
    };
    const removed = {
      update() {
        trace.push("removed");
      },
    };
    world.addSystem({
      update() {
        trace.push("mutator");
        if (!mutated) {
          mutated = true;
          world.removeSystem(removed);
          world.addSystem(added);
        }
      },
    });
    world.addSystem(removed);

    world.step(0.01);
    expect(trace).toEqual(["mutator"]);

    world.step(0.01);
    expect(trace).toEqual(["mutator", "mutator", "added"]);
  });

  test("clearSystems rejects systems re-added during destroy and finishes empty", () => {
    const world = new World({ fixedDeltaTime: 0.01 });
    let updateCalls = 0;
    let laterDestroyCalls = 0;
    const replacement = {
      update() {
        updateCalls++;
      },
    };
    world.addSystem({
      destroy() {
        world.addSystem(replacement);
      },
    });
    world.addSystem({
      destroy() {
        laterDestroyCalls++;
      },
    });

    expect(() => world.clearSystems()).toThrow(/clearSystems/);
    world.step(0.01);

    expect(laterDestroyCalls).toBe(1);
    expect(updateCalls).toBe(0);
    expect(world.removeSystem(replacement)).toBe(false);
  });

  test("runs frame input before fixed and render after fixed with stable ordering", () => {
    const world = new World({ fixedDeltaTime: 0.01, maxSubSteps: 10 });
    const trace: string[] = [];

    world.addSystem({
      tickMode: SystemTickMode.Frame,
      phase: SystemPhase.Input,
      update() {
        trace.push("input");
      },
    });

    world.addSystem({
      tickMode: SystemTickMode.Fixed,
      phase: SystemPhase.Simulation,
      update() {
        trace.push("sim-1");
      },
    });

    world.addSystem({
      tickMode: SystemTickMode.Fixed,
      phase: SystemPhase.Simulation,
      update() {
        trace.push("sim-2");
      },
    });

    world.addSystem({
      tickMode: SystemTickMode.Frame,
      phase: SystemPhase.Render,
      update(_dt, _world, ctx) {
        trace.push(`render:${ctx.alpha.toFixed(2)}`);
      },
    });

    world.step(0.025);

    expect(trace).toEqual(["input", "sim-1", "sim-2", "sim-1", "sim-2", "render:0.50"]);
  });

  test("invokes awake and destroy lifecycle", () => {
    const world = new World();
    let awakeCalls = 0;
    let destroyCalls = 0;

    const system = {
      awake() {
        awakeCalls++;
      },
      destroy() {
        destroyCalls++;
      },
    };

    world.addSystem(system);
    expect(awakeCalls).toBe(1);

    expect(world.removeSystem(system)).toBe(true);
    expect(destroyCalls).toBe(1);

    expect(world.removeSystem(system)).toBe(false);
  });

  test("scopes execution to the world's runtime", () => {
    class RuntimeEntity extends Entity {
      public override update(_dt: number): void {}
    }

    const runtimeA = new EcsRuntime(new EntityRegistry());
    const runtimeB = new EcsRuntime(new EntityRegistry());

    EcsRuntime.runWith(runtimeB, () => {
      const world = new World({ runtime: runtimeA });

      world.addSystem({
        tickMode: SystemTickMode.Fixed,
        update() {
          new RuntimeEntity();
        },
      });

      world.step(0.02);
    });

    expect(runtimeA.registry.getEntitiesByType(RuntimeEntity)).toHaveLength(1);
    expect(runtimeB.registry.getEntitiesByType(RuntimeEntity)).toHaveLength(0);
  });
});
