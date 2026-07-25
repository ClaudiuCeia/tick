# @claudiu-ceia/tick

Tiny 2D game kitchen-sink for TypeScript + Bun.

## Overview

`tick` is a small ECS-style runtime toolkit extracted from previous JS game experiments.

It currently includes:

- ECS primitives (`Entity`, `Component`, `EntityRegistry`)
- Ordered/fixed-step world scheduler (`World` + systems)
- Input manager (keyboard + mouse state)
- Collision shapes/entities + broadphase (`SpatialHashBroadphase`)
- Lightweight physics (`PhysicsBodyComponent`, `PhysicsSystem`)
- Render/scene utilities and a few debug helpers

## Status

This is not a serious production engine right now (probably never).

It is mostly a personal playground for experimenting and learning. I publish it so I can reuse it across projects without copy-pasting.

## Install

```bash
bun add @claudiu-ceia/tick
```

## Migrating to 0.2.0

`0.2.0` tightens several contracts that previously allowed ambiguous or unsafe behavior:

- `a.angleTo(b)` now returns the angle pointing from `a` toward `b`. If code depended on the old
  reverse direction, swap the operands (`b.angleTo(a)`) or use the deprecated `a.angleFrom(b)`
  while migrating.
- `entity.removeComponent(Type)` invokes that component's `destroy()` hook before fully detaching
  it. Do not manually destroy the component or retain it for reuse on another entity.
- `EcsRuntime.reset()` now disposes the current runtime before installing a fresh default runtime.
  Existing entities, input listeners, assets, and persisted state owned by the old runtime are torn
  down. Renderer instances still need their own `renderSystem.dispose()` call.
- Read APIs that expose mutable vectors now return copies, including input positions/deltas/drag
  starts, physics velocity, tile-scroller offset, and global transform/position results. Mutating a
  returned vector no longer mutates engine state; use the corresponding setter or mutation method.
- Constructors and mutators now reject invalid numeric state earlier. Expect errors for non-finite
  positions, rotations, velocities, seeds, timesteps, and physics options, and for non-positive
  dimensions, scales, masses, radii, and broadphase cell sizes. Noise octave/gain parameters and
  persisted identifiers are validated more strictly as well.
- Curves are finite solids rather than effectively unbounded terrain. Set their `width` and `depth`,
  keep rotation at `0` and scale at `1`, and choose broadphase and collision sampling deliberately.
  Physics treats curve bodies as static and resolves them vertically.
- Successful `runtime.loadSnapshot(...)` now replaces the entire runtime entity graph, not just the
  snapshot's root subtree. Staging/validation failures preserve the old graph; success destroys all
  old runtime entities, adopts the staged graph, and leaves its root asleep for the scene to awaken.
- Entity creation-site tracing is now disabled by default. Construct the registry with
  `new EntityRegistry({ captureCreationSites: true })` when the diagnostic stack cost is wanted.
- Every `RenderComponent.render()` call now wraps `doRender()` in its own `ctx.save()` / `restore()`
  pair, including when rendering throws. Do not depend on canvas state leaking between components.
- `GarbageCollector.get(...)` no longer returns shared singleton state. It creates an independent
  collector each call. A collector with an explicit registry stays bound to it; one without a
  registry resolves `EcsRuntime.getCurrent().registry` when used, so retain and configure instances
  intentionally.
- `EntityProfiler.start()` instruments prototype methods and existing instances, and automatically
  instruments ordinary overrides on later entities/components. A lifecycle override implemented as
  an entity class field is assigned after the base constructor's registration hook, so call
  `EntityProfiler.instrument(entity)` after construction for that instance.

## Quickstart

The runtime does not own a loop. Create the graph in the runtime context, add systems to a
`World`, and step it from your host loop:

