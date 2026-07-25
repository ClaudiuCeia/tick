# bouncy-arena

Small playable example showing how to wire `tick` into a simple arcade loop.

## What this proves

- Runtime-scoped state with `EcsRuntime`
- Scene lifecycle via `SceneManager`/`Scene`
- Entity/component lifecycle and hierarchy
- Rectangle collisions via `CollisionEntity`
- Rendering via `RenderSystem` + `RenderComponent` + HUD
- Typed in-process events via `BroadcastEventBus`

## Controls

- Move: `WASD` or Arrow keys
- Shoot: `Space`
- Restart after game over: `R`

## Run

```bash
bun run example:bouncy-arena
```

Then open `http://127.0.0.1:5173`.

## Test

```bash
bun test examples/bouncy-arena
```
