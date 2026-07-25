import { CollisionEntity } from "../collision/CollisionEntity.ts";
import { Component } from "../ecs/Component.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Entity } from "../ecs/Entity.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";
import { Vector2D } from "../math/Vector2D.ts";
import type { ICamera } from "../render/ICamera.ts";
import { RenderComponent } from "../render/RenderComponent.ts";

export type ProfileKind = "awake" | "update" | "render" | "destroy";
type ProfileData = { count: number; totalTime: number };
type ProfileRecord = {
  name: string;
  kind: "entity" | "component" | "renderComponent";
  samples: Record<ProfileKind, ProfileData>;
  entityRef?: Entity;
};

type MethodPatch = {
  target: Record<string, unknown>;
  method: string;
  originalDescriptor: PropertyDescriptor | undefined;
  wrapped: (...args: unknown[]) => unknown;
};

export type EntityProfilerChildSummary = {
  name: string;
  avg: number;
};

export type EntityProfilerEntry = {
  name: string;
  kind: "entity" | "component" | "renderComponent";
  avg: number;
  totalTime: number;
  count: number;
  children: EntityProfilerChildSummary[];
};

export type EntityProfilerReport = Record<ProfileKind, EntityProfilerEntry[]>;

/**
 * Removable lifecycle profiler for ECS entities and components.
 *
 * While active, entities created with prototype lifecycle overrides and components attached to an
 * entity are instrumented automatically. Entity lifecycle methods installed as class fields run
 * after `Entity` calls `super()`, replacing constructor-time instrumentation; call
 * `EntityProfiler.instrument(instance)` after construction for those entities.
 * `stop()` restores all active prototype, discovery, and instance wrappers.
 */
export class EntityProfiler {
  private static isRunning = false;
  private static isHooked = false;
  private static records: Map<unknown, ProfileRecord> = new Map();
  private static patches: MethodPatch[] = [];
  private static activeSamples = new WeakMap<object, Set<ProfileKind>>();

