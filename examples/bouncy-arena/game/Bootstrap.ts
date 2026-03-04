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
import { ArenaScene } from "./scenes/ArenaScene.ts";
import { WorldLoop } from "../../shared/WorldLoop.ts";

const createCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  canvas.style.width = "800px";
  canvas.style.height = "600px";
  canvas.style.border = "1px solid #2c2c2c";
  canvas.style.background = "#1f1f1f";
  return canvas;
};

export const bootstrapBouncyArena = (mount: HTMLElement = document.body): void => {
  const canvas = createCanvas();
  mount.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }

  const runtime = new EcsRuntime();
  runtime.input.init(window);

  const sceneManager = new SceneManager();
  const canvasView: ICanvas = {
    context: ctx,
    size: new Vector2D(canvas.width, canvas.height),
  };

  const scene = new ArenaScene(runtime, canvasView);
  sceneManager.changeScene(scene);
  const world = new World({ runtime, fixedDeltaTime: 1 / 120, maxSubSteps: 8 });

  world.addSystem({
    phase: SystemPhase.Input,
    tickMode: SystemTickMode.Frame,
    update() {
      // Input events are captured by InputManager listeners; this phase
      // is reserved to keep deterministic world pipeline ordering explicit.
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
      gravity: Vector2D.zero,
      velocityIterations: 6,
      positionIterations: 2,
      broadphaseCellSize: 64,
      sleepLinearThreshold: 4,
      sleepTimeThreshold: 0.25,
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
