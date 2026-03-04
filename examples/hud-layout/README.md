# hud-layout

RPG/MOBA-style HUD demo using `HudLayoutNodeComponent`, `HudStackLayoutComponent`, and
`HudDeckLayoutComponent`.

## What this proves

- Anchored panels in multiple screen regions (top-left, top-center, top-right, bottom-left, bottom-center)
- Nested layout composition: deck -> stack -> deck -> stack
- Stable responsive HUD from one `1920x1080` design space using `HudViewport`
- Basic primitive rendering (circles, rectangles, text) tied to resolved layout frames

## Run

```bash
bun run example:hud-layout
```

Then open `http://localhost:5178`.
