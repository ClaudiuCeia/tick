# ECS Library — Architecture Reference

## Overview

A game-framework library extracted from two projects: **spacetrader** (`~/Dev/spacetrader`) and **fade** (`~/Dev/fade`). The library contains the shared ECS skeleton, event system, math primitives, collision, rendering infrastructure, scene management, input, utilities, and devtools. It contains no game-specific logic.

**Tooling**: Bun (`bun test`, `bunx tsc --noEmit`). No Node, no Webpack, no Vite.

**Source of truth**: `fade` was the newer, better implementation. All improvements from fade were preferred over spacetrader during extraction.

---

## Directory Structure

```
src/
├── ecs/          Entity, Component, EcsRuntime, EntityRegistry, GarbageCollector, lifecycle interfaces
├── events/       BroadcastEventBus<TPayload>, GameEvent<TPayload, T>
├── math/         Vector2D, LCG, Noise1D/fBm1D, easing functions
├── transform/    TransformComponent (hierarchical, rotation-correct)
├── collision/    CollisionEntity, shapes (Circle, Rectangle, Curve)
│   └── shapes/
├── render/       ICamera, RenderSystem, RenderComponent, HudRenderComponent, CollisionRenderComponent
├── scene/        Scene (abstract), SceneManager
├── input/        InputManager (runtime-scoped, three-state keyboard + mouse)
├── utils/        ObjectPool, Color
└── devtools/     EntityProfiler (runtime prototype patching, perf reports)
```

Each module has an `index.ts` barrel. `src/index.ts` re-exports all barrels. `index.ts` at root re-exports `src/index.ts`.

**Import path alias**: `@ecs/*` → `./src/*` (configured in `tsconfig.json`). Use this for cross-module imports within the library itself, or use relative paths — either works.

---

## Module-by-Module Reference

### `ecs/`

#### Entity (`src/ecs/Entity.ts`)

- Abstract base. Auto-registers with the current runtime's `EntityRegistry` in constructor.
- **Lifecycle**: `constructor` (registered, not awake) → `awake()` → `update(dt)` → `destroy()`.
- Propagates all lifecycle calls to components and children.
- **Lazy awake**: `addComponent()` / `addChild()` on an already-awake entity immediately calls `awake()` on the new addition.
- `removeChild()` destroys an awake child after detaching it. To move a live child, call `newParent.addChild(child)`; automatic reparenting detaches from the previous parent without destruction and preserves awake state.
- Component lookup is O(1) via `_componentMap: Map<Function, Component>`.
- Child lookup by type is O(1) via `_childMap: Map<Function, Entity[]>`.
- `removeChild(() => true)` correctly removes all children (the predicate form).
- `_markForGc` flag is set in `destroy()` — readable by GarbageCollector.

#### Component (`src/ecs/Component.ts`)

- Abstract base. Typed to its entity: `Component<MyEntity>` → `this.ent` is `MyEntity`.
- `this.entity` is the nullable field; `this.ent` throws if unset.
- Default no-op implementations for `awake()`, `update()`, `destroy()`.

#### EntityRegistry (`src/ecs/EntityRegistry.ts`)

- Per-runtime registry (`EcsRuntime.registry`). Do **not** register manually — Entity constructor handles it.
- Backed by `Map<string, Entity>` (by id) + `Map<Function, Set<Entity>>` (by type). Both O(1).
- `clear()` wipes all registry indexes but does **not** destroy entities or components. Use `EcsRuntime.dispose()` for teardown; clearing alone can leak lifecycle-owned subscriptions and render registrations.
- Creation-site tracing is opt-in with `new EntityRegistry({ captureCreationSites: true })`; it is disabled by default. When enabled, `getCreationSite(id)` returns the captured registration call site.
- Common queries:
  ```ts
  const runtime = EcsRuntime.getCurrent();
  runtime.registry.getEntitiesByType(MyEntity);
  runtime.registry.getFirstEntityByType(MyEntity);
  runtime.registry.findEntities((e) => e.hasComponent(TimeComponent));
  ```

