import {
  EcsRuntime,
  SceneManager,
  SystemPhase,
  SystemTickMode,
  Vector2D,
  World,
  type ICanvas,
} from "./lib.ts";
import { CollisionLabScene } from "./scenes/CollisionLabScene.ts";
import { WorldLoop } from "../../shared/WorldLoop.ts";

const LAYERS = [1, 2, 4, 8];

const createCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 620;
  canvas.style.width = "1000px";
  canvas.style.height = "620px";
  canvas.style.border = "1px solid #2c2c2c";
  canvas.style.background = "#161616";
  return canvas;
};

const checkboxGroup = (prefix: string): HTMLInputElement[] =>
  LAYERS.map((bit) => {
    const el = document.getElementById(`${prefix}-${bit}`) as HTMLInputElement | null;
    if (!el) throw new Error(`Missing checkbox #${prefix}-${bit}`);
    return el;
  });

const readMask = (inputs: HTMLInputElement[]): number => {
  let value = 0;
  for (const input of inputs) {
    const bit = Number(input.value);
    if (input.checked) value |= bit;
  }
  return value;
};

const writeMask = (inputs: HTMLInputElement[], mask: number): void => {
  for (const input of inputs) {
    const bit = Number(input.value);
    input.checked = (mask & bit) !== 0;
  }
};

export const bootstrapCollisionLab = (): void => {
  const canvasHost = document.getElementById("canvas-host");
  if (!canvasHost) throw new Error("Missing #canvas-host");

  const canvas = createCanvas();
  canvasHost.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const selectedLabel = document.getElementById("selected-label") as HTMLDivElement | null;
  const statColliders = document.getElementById("stat-colliders") as HTMLDivElement | null;
  const statBroadphase = document.getElementById("stat-broadphase") as HTMLDivElement | null;
  const statHits = document.getElementById("stat-hits") as HTMLDivElement | null;
  if (!selectedLabel || !statColliders || !statBroadphase || !statHits) {
    throw new Error("Missing UI stat nodes");
  }

  const layerChecks = checkboxGroup("layer");
  const maskChecks = checkboxGroup("mask");

  const runtime = new EcsRuntime();
  runtime.input.init(window);

  const sceneManager = new SceneManager();
  const canvasView: ICanvas = { context: ctx, size: new Vector2D(canvas.width, canvas.height) };
  const scene = new CollisionLabScene(runtime, canvasView);
  sceneManager.changeScene(scene);

  const onLayerChange = (): void => {
    scene.setSelectedLayer(readMask(layerChecks));
  };
  const onMaskChange = (): void => {
    scene.setSelectedMask(readMask(maskChecks));
  };

  for (const input of layerChecks) input.addEventListener("change", onLayerChange);
  for (const input of maskChecks) input.addEventListener("change", onMaskChange);

  const world = new World({ runtime, fixedDeltaTime: 1 / 120, maxSubSteps: 8 });

  world.addSystem({
    phase: SystemPhase.Simulation,
    tickMode: SystemTickMode.Fixed,
    update(dt) {
      sceneManager.update(dt);
    },
  });

  world.addSystem({
    phase: SystemPhase.Render,
    tickMode: SystemTickMode.Frame,
    update() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sceneManager.render(ctx);

      const snapshot = scene.getSnapshot();
      selectedLabel.textContent = snapshot.selectedLabel;
      statColliders.textContent = String(snapshot.totalColliders);
      statBroadphase.textContent = String(snapshot.broadphasePairs);
      statHits.textContent = String(snapshot.collisionPairs);
      writeMask(layerChecks, snapshot.selectedLayer);
      writeMask(maskChecks, snapshot.selectedMask);

      runtime.input.clearFrame();
    },
  });

  world.addSystem({
    phase: SystemPhase.Input,
    tickMode: SystemTickMode.Frame,
    update() {
      const rect = canvas.getBoundingClientRect();
      scene.setPointerOffset(rect.left, rect.top);
    },
  });

  new WorldLoop(world);
};