```ts
import {
  CollisionEntity,
  EcsRuntime,
  Entity,
  PhysicsBodyComponent,
  PhysicsSystem,
  RectangleCollisionShape,
  SystemPhase,
  TransformComponent,
  Vector2D,
  World,
} from "@claudiu-ceia/tick";

class Game extends Entity {}

class Box extends Entity {
  constructor() {
    super();
    this.addComponent(
      new TransformComponent({ position: new Vector2D(100, 80), rotation: 0, scale: 1 }),
    );
    this.addComponent(new PhysicsBodyComponent());
    this.addChild(new CollisionEntity(new RectangleCollisionShape(24, 24), "center"));
  }
}

const runtime = new EcsRuntime();
runtime.input.init(window);

const world = new World({ runtime, fixedDeltaTime: 1 / 60 });
const root = EcsRuntime.runWith(runtime, () => {
  const game = new Game();
  game.addChild(new Box());
  game.awake();
  return game;
});

world.addSystem({
  phase: SystemPhase.Simulation,
  update(dt) {
    root.update(dt);
  },
});
world.addSystem(new PhysicsSystem());

let frameId = 0;
let previous = performance.now();
const frame = (now: number): void => {
  world.step((now - previous) / 1000);
  runtime.input.clearFrame();
  previous = now;
  frameId = requestAnimationFrame(frame);
};
frameId = requestAnimationFrame(frame);

const stop = (): void => {
  cancelAnimationFrame(frameId);
  world.clearSystems();
  runtime.dispose();
};
window.addEventListener("pagehide", stop, { once: true });
```

`World.step()` installs its runtime while invoking systems, so systems can use
`EcsRuntime.getCurrent()`. Entity construction outside a world callback must use
`EcsRuntime.runWith(runtime, ...)` so the entity joins the intended registry.

## Lifecycle and ownership

- Constructing an entity registers it with the current runtime, but does not awaken it.
- `entity.awake()` is idempotent and awakens attached components, then children. Adding a
  component or sleeping child to an awake entity awakens the new attachment immediately.
- `entity.update(dt)` visits its components, then children. A `World` schedules systems; it does
  not automatically update an entity root, which is why the quickstart adds a simulation system.
- `removeComponent(Type)` destroys and detaches the component.
- `removeChild(child)` is a lifecycle removal: an awake child is detached and recursively
  destroyed. An unawakened child is only detached and remains registered. To move a live child,
  call `newParent.addChild(child)` instead; automatic reparenting detaches it from the old parent
  without destroying it or changing its awake state.
- `entity.destroy()` is idempotent, unregisters the entity, recursively destroys descendants and
  components, and detaches it from its parent.

Each `EcsRuntime` owns its registry, input manager, assets, and state store. `runtime.dispose()`
destroys every registered entity, clears those services, and removes `InputManager` listeners.
`EntityRegistry.clear()` only clears lookup indexes; it does not call entity/component teardown and
must not be used as a disposal shortcut.

A `RenderSystem` owns the HUD router listeners it configures for its canvas. Call
`renderSystem.dispose()` when that renderer is retired, then destroy the scene graph (or call
`runtime.dispose()`) so render components unregister. `runtime.dispose()` cannot dispose renderer
instances it was never given. Also stop the host loop and call `world.clearSystems()` to run system
teardown.

## Input and pointers

`runtime.input.init(target)` attaches one listener set to the first target passed for that runtime.
Repeated `init()` calls are no-ops until `input.dispose()`; call `clearFrame()` once after all systems
have consumed the frame's pressed/released, mouse-delta, wheel, and click state. The manager also
listens on the target's owner window for release/blur events so held state is cleared when a pointer
or key is released outside the target.

HUD input is separate from polled `InputManager` state. Rendering configures one active HUD canvas
router per runtime, and that `RenderSystem` becomes its listener owner. Pointer capture keeps an
active HUD gesture routed after it leaves the element. Disposing a non-owner renderer will not
detach another renderer's router.

## Physics scope

The built-in physics is intentionally lightweight. It integrates linear velocity and resolves
translation-only impulses and positional correction; it has no angular velocity, torque, or
rotation response. Rotated rectangle bounds are computed correctly, but rectangle collision and
MTV resolution use those axis-aligned bounds, so rotated boxes are an AABB approximation rather
than oriented-box collision.

