import {
  Component,
  EcsRuntime,
  Entity,
  SystemPhase,
  SystemTickMode,
  World,
} from "../../src/index.ts";
import { WorldLoop } from "../shared/WorldLoop.ts";

const GRID_SIZE = 40;
const STORAGE_KEY = "tick:pixel-painter:v1";
const DEFAULT_COLOR = "#0f766e";

type Pixel = {
  on: boolean;
  color: string;
};

class PixelBoardComponent extends Component {
  public static type = "pixel-board";

  public pixels = this.atom<string>("pixels", "");

  public getState(): Pixel[] {
    const encoded = this.pixels.get();
    if (!encoded) {
      return this.createEmptyState();
    }

    try {
      const parsed = JSON.parse(encoded) as Pixel[] | unknown;
      if (!Array.isArray(parsed) || parsed.length !== GRID_SIZE * GRID_SIZE) {
        return this.createEmptyState();
      }
      return parsed.map((value) => {
        if (!value || typeof value !== "object") {
          return { on: false, color: DEFAULT_COLOR };
        }
        const maybe = value as { on?: unknown; color?: unknown };
        const on = maybe.on === true;
        const color = typeof maybe.color === "string" ? maybe.color : DEFAULT_COLOR;
        return { on, color };
      });
    } catch {
      return this.createEmptyState();
    }
  }

  public setState(next: Pixel[]): void {
    this.pixels.set(JSON.stringify(next));
  }

  public clear(): void {
    this.setState(this.createEmptyState());
  }

  private createEmptyState(): Pixel[] {
    return Array.from({ length: GRID_SIZE * GRID_SIZE }, () => ({
      on: false,
      color: DEFAULT_COLOR,
    }));
  }
}

class PixelBoardEntity extends Entity {
  public static type = "pixel-board-entity";

  public board = new PixelBoardComponent();

  public constructor() {
    super();
    this.addComponent(this.board);
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
const clearButton = document.querySelector<HTMLButtonElement>("#clear-btn");
const colorPicker = document.querySelector<HTMLInputElement>("#color-picker");
const statusEl = document.querySelector<HTMLElement>("#status");

if (!canvas || !clearButton || !colorPicker || !statusEl) {
  throw new Error("Pixel painter bootstrap failed: missing UI elements.");
}

const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not acquire 2D canvas context.");
}

const runtime = new EcsRuntime();
runtime.input.init(window);
const boardEntity = EcsRuntime.runWith(runtime, () => {
  const ent = new PixelBoardEntity();
  ent.awake();
  return ent;
});
const board = boardEntity.board;

const cellSize = canvas.width / GRID_SIZE;
let isPainting = false;
let needsRender = true;

const loadFromLocalStorage = (): void => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    board.clear();
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Pixel[] | unknown;
    if (!Array.isArray(parsed) || parsed.length !== GRID_SIZE * GRID_SIZE) {
      board.clear();
      return;
    }
    board.setState(parsed as Pixel[]);
  } catch {
    board.clear();
  }
};

const autosave = (): void => {
  localStorage.setItem(STORAGE_KEY, board.pixels.get());
  statusEl.textContent = `Autosaved ${new Date().toLocaleTimeString()}`;
};

const draw = (): void => {
  const state = board.getState();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const idx = y * GRID_SIZE + x;
      const pixel = state[idx];
      if (!pixel) continue;

      if (pixel.on) {
        ctx.fillStyle = pixel.color;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }

      ctx.strokeStyle = "#e2e8f0";
      ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
};

const paintAt = (event: MouseEvent): void => {
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const x = Math.floor(px / cellSize);
  const y = Math.floor(py / cellSize);

  if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) {
    return;
  }

  const next = board.getState();
  const idx = y * GRID_SIZE + x;
  const current = next[idx];
  if (!current) return;

  const color = colorPicker.value || DEFAULT_COLOR;
  if (current.on && current.color === color) {
    return;
  }

  next[idx] = { on: true, color };
  board.setState(next);
  autosave();
  needsRender = true;
};

clearButton.addEventListener("click", () => {
  board.clear();
  localStorage.removeItem(STORAGE_KEY);
  statusEl.textContent = "Cleared";
  needsRender = true;
});

canvas.addEventListener("mousedown", (event) => {
  isPainting = true;
  paintAt(event);
});

canvas.addEventListener("mousemove", (event) => {
  if (!isPainting) return;
  paintAt(event);
});

window.addEventListener("mouseup", () => {
  isPainting = false;
});

loadFromLocalStorage();
needsRender = true;

const world = new World({ runtime, fixedDeltaTime: 1 / 120, maxSubSteps: 8 });

world.addSystem({
  phase: SystemPhase.Input,
  tickMode: SystemTickMode.Frame,
  update() {},
});

world.addSystem({
  phase: SystemPhase.Render,
  tickMode: SystemTickMode.Frame,
  update() {
    if (needsRender) {
      draw();
      needsRender = false;
    }
    runtime.input.clearFrame();
  },
});

new WorldLoop(world);
