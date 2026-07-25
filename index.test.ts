import { describe, test, expect } from "bun:test";
import * as rootApi from "./index.ts";
import * as srcApi from "./src/index.ts";
import type {
  AssetManifest,
  EntityProfilerChildSummary,
  EntityProfilerEntry,
  EntityProfilerReport,
  HudInputEventType,
  ICamera,
  ICanvas,
  LoadResult,
  PhysicsSystemOptions,
  ProfileKind,
  Snapshot,
  SpriteAlignX,
  SpriteAlignY,
  SpriteRenderOptions,
  FrameScheduler,
  WorldLoopOptions,
  WorldOptions,
} from "./index.ts";
import type {
  AssetManifest as SrcAssetManifest,
  EntityProfilerChildSummary as SrcEntityProfilerChildSummary,
  EntityProfilerEntry as SrcEntityProfilerEntry,
  EntityProfilerReport as SrcEntityProfilerReport,
  HudInputEventType as SrcHudInputEventType,
  ICamera as SrcICamera,
  ICanvas as SrcICanvas,
  LoadResult as SrcLoadResult,
  PhysicsSystemOptions as SrcPhysicsSystemOptions,
  ProfileKind as SrcProfileKind,
  Snapshot as SrcSnapshot,
  SpriteAlignX as SrcSpriteAlignX,
  SpriteAlignY as SrcSpriteAlignY,
  SpriteRenderOptions as SrcSpriteRenderOptions,
  FrameScheduler as SrcFrameScheduler,
  WorldLoopOptions as SrcWorldLoopOptions,
  WorldOptions as SrcWorldOptions,
} from "./src/index.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type PublicTypeContract = [
  Assert<Equal<EntityProfilerChildSummary, SrcEntityProfilerChildSummary>>,
  Assert<Equal<EntityProfilerEntry, SrcEntityProfilerEntry>>,
  Assert<Equal<EntityProfilerReport, SrcEntityProfilerReport>>,
  Assert<Equal<ProfileKind, SrcProfileKind>>,
  Assert<Equal<SpriteAlignX, SrcSpriteAlignX>>,
  Assert<Equal<SpriteAlignY, SrcSpriteAlignY>>,
  Assert<Equal<SpriteRenderOptions<rootApi.Entity>, SrcSpriteRenderOptions<srcApi.Entity>>>,
  Assert<Equal<Snapshot, SrcSnapshot>>,
  Assert<Equal<LoadResult, SrcLoadResult>>,
  Assert<Equal<WorldOptions, SrcWorldOptions>>,
  Assert<Equal<WorldLoopOptions, SrcWorldLoopOptions>>,
  Assert<Equal<FrameScheduler, SrcFrameScheduler>>,
  Assert<Equal<PhysicsSystemOptions, SrcPhysicsSystemOptions>>,
  Assert<Equal<ICamera, SrcICamera>>,
  Assert<Equal<ICanvas, SrcICanvas>>,
  Assert<Equal<AssetManifest, SrcAssetManifest>>,
  Assert<Equal<HudInputEventType, SrcHudInputEventType>>,
];

const publicTypeContract: PublicTypeContract | null = null;

describe("public exports", () => {
  test("root index re-exports src API", () => {
    expect(rootApi.Entity).toBe(srcApi.Entity);
    expect(rootApi.EcsRuntime).toBe(srcApi.EcsRuntime);
    expect(rootApi.Component).toBe(srcApi.Component);
    expect(rootApi.EntityRegistry).toBe(srcApi.EntityRegistry);
    expect(rootApi.GarbageCollector).toBe(srcApi.GarbageCollector);
    expect(rootApi.BroadcastEventBus).toBe(srcApi.BroadcastEventBus);
    expect(rootApi.Vector2D).toBe(srcApi.Vector2D);
    expect(rootApi.TransformComponent).toBe(srcApi.TransformComponent);
    expect(rootApi.CollisionEntity).toBe(srcApi.CollisionEntity);
    expect(rootApi.CircleCollisionShape).toBe(srcApi.CircleCollisionShape);
    expect(rootApi.RectangleCollisionShape).toBe(srcApi.RectangleCollisionShape);
    expect(rootApi.CurveCollisionShape).toBe(srcApi.CurveCollisionShape);
    expect(rootApi.SpatialHashBroadphase).toBe(srcApi.SpatialHashBroadphase);
    expect(rootApi.RenderSystem).toBe(srcApi.RenderSystem);
    expect(rootApi.SpriteRenderComponent).toBe(srcApi.SpriteRenderComponent);
    expect(rootApi.SpriteAnimator).toBe(srcApi.SpriteAnimator);
    expect(rootApi.HudViewport).toBe(srcApi.HudViewport);
    expect(rootApi.HudInputComponent).toBe(srcApi.HudInputComponent);
    expect(rootApi.HudInputRouter).toBe(srcApi.HudInputRouter);
    expect(rootApi.SceneManager).toBe(srcApi.SceneManager);
    expect(rootApi.InputManager).toBe(srcApi.InputManager);
    expect(rootApi.World).toBe(srcApi.World);
    expect(rootApi.WorldLoop).toBe(srcApi.WorldLoop);
    expect(rootApi.PhysicsSystem).toBe(srcApi.PhysicsSystem);
    expect(rootApi.PhysicsBodyComponent).toBe(srcApi.PhysicsBodyComponent);
    expect(rootApi.AssetManager).toBe(srcApi.AssetManager);
    expect(rootApi.StateStore).toBe(srcApi.StateStore);
    expect(rootApi.PersistenceRegistry).toBe(srcApi.PersistenceRegistry);
    expect(rootApi.PersistenceLoader).toBe(srcApi.PersistenceLoader);
    expect(rootApi.ObjectPool).toBe(srcApi.ObjectPool);
    expect(rootApi.EntityProfiler).toBe(srcApi.EntityProfiler);
  });

  test("key runtime exports are defined", () => {
    expect(publicTypeContract).toBeNull();
    expect(typeof rootApi.Entity).toBe("function");
    expect(typeof rootApi.BroadcastEventBus).toBe("function");
    expect(typeof rootApi.GameEvent).toBe("function");
    expect(typeof rootApi.Vector2D).toBe("function");
    expect(typeof rootApi.noise1D).toBe("function");
    expect(typeof rootApi.World).toBe("function");
    expect(typeof rootApi.WorldLoop).toBe("function");
    expect(typeof rootApi.PhysicsSystem).toBe("function");
    expect(typeof rootApi.PhysicsBodyComponent).toBe("function");
    expect(typeof rootApi.AssetManager).toBe("function");
  });
});