Curve colliders are finite solids: `width` limits their horizontal span and `depth` limits the solid
region below the sampled surface. Curves cannot rotate or scale, use vertical-only resolution, and
are treated as static by `PhysicsSystem`. Without `surfaceBounds`, `boundsSamples` produces only an
approximate broadphase AABB and can miss narrow extrema. Actual `getYAt` results are never clamped.
Provide guaranteed extrema through `surfaceBounds` and set `requireSurfaceBounds: true` when a
conservative broadphase contract is required; an evaluated height outside those bounds throws.
`collisionSamples` independently controls narrowphase boolean/MTV sampling, which evaluates
`collisionSamples + 1` points across the overlap.

## Examples

Run locally:

- `bun run example:bouncy-arena`
- `bun run example:dino-runner`
- `bun run example:collision-lab`
- `bun run example:pixel-painter`
- `bun run example:hud-viewport`
- `bun run example:hud-layout`
- `bun run example:hud-debug`

## Persistence

Persistence is runtime-scoped and opt-in. The high-level flow snapshots an entity subtree and later
atomically replaces the runtime's registered graph:

```ts
import { Component, EcsRuntime, Entity, type SnapshotEntityNode } from "@claudiu-ceia/tick";

class SaveRoot extends Entity {
  public static type = "save-root";
}

class CounterComponent extends Component {
  public static type = "counter";
  public count = this.atom("count", 0);
}

class Enemy extends Entity {
  public static type = "enemy";

  public constructor(
    public readonly saveId: string,
    public readonly archetype: string,
  ) {
    super();
  }
}

const runtime = new EcsRuntime();
runtime.registerPersistedEntity(SaveRoot, () => new SaveRoot());
runtime.registerPersistedComponent(CounterComponent, () => new CounterComponent());
runtime.registerPersistedEntity(Enemy, (rawNode) => {
  const node = rawNode as SnapshotEntityNode;
  const archetype = node.params?.archetype;
  if (typeof archetype !== "string") throw new Error("Enemy archetype is required");
  return new Enemy(node.sid, archetype);
});

const root = EcsRuntime.runWith(runtime, () => {
  const entity = new SaveRoot();
  entity.addComponent(new CounterComponent());
  entity.addChild(new Enemy("enemy-boss", "boss"));
  entity.awake();
  return entity;
});
root.getComponent(CounterComponent).count.set(42);

const snapshot = runtime.snapshot(root, {
  sceneId: "gameplay",
  rootSid: "game-root",
  sid: (entity) => (entity instanceof Enemy ? entity.saveId : undefined),
  params: (entity) => (entity instanceof Enemy ? { archetype: entity.archetype } : undefined),
});
localStorage.setItem("save", JSON.stringify(snapshot));

const saved = JSON.parse(localStorage.getItem("save")!);
const result = runtime.loadSnapshot(saved, { strict: true });
if (!result.ok) throw new Error(result.errors.map((error) => error.message).join("\n"));

// Loading destroys the previous graph only after the replacement stages successfully.
// The loaded root intentionally remains asleep so the scene owner controls activation.
const loadedRoot = runtime.registry.getFirstEntityByType(SaveRoot);
if (!loadedRoot) throw new Error("Loaded root not found");
loadedRoot.awake();
```

1. Give each persisted entity class a stable non-empty `static type`; all instances of that class
   share that type identifier. Give each persisted component class its own stable type identifier.
   Snapshot SIDs are different: they uniquely identify entity instances within one snapshot.
2. Declare state in components with `this.atom(...)` and `this.ref(...)`.
3. Register entity factories with `runtime.registerPersistedEntity(...)` and component factories
   with `runtime.registerPersistedComponent(...)`. Class registration reads the class's static type;
   string registration is also available. Factories must be side-effect-free apart from
   constructing and returning the requested object and its deterministic local setup: do not awaken
   or parent entities, mutate an existing graph, or create extra runtime entities. In particular,
   mutations to external objects captured by a factory closure cannot be quarantined or rolled back.
