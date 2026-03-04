import {
  EcsRuntime,
  PhysicsSystem,
  SceneManager,
  SystemPhase,
  SystemTickMode,
  Vector2D,
  World,
  type ICanvas,
} from "./lib.ts";
import { loadRunnerAssets } from "./assets.ts";
import { RunnerScene } from "./scenes/RunnerScene.ts";
import { WorldLoop } from "../../shared/WorldLoop.ts";

const DISPLAY_WIDTH = 1024;
const DISPLAY_HEIGHT = 576;

const createCanvas = (pixelScale: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(DISPLAY_WIDTH / pixelScale));
  canvas.height = Math.max(1, Math.floor(DISPLAY_HEIGHT / pixelScale));
  canvas.style.width = `${DISPLAY_WIDTH}px`;
  canvas.style.height = `${DISPLAY_HEIGHT}px`;
  canvas.style.border = "1px solid #2c2c2c";
  canvas.style.background = "#181818";
  if (pixelScale > 1) {
    canvas.style.imageRendering = "pixelated";
  }
  return canvas;
};

type DinoBootstrapOptions = {
  pixelScale?: number;
};

export const bootstrapDinoRunner = async (
  mount: HTMLElement = document.body,
  options: DinoBootstrapOptions = {},
): Promise<void> => {
  const pixelScale = Number.isFinite(options.pixelScale) ? Math.max(1, options.pixelScale ?? 1) : 1;
  const canvas = createCanvas(pixelScale);
  mount.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }
  if (pixelScale > 1) {
    ctx.imageSmoothingEnabled = false;
  }

  const runtime = new EcsRuntime();
  runtime.input.init(window);

  const sceneManager = new SceneManager();
  const canvasView: ICanvas = {
    context: ctx,
    size: new Vector2D(canvas.width, canvas.height),
  };

  const visuals = await loadRunnerAssets(runtime);

  const scene = new RunnerScene(runtime, canvasView, visuals);
  sceneManager.changeScene(scene);
  const world = new World({ runtime, fixedDeltaTime: 1 / 120, maxSubSteps: 8 });

  world.addSystem({
    phase: SystemPhase.Input,
    tickMode: SystemTickMode.Frame,
    update() {
      // Input listeners feed the runtime state. This phase makes ordering explicit.
    },
  });

  world.addSystem({
    phase: SystemPhase.Simulation,
    tickMode: SystemTickMode.Fixed,
    update(dt) {
      sceneManager.update(dt);
    },
  });

  world.addSystem(
    new PhysicsSystem({
      gravity: new Vector2D(0, 1400),
      velocityIterations: 8,
      positionIterations: 2,
      broadphaseCellSize: 64,
      sleepLinearThreshold: 2,
      sleepTimeThreshold: 0.2,
    }),
  );

  world.addSystem({
    phase: SystemPhase.Render,
    tickMode: SystemTickMode.Frame,
    update() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sceneManager.render(ctx);
      runtime.input.clearFrame();
    },
  });

  new WorldLoop(world);
};
