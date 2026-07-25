# Migrating to 0.2

The 0.2 release line tightens several contracts that previously allowed ambiguous or unsafe
behavior:

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

`WorldLoop` is now part of the public package. Projects that copied the example implementation can
delete that copy and import `WorldLoop` from `@claudiu-ceia/tick`.
