# dino-runner

Small endless runner inspired by the Chrome dinosaur game.

## What this proves

- Runtime-scoped input + world state
- Scene lifecycle and reset flow
- Basic platform-style movement (jump + gravity)
- Obstacle spawning and collision-driven game over
- Asset pipeline usage with scope lifecycle
- Player sprite animation states (run/jump/hit)
- Action-timed SFX (jump/land/score/hit)
- Custom HUD font loading

## Controls

- Jump: `Space`, `W`, or `ArrowUp`
- Restart after game over: `R`

## Run

```bash
bun run example:dino-runner
```

Then open `http://127.0.0.1:5174`.

Optional pixel upscale (nearest-neighbor):

- `http://127.0.0.1:5174?pixelScale=2`
- `http://127.0.0.1:5174?pixelScale=3`

## Assets

Assets are stored under `examples/dino-runner/assets/`.

- `kenney_new-platformer-pack-1.1`
- `kenney_kenney-fonts`

Credits: art, sounds, and fonts by [Kenney](https://kenney.nl/).

## Test

```bash
bun test examples/dino-runner
```