4. Save with `runtime.snapshot(root, options)`. It records hierarchy, declared persisted component
   types, atoms, and refs for exactly that subtree. `sid(entity)` can assign stable per-instance SIDs
   and `params(entity)` can serialize constructor/factory parameters. Returning `undefined` from a
   callback uses the normal SID fallback or preserves params from a previously loaded node.
5. Restore with `runtime.loadSnapshot(snapshot, options)`. Validation/factory failures leave the
   old graph intact; success destroys the runtime's entire old entity graph and commits the new graph
   asleep. Locate and awaken the root when its scene is ready.

See `examples/pixel-painter` for a minimal autosave flow (`localStorage` + per-pixel save).

## Assets (runtime-scoped)

Each `EcsRuntime` has an `assets` manager with scope-based lifecycle.

```ts
const scope = runtime.assets.createScope("main-scene");

await scope.loadImage("atlas", "/assets/runner.png");
await scope.loadAudio("jump", "/assets/jump.wav");
await scope.loadFont("pixel", "PixelFont", "url(/assets/pixel.woff2)");
await scope.loadSpriteSheetGrid("runner", "atlas", {
  frameWidth: 24,
  frameHeight: 24,
  count: 8,
  columns: 8,
});

const atlas = scope.getImage("atlas");
const runSheet = scope.getSpriteSheet("runner");

// On scene teardown:
scope.release();
```

## HUD design space (responsive UI)

`tick` includes a `HudViewport` helper for resolution-independent HUD rendering.

```ts
import { HudViewport, RenderSystem, Vector2D } from "@claudiu-ceia/tick";

const hud = new HudViewport(new Vector2D(1920, 1080), "contain");
const renderSystem = new RenderSystem(canvasView, camera, runtime, hud);

// HUD components now render in 1920x1080 design units.
renderSystem.render();
```

For pointer input, convert DOM mouse coordinates (`clientX/clientY`) directly into HUD coordinates:

```ts
const clientPoint = runtime.input.getMousePos();
const hudPoint = hud.clientToHud(clientPoint, canvasElement);
```

`HudViewport` supports `"contain"`, `"cover"`, and `"stretch"` fit modes.

For HUD layout composition, use `HudLayoutNodeComponent` + `HudDeckLayoutComponent` /
`HudStackLayoutComponent`:

```ts
const panel = new Entity();
panel.addComponent(
  new HudLayoutNodeComponent({
    width: 360,
    height: 140,
    anchor: "bottom-center",
    offset: { x: 0, y: -20 },
  }),
);
panel.addComponent(new HudDeckLayoutComponent({ padding: 10 }));

const row = new Entity();
row.addComponent(
  new HudLayoutNodeComponent({
    width: "95%", // percentage of parent frame
    height: 72,
    anchor: "bottom-center",
  }),
);
row.addComponent(new HudStackLayoutComponent({ direction: "row", gap: 10 }));

const slot = new Entity();
slot.addComponent(
  new HudLayoutNodeComponent({
    width: "fill", // split remaining main-axis space among fill siblings
    height: "fill", // in deck/cross-axis contexts: use full available size
    minWidth: 180,
    maxWidth: 260,
  }),
);

// Optional input hooks on a HUD entity
class AbilityInput extends HudInputComponent {
  protected override onPointerDown(e: HudInputEvent): void {
    e.stopPropagation();
  }

  protected override onKeyDown(e: HudInputEvent): void {
    // focused or global based on this.keyboardMode
  }
}
```

For a runnable demo that keeps the same HUD layout across multiple canvas resolutions:

```bash
bun run example:hud-viewport
```

For a larger RPG/MOBA-style HUD with nested deck/stack nodes:

```bash
bun run example:hud-layout
```

For HUD debugging, add `HudLayoutDebugRenderComponent` to any awake HUD entity. It draws resolved
layout frames, anchor points, and optional labels for all `HudLayoutNodeComponent` nodes.

Minimal runnable debug demo:

```bash
bun run example:hud-debug
```

## Development

```bash
bun install
bun run check
```

Useful scripts:

- `bun run typecheck`
- `bun run lint`
- `bun run format`
- `bun run format:check`
- `bun run test`
- `bun run test:coverage`
- `bun run check`

## License

MIT
