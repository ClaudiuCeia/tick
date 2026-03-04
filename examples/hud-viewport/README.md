# hud-viewport

Visual demo for `HudViewport` design-space rendering.

## What this proves

- Same HUD layout draws from one `1920x1080` design space
- UI keeps proportions across different canvas resolutions/aspect ratios
- Pointer coordinates can be mapped from `clientX/clientY` to HUD units via `clientToHud`

## Run

```bash
bun run example:hud-viewport
```

Then open `http://localhost:5177`.