  public static start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.hook();
    this.instrumentRuntime();
    console.log("%c[Profiler] Started.", "color: lime");
  }

  public static stop(): void {
    if (!this.isRunning && !this.isHooked) return;
    this.isRunning = false;
    this.unhook();
    console.log("%c[Profiler] Stopped.", "color: orangered");
  }

  public static clear(): void {
    this.records.clear();
  }

  public static isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Instruments the lifecycle methods currently installed on an instance.
   * Use this after constructing an entity whose lifecycle methods are class fields.
   */
  public static instrument(instance: Entity | Component): void {
    if (!this.isRunning) return;

    if (instance instanceof Entity) {
      this.patchMethod(instance, "awake", "awake", "entity");
      this.patchMethod(instance, "update", "update", "entity");
      this.patchMethod(instance, "destroy", "destroy", "entity");
      return;
    }

    const kind = instance instanceof RenderComponent ? "renderComponent" : "component";
    this.patchMethod(instance, "awake", "awake", kind);
    this.patchMethod(instance, "update", "update", kind);
    this.patchMethod(instance, "destroy", "destroy", kind);
    if (instance instanceof RenderComponent) {
      this.patchMethod(instance, "render", "render", kind);
    }
  }

  /** Instruments all objects currently registered in a runtime. */
  public static instrumentRuntime(runtime: EcsRuntime = EcsRuntime.getCurrent()): void {
    if (!this.isRunning) return;
    for (const entity of runtime.registry.getAllEntities()) {
      this.instrument(entity);
      for (const component of entity.components) {
        this.instrument(component);
      }
    }
  }

  public static hasSamples(kind?: ProfileKind): boolean {
    if (!kind) {
      return Array.from(this.records.values()).some((record) =>
        Object.values(record.samples).some((sample) => sample.count > 0),
      );
    }

    return Array.from(this.records.values()).some((record) => record.samples[kind].count > 0);
  }

  public static getTopSlow(kind: ProfileKind, topN = 10): EntityProfilerEntry[] {
    return Array.from(this.records.values())
      .filter((record) => record.samples[kind].count > 0)
      .map((record) => ({
        name: record.name,
        kind: record.kind,
        avg: record.samples[kind].totalTime / record.samples[kind].count,
        totalTime: record.samples[kind].totalTime,
        count: record.samples[kind].count,
        children: record.entityRef ? this.getTopChildren(record.entityRef, kind) : [],
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, topN);
  }

  public static getReport(topN = 10): EntityProfilerReport {
    return {
      awake: this.getTopSlow("awake", topN),
      update: this.getTopSlow("update", topN),
      render: this.getTopSlow("render", topN),
      destroy: this.getTopSlow("destroy", topN),
    };
  }

  public static printTopSlow(kind: ProfileKind, topN = 10): void {
    const list = this.getTopSlow(kind, topN);

    console.group(`%c[Profiler] Top ${topN} slowest by ${kind}`, "color: gold");
    for (const entry of list) {
      console.log(
        `%c${entry.kind.toUpperCase()}: ${entry.name} | ${entry.avg.toFixed(3)} ms avg | ${entry.count} samples`,
        "color: cyan",
      );
      if (entry.children.length > 0) {
        console.group("  %cChildren:", "color: violet");
        for (const child of entry.children) {
          console.log(`  ${child.name}: ${child.avg.toFixed(3)}ms avg`);
        }
        console.groupEnd();
      }
    }
    console.groupEnd();
  }

  public static scanOffscreenCollision(camera: ICamera): void {
    console.group("%c[Profiler] Offscreen CollisionEntities:", "color: orange");
    const canvasSize = Vector2D.fromScreen();
    for (const entity of EcsRuntime.getCurrent().registry.getAllEntities()) {
      const colliders = entity.children.filter(
        (child) => child instanceof CollisionEntity,
      ) as CollisionEntity[];
      for (const collider of colliders) {
        const bbox = collider.bbox();
        const screenPos = camera.toCanvas(new Vector2D(bbox.x, bbox.y), canvasSize);
        if (
          screenPos.x + bbox.width < 0 ||
          screenPos.x > canvasSize.x ||
          screenPos.y + bbox.height < 0 ||
          screenPos.y > canvasSize.y
        ) {
          console.warn(`Offscreen collider in ${entity.constructor.name}`, bbox);
        }
      }
    }
    console.groupEnd();
  }

  private static getTopChildren(entity: Entity, kind: ProfileKind): EntityProfilerChildSummary[] {
    return entity.children
      .map((child) => ({
        name: child.constructor.name,
        record: this.records.get(child.constructor),
      }))
      .filter((child) => (child.record?.samples[kind].count ?? 0) > 0)
      .map((child) => ({
        name: child.name,
        avg: child.record!.samples[kind].totalTime / child.record!.samples[kind].count,
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);
  }

  private static hook(): void {
    if (this.isHooked) return;

    this.patchMethod(Entity.prototype, "awake", "awake", "entity");
    this.patchMethod(Entity.prototype, "update", "update", "entity");
    this.patchMethod(Entity.prototype, "destroy", "destroy", "entity");

    this.patchMethod(Component.prototype, "awake", "awake", "component");
    this.patchMethod(Component.prototype, "update", "update", "component");
    this.patchMethod(Component.prototype, "destroy", "destroy", "component");

    this.patchMethod(RenderComponent.prototype, "awake", "awake", "renderComponent");
    this.patchMethod(RenderComponent.prototype, "update", "update", "renderComponent");
    this.patchMethod(RenderComponent.prototype, "render", "render", "renderComponent");
    this.patchMethod(RenderComponent.prototype, "destroy", "destroy", "renderComponent");

    this.patchHook(EntityRegistry.prototype, "register", (original) => {
      return function (this: EntityRegistry, ...args: unknown[]): unknown {
        const result = original.apply(this, args);
        const entity = args[0];
        if (entity instanceof Entity) {
          EntityProfiler.instrument(entity);
        }
        return result;
      };
    });
    this.patchHook(Entity.prototype, "addComponent", (original) => {
      return function (this: Entity, ...args: unknown[]): unknown {
        const component = args[0];
        if (component instanceof Component) {
          EntityProfiler.instrument(component);
        }
        return original.apply(this, args);
      };
    });
    this.isHooked = true;
  }

  private static patchHook(
    targetObject: object,
    method: string,
    createWrapped: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
  ): void {
    const target = targetObject as Record<string, unknown>;
    if (this.hasCurrentPatch(target, method)) return;
    const original = target[method] as (...args: unknown[]) => unknown;
    if (typeof original !== "function") return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(target, method);
    const wrapped = createWrapped(original);
    target[method] = wrapped;
    this.patches.push({ target, method, originalDescriptor, wrapped });
  }

  private static patchMethod(
    targetObject: object,
    method: string,
    profileKind: ProfileKind,
    recordKind: ProfileRecord["kind"],
  ): void {
    const target = targetObject as Record<string, unknown>;
    if (this.hasCurrentPatch(target, method)) return;
    const original = target[method] as (...args: unknown[]) => unknown;
    if (typeof original !== "function") return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(target, method);
    const wrapped = function (this: object, ...args: unknown[]) {
      let active = EntityProfiler.activeSamples.get(this);
      if (!active) {
        active = new Set();
        EntityProfiler.activeSamples.set(this, active);
      }

      if (active.has(profileKind)) {
        return original.apply(this, args);
      }

      active.add(profileKind);
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        try {
          EntityProfiler.record(
            (this as { constructor: unknown }).constructor,
            recordKind,
            profileKind,
            performance.now() - start,
            this instanceof Entity ? this : undefined,
          );
        } finally {
          active.delete(profileKind);
        }
      }
    };
    target[method] = wrapped;
    EntityProfiler.patches.push({ target, method, originalDescriptor, wrapped });
  }

  private static hasCurrentPatch(target: Record<string, unknown>, method: string): boolean {
    const patchIndex = this.patches.findIndex(
      (patch) => patch.target === target && patch.method === method,
    );
    if (patchIndex === -1) return false;
    const patch = this.patches[patchIndex]!;
    if (target[method] === patch.wrapped) return true;

    // Class fields and deliberate runtime replacements supersede the old wrapper.
    this.patches.splice(patchIndex, 1);
    return false;
  }

  private static unhook(): void {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const patch = this.patches[i];
      if (!patch || patch.target[patch.method] !== patch.wrapped) continue;
      if (patch.originalDescriptor) {
        Object.defineProperty(patch.target, patch.method, patch.originalDescriptor);
      } else {
        delete patch.target[patch.method];
      }
    }
    this.patches = [];
    this.activeSamples = new WeakMap();
    this.isHooked = false;
  }

  private static record(
    ctor: unknown,
    kind: "entity" | "component" | "renderComponent",
    method: ProfileKind,
    deltaMs: number,
    instance?: Entity,
  ): void {
    if (!this.isRunning) {
      return;
    }

    let record = this.records.get(ctor);
    if (!record) {
      record = {
        name: (ctor as { name: string }).name,
        kind,
        samples: {
          awake: { count: 0, totalTime: 0 },
          update: { count: 0, totalTime: 0 },
          render: { count: 0, totalTime: 0 },
          destroy: { count: 0, totalTime: 0 },
        },
        entityRef: instance,
      };
      this.records.set(ctor, record);
    }

    const sample = record.samples[method];
    sample.count += 1;
    sample.totalTime += deltaMs;
  }
}