#### EcsRuntime persistence (`src/ecs/EcsRuntime.ts`)

- `runtime.snapshot(root, options)` snapshots exactly the root subtree. `options.sid(entity)` assigns stable instance SIDs, while `options.params(entity)` supplies per-instance factory parameters; class `static type` values identify classes, not instances.
- Undefined callback results use normal SID fallback or params retained from a previously loaded node.
- `loadSnapshot()` stages factories in a quarantined runtime. Factories must remain side-effect-free with respect to captured external objects and must not awaken entities or create entities outside the snapshot graph.
- A successful load destroys the target runtime's entire old entity graph, adopts the staged graph, commits state, and leaves the loaded root asleep. Validation or staging failure preserves the old graph.

#### GarbageCollector (`src/ecs/GarbageCollector.ts`)

- `GarbageCollector.get(root?, registry?)` creates a new independent collector on every call; collectors do not share root or registry configuration. An explicit registry pins the collector to it, while an omitted registry resolves the current runtime's registry when the collector is used.
- `findOrphans()` walks the live entity tree from the root entity (default name `"Game"`) and returns any registered entity not reachable from it.
- `collect()` destroys all orphans and returns the count.
- Call after operations that create transient objects (e.g., throwaway orbital computations).

#### Lifecycle interfaces (`src/ecs/lifecycle.ts`)

- `IAwakable` — `awake()`, optional `destroy()`.
- `IWithUpdate` — `update(dt: number)`.
- Both Entity and Component implement these.

---

### `events/`

#### Design: generic payload map

The EventBus does **not** have a hardcoded event list. Games define their own payload type and instantiate:

```ts
// game/events.ts
type MyPayload = {
  mouse_click: { point: Vector2D };
  selected_body: { id: string };
  jump: Record<string, never>;
};
export const EventBus = new BroadcastEventBus<MyPayload>();
```

This is the primary departure from the source games, where `EventPayload` was hardcoded.

#### BroadcastEventBus (`src/events/EventBus.ts`)

- Listeners are **pre-sorted by priority on `subscribe()`** — no sort on dispatch. This fixes a performance issue present in both source games.
- `Priority.High = 0` (default, fired first), `Priority.Medium = 50`, `Priority.Low = 100`.
- `stopPropagation()` on the event breaks the dispatch loop.
- `subscribe()` returns a string ID — store it and call `unsubscribe(id)` in `destroy()` to avoid listener leaks.
- `BroadcastChannel` is intentionally **not used** — all events are in-process only.
- `debugDump()` logs all subscribed event types and their listener priorities to the console.

**Standard component subscription pattern:**

```ts
export class MyComponent extends Component<MyEntity> {
  private subId: string | null = null;

  public override awake(): void {
    this.subId = EventBus.subscribe("some_event", (e) => {
      /* ... */
    });
  }

  public override destroy(): void {
    if (this.subId) {
      EventBus.unsubscribe(this.subId);
      this.subId = null;
    }
  }
}
```

#### GameEvent (`src/events/GameEvent.ts`)

```ts
new GameEvent<TPayload, T>(type, payload, contextId?)
event.stopPropagation()
GameEvent.from({ type, payload, contextId })
```

---

### `math/`

#### Vector2D (`src/math/Vector2D.ts`)

- **`Vector2D.fromScreen()`** — returns `new Vector2D(window.innerWidth, window.innerHeight)`. Allocates every call — cache the result if used in a hot loop.
  - The old `Vector2D.screen` static property from the source games was removed here; it was a static field initialized once at module load (stale after resize).
- `Vector2D.zero` / `Vector2D.one` — also allocate on every access (getters), same caveat.
- Immutable operations return new instances. `set(x, y)` mutates in-place.
- `fromAngle(radians)` → unit vector.

#### LCG (`src/math/LCG.ts`)

- Deterministic, seedable RNG. `random()` returns `[0, 1)`.
- Use for reproducible procedural generation (same seed → same output).

