# collision-lab

Interactive collision playground focused on the upgraded collision stack.

## What this proves

- Layer/mask collision filtering
- Spatial hash broadphase candidate generation
- Narrow-phase confirmation + collision normal visualization
- Circle/rectangle/curve interactions

## Controls

- Drag shapes: left mouse button
- Spawn circle at cursor: `1`
- Spawn rectangle at cursor: `2`
- Edit selected body layer/mask from side panel

## Run

```bash
bun run example:collision-lab
```

Then open `http://127.0.0.1:5175`.
