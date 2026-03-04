import {
  EcsRuntime,
  Entity,
  HudDeckLayoutComponent,
  HudLayoutDebugRenderComponent,
  HudLayoutNodeComponent,
  HudRenderComponent,
  HudStackLayoutComponent,
  HudViewport,
  RenderLayer,
  RenderSystem,
  SystemPhase,
  SystemTickMode,
  Vector2D,
  World,
  type ICamera,
  type ICanvas,
} from "../../index.ts";
import { WorldLoop } from "../shared/WorldLoop.ts";

class CameraEntity extends Entity implements ICamera {
  public toCanvas(worldPos: Vector2D): Vector2D {
    return worldPos;
  }
}

class HudNode extends Entity {}

class BoxRender extends HudRenderComponent<HudNode> {
  constructor(private readonly color: string) {
    super(RenderLayer.HUD);
  }

  public override doRender(ctx: CanvasRenderingContext2D): void {
    const node = this.ent.getComponent(HudLayoutNodeComponent);
    const frame = node.getFrame();
    if (!frame) return;
    ctx.fillStyle = this.color;
    ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
  }
}

const DESIGN = new Vector2D(1920, 1080);

const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Missing #canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D canvas context unavailable");

const runtime = new EcsRuntime();
const canvasView: ICanvas = { context: ctx, size: new Vector2D(canvas.width, canvas.height) };
const camera = EcsRuntime.runWith(runtime, () => {
  const cam = new CameraEntity();
  cam.awake();
  return cam;
});

const hudViewport = new HudViewport(DESIGN, "contain", true);
const renderSystem = new RenderSystem(canvasView, camera, runtime, hudViewport);

EcsRuntime.runWith(runtime, () => {
  const root = new HudNode();
  root.addComponent(
    new HudLayoutNodeComponent({ width: DESIGN.x, height: DESIGN.y, anchor: "top-left" }),
  );
  root.addComponent(new HudDeckLayoutComponent());

  const topLeft = new HudNode();
  topLeft.addComponent(
    new HudLayoutNodeComponent({
      width: 360,
      height: 160,
      anchor: "top-left",
      offset: { x: 24, y: 24 },
    }),
  );
  topLeft.addComponent(new BoxRender("rgba(56, 189, 248, 0.24)"));
  root.addChild(topLeft);

  const bottom = new HudNode();
  bottom.addComponent(
    new HudLayoutNodeComponent({
      width: "70%",
      height: 180,
      anchor: "bottom-center",
      offset: { x: 0, y: -24 },
    }),
  );
  bottom.addComponent(new BoxRender("rgba(129, 140, 248, 0.2)"));
  bottom.addComponent(new HudStackLayoutComponent({ direction: "row", gap: 12, padding: 12 }));
  root.addChild(bottom);

  for (let i = 0; i < 4; i++) {
    const slot = new HudNode();
    slot.addComponent(
      new HudLayoutNodeComponent({ width: "fill", minWidth: 120, height: "fill", order: i }),
    );
    slot.addComponent(new BoxRender("rgba(94, 234, 212, 0.2)"));
    bottom.addChild(slot);
  }

  const hidden = new HudNode();
  const hiddenNode = new HudLayoutNodeComponent({
    width: 220,
    height: 90,
    anchor: "top-right",
    offset: { x: -30, y: 40 },
  });
  hiddenNode.visible = false;
  hidden.addComponent(hiddenNode);
  hidden.addComponent(new BoxRender("rgba(248, 113, 113, 0.28)"));
  root.addChild(hidden);

  const debugHost = new HudNode();
  debugHost.addComponent(
    new HudLayoutDebugRenderComponent({ includeHidden: true }, RenderLayer.HUD + 10),
  );
  root.addChild(debugHost);

  root.awake();
});

const resize = (): void => {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvasView.size.set(width, height);
};

resize();
window.addEventListener("resize", resize);

const world = new World({ runtime, fixedDeltaTime: 1 / 120, maxSubSteps: 8 });

world.addSystem({
  phase: SystemPhase.Input,
  tickMode: SystemTickMode.Frame,
  update: resize,
});

world.addSystem({
  phase: SystemPhase.Render,
  tickMode: SystemTickMode.Frame,
  update() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderSystem.render();
  },
});

new WorldLoop(world);