#### Noise1D / fBm1D (`src/math/Noise1D.ts`)

- `noise1D(x)` — 1D Perlin-style noise, output `[-1, 1]`.
- `fBm1D(x, octaves, lacunarity, gain)` — fractional Brownian motion on top of noise1D.
- Permutation table is generated once at module load with `Math.random()`.

#### Easing functions (`src/math/math.ts`)

All take `x ∈ [0, 1]`, return `0` outside that range:
`tent`, `easeInOut`, `easeIn`, `easeOut`, `bounce`, `bounceInOut`, `elastic`, `elasticInOut`, `exponential`, `exponentialInOut`, `lerp(a, b, t)`.

---

### `transform/`

#### TransformComponent (`src/transform/TransformComponent.ts`)

- Each entity with a `TransformComponent` has a local `_transform` (position, rotation, scale) and a computed `globalTransform` that chains through the parent hierarchy.
- **`globalTransform`** correctly applies parent rotation when computing child world position (rotates local offset by parent rotation angle). This was a bug in spacetrader's version.
- **`getGlobalPosition()`** delegates to `globalTransform.position` — it is now correct.
- `awake()` auto-wires `this.parent` to the parent entity's `TransformComponent` if it has one.
- `anchorTo(entity | transform)` / `unanchor()` for dynamic reparenting.
- Fluent mutation API: `translate()`, `rotate()`, `scaleBy()`, `setPosition()`, `setRotation()`, `setScale()` all return `this`.

---

### `collision/`

#### CollisionShape interface (`src/collision/CollisionShape.ts`)

Five methods all shapes must implement:

- `getAABB(transform, anchor)` — returns `{x, y, width, height}` in world space.
- `isCollidingWith(other, tA, anchorA, tB, anchorB)` — boolean.
- `containsPoint(point, transform, anchor)` — boolean.
- `getCollisionNormal(...)` — returns MTV `Vector2D | null`.
- `resize(...args)` — mutates shape dimensions.

`CollisionAnchor`: `"center"` | `"top-left"`.

#### Shapes

| Shape                     | File                  | Notes                                                                               |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `CircleCollisionShape`    | `shapes/Circle...`    | Circle/circle and circle/rectangle collision + MTV; delegates curve/custom pairs    |
| `RectangleCollisionShape` | `shapes/Rectangle...` | Collision + MTV via AABB overlap, including AABB approximation for rotated boxes    |
| `CurveCollisionShape`     | `shapes/Curve...`     | Finite depth; no rotation/scale; sampled vertical collision with rectangles/circles |

Unknown shape combinations use double-dispatch: delegate to `other.isCollidingWith(this, ...)`.
Curve `boundsSamples` provide only an approximate AABB unless guaranteed `surfaceBounds` are supplied. Set `requireSurfaceBounds` to enforce conservative broadphase bounds. Narrowphase evaluates actual, unclamped heights at `collisionSamples + 1` points and throws if explicit bounds are violated.

#### CollisionEntity (`src/collision/CollisionEntity.ts`)

- Extend `Entity`, not a component. Add as a **child** with `addChild()`.
- Constructor: `new CollisionEntity(shape, anchor?, layer?)`.
- `bbox()` — AABB in world space (uses globalTransform).
- `isColliding(other)` / `getCollisionNormal(other)` / `containsPoint(point)`.
- `resize(...args)` — delegates to shape.
- `isCollidingWithPlayer` and `isCollidingWith[]` fields — managed externally by a physics system.

---

### `render/`

#### ICamera (`src/render/ICamera.ts`)

The only contract the render system has with the camera:

```ts
interface ICamera {
  getChild<C extends Entity>(constr: Constructor<C>): C | null;
  toCanvas(worldPos: Vector2D, canvasSize: Vector2D): Vector2D;
}
```

