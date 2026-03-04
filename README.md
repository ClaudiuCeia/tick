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

## Quickstart

```ts
import {
  EcsRuntime,
  Entity,
  PhysicsBodyComponent,
  PhysicsSystem,
  RectangleCollisionShape,
  CollisionEntity,
  TransformComponent,
  Vector2D,
  World,
} from "@claudiu-ceia/tick";

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
const world = new World({ runtime, fixedDeltaTime: 1 / 60 });
world.addSystem(new PhysicsSystem());

EcsRuntime.runWith(runtime, () => {
  const box = new Box();
  box.awake();
});
```

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

Persistence is runtime-scoped (`runtime.store`) and opt-in.

1. Add `static type` on persisted entities/components.
2. Declare state in components with `this.atom(...)` and `this.ref(...)`.
3. Register persisted entities with `runtime.registerPersistedEntity(...)`.
4. Save with `runtime.store.snapshot(...)` and restore with `runtime.loadSnapshot(snapshot)`.

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
