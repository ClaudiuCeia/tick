import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import {
  SystemPhase,
  SystemTickMode,
  type IWorld,
  type System,
  type SystemUpdateContext,
} from "./System.ts";

type WorldSystemEntry = {
  system: System;
  phase: SystemPhase;
  tickMode: SystemTickMode;
  insertionOrder: number;
};

export type WorldOptions = {
  runtime?: EcsRuntime;
  fixedDeltaTime?: number;
  maxSubSteps?: number;
  maxFrameDelta?: number;
};

export type WorldStepResult = {
  fixedSteps: number;
  alpha: number;
};

export class World implements IWorld {
  private readonly runtime: EcsRuntime;
  private readonly maxSubSteps: number;
  private readonly maxFrameDelta: number;
  private accumulator = 0;
  private systems: WorldSystemEntry[] = [];
  private nextInsertionOrder = 0;
  private isClearingSystems = false;

  constructor(options: WorldOptions = {}) {
    this.runtime = options.runtime ?? EcsRuntime.getCurrent();
    this.fixedDeltaTime = World.positiveFinite("fixedDeltaTime", options.fixedDeltaTime ?? 1 / 60);
    this.maxSubSteps = World.positiveInteger("maxSubSteps", options.maxSubSteps ?? 8);
    this.maxFrameDelta = World.positiveFinite("maxFrameDelta", options.maxFrameDelta ?? 0.25);
  }

  public readonly fixedDeltaTime: number;

  public addSystem(system: System): this {
    if (this.isClearingSystems) {
      throw new Error("Cannot add a system while clearSystems is running");
    }
    if (this.systems.some((entry) => entry.system === system)) {
      throw new Error("Cannot add the same system to a world more than once");
    }

    const entry: WorldSystemEntry = {
      system,
      phase: system.phase ?? SystemPhase.Simulation,
      tickMode: system.tickMode ?? SystemTickMode.Fixed,
      insertionOrder: this.nextInsertionOrder++,
    };

    this.systems.push(entry);
    this.sortSystems();

    try {
      this.runWithRuntime(() => {
        system.awake?.(this);
      });
    } catch (error) {
      try {
        this.runWithRuntime(() => {
          system.destroy?.(this);
        });
      } catch {}
      const index = this.systems.indexOf(entry);
      if (index !== -1) this.systems.splice(index, 1);
      throw error;
    }

    return this;
  }

  public removeSystem(system: System): boolean {
    const index = this.systems.findIndex((entry) => entry.system === system);
    if (index === -1) return false;

    const [entry] = this.systems.splice(index, 1);
    this.runWithRuntime(() => {
      entry?.system.destroy?.(this);
    });
    return true;
  }

  public clearSystems(): void {
    if (this.isClearingSystems) {
      throw new Error("clearSystems is already running");
    }

    const entries = [...this.systems];
    this.systems.length = 0;
    this.isClearingSystems = true;
    try {
      this.runWithRuntime(() => {
        let lifecycleError: unknown;
        for (const entry of entries) {
          try {
            entry.system.destroy?.(this);
          } catch (error) {
            lifecycleError ??= error;
          }
        }
        if (lifecycleError !== undefined) {
          throw lifecycleError;
        }
      });
    } finally {
      this.systems.length = 0;
      this.isClearingSystems = false;
    }
  }

  public step(deltaTime: number): WorldStepResult {
    if (!Number.isFinite(deltaTime)) {
      throw new RangeError("deltaTime must be finite");
    }
    const clamped = Math.max(0, Math.min(deltaTime, this.maxFrameDelta));

    this.runFrameSystems(clamped, (entry) => entry.phase <= SystemPhase.Input, 0);

    this.accumulator += clamped;
    let fixedSteps = 0;
    while (this.accumulator >= this.fixedDeltaTime && fixedSteps < this.maxSubSteps) {
      this.runFixedSystems(this.fixedDeltaTime, fixedSteps);
      this.accumulator -= this.fixedDeltaTime;
      fixedSteps++;
    }

    // Drop whole pending ticks when the cap is reached, retaining only interpolation remainder.
    if (this.accumulator >= this.fixedDeltaTime) {
      this.accumulator %= this.fixedDeltaTime;
    }

    const alpha = Math.min(this.accumulator / this.fixedDeltaTime, 1 - Number.EPSILON);
    this.runFrameSystems(clamped, (entry) => entry.phase > SystemPhase.Input, alpha);

    return { fixedSteps, alpha };
  }

  public resetTime(): void {
    this.accumulator = 0;
  }

  private runFixedSystems(deltaTime: number, fixedStepIndex: number): void {
    this.runWithRuntime(() => {
      for (const entry of this.systems.slice()) {
        if (!this.systems.includes(entry)) continue;
        if (entry.tickMode !== SystemTickMode.Fixed) continue;
        const context: SystemUpdateContext = {
          tickMode: SystemTickMode.Fixed,
          alpha: 0,
          fixedStepIndex,
        };
        entry.system.update?.(deltaTime, this, context);
      }
    });
  }

  private runFrameSystems(
    deltaTime: number,
    predicate: (entry: WorldSystemEntry) => boolean,
    alpha: number,
  ): void {
    this.runWithRuntime(() => {
      for (const entry of this.systems.slice()) {
        if (!this.systems.includes(entry)) continue;
        if (entry.tickMode !== SystemTickMode.Frame) continue;
        if (!predicate(entry)) continue;
        const context: SystemUpdateContext = {
          tickMode: SystemTickMode.Frame,
          alpha,
          fixedStepIndex: 0,
        };
        entry.system.update?.(deltaTime, this, context);
      }
    });
  }

  private runWithRuntime<T>(fn: () => T): T {
    return EcsRuntime.runWith(this.runtime, fn);
  }

  private sortSystems(): void {
    this.systems.sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      return a.insertionOrder - b.insertionOrder;
    });
  }

  private static positiveFinite(name: string, value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a finite number greater than 0`);
    }
    return value;
  }

  private static positiveInteger(name: string, value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive integer`);
    }
    return value;
  }
}