`getChild` is needed for frustum culling (checks camera's `CollisionEntity`). `toCanvas` is called by game render components to convert world → canvas pixels. Game `CameraEntity` classes satisfy this implicitly since they extend `Entity` (which has `getChild`) and must provide `toCanvas`.

In game `doRender` implementations, cast as needed: `const cam = camera as CameraEntity`.

#### RenderComponent (`src/render/RenderComponent.ts`)

- Abstract. Override `doRender(ctx, camera: ICamera, canvasSize)`.
- `render()` is the final template method — it wraps each `doRender` call in `ctx.save()` / `ctx.restore()` with `finally`, isolating canvas state even when rendering throws.
- `awake()` / `destroy()` self-register/unregister with `RenderSystem`.
- `isVisible(camera)`:
  - Returns `false` if entity is not awake.
  - Returns `true` for HUD-layer components (`zIndex >= RenderLayer.HUD`).
  - For world components: checks AABB overlap between entity's `CollisionEntity` child and camera's `CollisionEntity` child. If either is missing, returns `false` (logs a warning).
- `elapsed` accumulates delta time — useful for animations.

#### HudRenderComponent (`src/render/HudRenderComponent.ts`)

- Extends `RenderComponent`. Enforces `zIndex >= RenderLayer.HUD`, throws otherwise.
- HUD components always pass `isVisible` — no camera culling.

#### RenderSystem (`src/render/RenderSystem.ts`)

- Instantiated with `new RenderSystem(canvas: ICanvas, camera: ICamera, runtime?, hudViewport?)`.
- `ICanvas` = `{ context: CanvasRenderingContext2D; size: Vector2D }`.
- Renderables are stored per runtime and sorted on registration / z-index changes (ascending); frame rendering uses a stable committed list.
- `render()`: draws world components first (Background → Foreground), then HUD on top.
- `dispose()` stops that renderer and detaches the HUD input router only when it owns the runtime's current router configuration. It does not destroy entities; destroy the scene root or dispose the runtime to unregister render components.

#### RenderLayer enum

```ts
((Background = 0), (World = 100), (Foreground = 200), (HUD = 300));
```

#### CollisionRenderComponent (`src/render/CollisionRenderComponent.ts`)

Debug-only. Add to a `CollisionEntity` to draw its AABB in red. Uses `camera.toCanvas()` to convert world bbox corners to screen coords.

---

### `scene/`

#### SceneManager (`src/scene/SceneManager.ts`)

```ts
const manager = new SceneManager();
manager.changeScene(new MyScene()); // destroys current, awakens next
manager.update(dt);
manager.render(ctx);
```

`Scene` is an abstract base with `awake()`, `update(dt)`, `render(ctx)`, `destroy()`. Scenes are responsible for creating/destroying their own entities.

---

### `input/`

#### InputManager (`src/input/Input.ts`)

Runtime-scoped class. Use `EcsRuntime.getCurrent().input`.

```ts
const input = EcsRuntime.getCurrent().input;
input.init(); // call once at startup
input.isDown("ArrowLeft"); // held this frame and beyond
input.isPressed("Space"); // true only on the frame the key was first pressed
input.isReleased("Space"); // true only on the frame the key was released
input.isMouseClick(); // true only the frame of a click
input.getMousePos(); // Vector2D in client coordinates
input.clearFrame(); // call at end of frame
input.dispose(); // remove listeners and clear held/frame state
```

Key strings use `KeyboardEvent.key` values (`'ArrowLeft'`, `'Space'`, `'a'`, etc.).
`init(target)` is idempotent and the first target owns the listener set until `dispose()`. Release and blur listeners are also installed on the target's owner window when available.

---

### `utils/`

#### ObjectPool (`src/utils/ObjectPool.ts`)

```ts
const pool = new ObjectPool(
  () => new MyObj(),
  (obj) => obj.reset(),
);
const item = pool.obtain();
pool.release(item);
pool.forEachInUse((item) => {
  /* ... */
});
```

Reduces GC pressure for frequently-created short-lived objects.

#### Color (`src/utils/Color.ts`)

`new Color(r, g, b)` where r/g/b are 0–255. `toRgbaString(alpha)` for CSS. `Color.random(base, variation)` for procedural coloring.

---

### `devtools/`

#### EntityProfiler (`src/devtools/EntityProfiler.ts`)

Patches `Entity.prototype`, `Component.prototype`, and `RenderComponent.prototype` at runtime to time lifecycle methods with `performance.now()`.

```ts
EntityProfiler.start(); // begin recording
EntityProfiler.stop(); // stop
EntityProfiler.printTopSlow("update", 10); // slowest 10 by update time
EntityProfiler.printTopSlow("render", 5); // slowest 5 by render time
EntityProfiler.scanOffscreenCollision(camera); // log off-screen colliders
EntityProfiler.clear(); // reset data
```

`ProfileKind`: `'awake' | 'update' | 'render' | 'destroy'`.
`start()` instruments existing runtime objects and hooks later entity registration/component attachment. Entity lifecycle overrides defined as class fields are assigned after base-constructor registration, so call `EntityProfiler.instrument(entity)` after construction to instrument those instance fields explicitly.

---

## Key Design Decisions (for Future Reference)

### EventBus is not a singleton at the library level

Games instantiate `new BroadcastEventBus<MyPayload>()` and export their own `EventBus`. The library only exports the class. This avoids a shared global state problem and keeps the payload type safe per-game.

### ICamera decouples render from game cameras

The render system knows nothing about zoom, pan, rotation, or space vs. screen transforms. Any object that can `getChild(CollisionEntity)` and `toCanvas(worldPos, canvasSize)` is a valid camera. Games cast `camera as CameraEntity` inside their `doRender` override when they need camera-specific functionality.

### RenderSystem renderables are runtime-scoped

Renderables are stored per `EcsRuntime` (internally via `WeakMap<EcsRuntime, RenderComponent[]>`). This means:

- Render state is isolated across runtimes.
- You can run multiple independent worlds if each one has its own runtime.
- Registration/unregistration still happens automatically through `RenderComponent.awake()/destroy()`.
- Registry `clear()` does not trigger lifecycle methods. Use `runtime.dispose()` (and dispose any `RenderSystem` instances) for full teardown.

### Sort-on-insert everywhere

Both `RenderSystem.register()` and `BroadcastEventBus.subscribe()` maintain sorted order on insert. Neither `render()` nor `dispatch()` sorts. Listener/renderable counts are small so the O(n) insert is fine.

### Vector2D allocation

`Vector2D.fromScreen()`, `Vector2D.zero`, `Vector2D.one`, and all operation methods (`add`, `subtract`, `multiply`, etc.) allocate new instances. This is intentional for immutability. In tight loops (e.g., inside a render function called 60× per second), cache results at call sites.

### TransformComponent.globalTransform vs getGlobalPosition()

Use `globalTransform.position` or `getGlobalPosition()` — they now both return the same rotation-correct value. The old `getGlobalPosition()` bug (summing positions without rotating) has been fixed in this library.

---

## Extending the Library

### Adding a new module

1. Create `src/<module>/` with implementation files and an `index.ts` barrel.
2. Add `export * from './<module>/index.ts';` to `src/index.ts`.
3. Run `bunx tsc --noEmit` to verify.

### Adding a new collision shape

1. Implement `CollisionShape` interface in `src/collision/shapes/`.
2. Handle the unknown-other case in `isCollidingWith` by delegating to `other.isCollidingWith(this, ...)`.
3. Export from `src/collision/index.ts`.

### Adding a new render component to the library

Extend `RenderComponent` or `HudRenderComponent`. Override `doRender`. The `awake`/`destroy` registration with `RenderSystem` is inherited — do not re-implement it.

---

## Verification

```bash
cd ~/Dev/ecs
bunx tsc --noEmit   # must pass with zero errors
bun test            # run tests
```

No game-specific types (`CameraEntity`, `PlayerEntity`, orbital mechanics, etc.) should appear anywhere in `src/`. The test for this:

```bash
grep -r "CameraEntity\|PlayerEntity\|OrbitalTransform" src/
# should return nothing
```
