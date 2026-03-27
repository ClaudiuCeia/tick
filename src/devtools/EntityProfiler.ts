import { CollisionEntity } from "../collision/CollisionEntity.ts";
import { Component } from "../ecs/Component.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { Entity } from "../ecs/Entity.ts";
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

export class EntityProfiler {
  private static isRunning = false;
  private static isHooked = false;
  private static records: Map<unknown, ProfileRecord> = new Map();

  public static start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.hook();
    console.log("%c[Profiler] Started.", "color: lime");
  }

  public static stop(): void {
    this.isRunning = false;
    console.log("%c[Profiler] Stopped.", "color: orangered");
  }

  public static clear(): void {
    this.records.clear();
  }

  public static isActive(): boolean {
    return this.isRunning;
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

    const patch = (proto: object, method: string, kind: ProfileKind, isEntity: boolean) => {
      const original = (proto as Record<string, unknown>)[method] as (...args: unknown[]) => unknown;
      (proto as Record<string, unknown>)[method] = function (this: unknown, ...args: unknown[]) {
        const start = performance.now();
        const result = original.apply(this, args);
        EntityProfiler.record(
          (this as { constructor: unknown }).constructor,
          isEntity ? "entity" : "component",
          kind,
          performance.now() - start,
          this instanceof Entity ? this : undefined,
        );
        return result;
      };
    };

    patch(Entity.prototype, "awake", "awake", true);
    patch(Entity.prototype, "update", "update", true);
    patch(Entity.prototype, "destroy", "destroy", true);

    patch(Component.prototype, "awake", "awake", false);
    patch(Component.prototype, "update", "update", false);
    patch(Component.prototype, "destroy", "destroy", false);

    patch(RenderComponent.prototype, "awake", "awake", false);
    patch(RenderComponent.prototype, "update", "update", false);
    patch(RenderComponent.prototype, "render", "render", false);
    patch(RenderComponent.prototype, "destroy", "destroy", false);
    this.isHooked = true;
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
