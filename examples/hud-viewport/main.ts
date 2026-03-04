import {
  Component,
  EcsRuntime,
  Entity,
  HudRenderComponent,
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

const DESIGN_SIZE = new Vector2D(1920, 1080);

class CameraEntity extends Entity implements ICamera {
  public toCanvas(worldPos: Vector2D): Vector2D {
    return worldPos;
  }
}

class HudViewportPanelEntity extends Entity {
  public readonly state = new HudViewportPanelStateComponent();

  constructor(meta: HTMLElement, canvas: HTMLCanvasElement, viewport: HudViewport) {
    super();
    this.addComponent(this.state);
    this.addComponent(new HudViewportPanelRenderComponent(meta, canvas, viewport));
  }
}

class HudViewportPanelStateComponent extends Component<HudViewportPanelEntity> {
  public pointerClient: Vector2D | null = null;
  public time = 0;
}

class HudViewportPanelRenderComponent extends HudRenderComponent<HudViewportPanelEntity> {
  constructor(
    private readonly meta: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly viewport: HudViewport,
  ) {
    super(RenderLayer.HUD);
  }

  public override doRender(ctx: CanvasRenderingContext2D): void {
    const state = this.ent.state;
    const pointerHud = state.pointerClient
      ? this.viewport.clientToHud(state.pointerClient, this.canvas)
      : null;

    const pulse = 12 + Math.sin(state.time * 4) * 6;

    ctx.strokeStyle = "rgba(126, 170, 227, 0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, DESIGN_SIZE.x, DESIGN_SIZE.y);

    ctx.fillStyle = "rgba(9, 15, 24, 0.75)";
    ctx.fillRect(52, 40, 540, 126);

    ctx.fillStyle = "#dce9ff";
    ctx.font = '58px "JetBrains Mono", monospace';
    ctx.fillText("HUD LOCK", 80, 122);

    const centerX = DESIGN_SIZE.x * 0.5;
    const centerY = DESIGN_SIZE.y * 0.5;
    ctx.strokeStyle = "#74d6ff";
    ctx.lineWidth = 6;
    ctx.strokeRect(centerX - 50, centerY - 50, 100, 100);
    ctx.fillStyle = "#8ce7ff";
    ctx.font = '50px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("A", centerX, centerY + 2);

    ctx.strokeStyle = "rgba(140, 231, 255, 0.35)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centerX - 100, centerY);
    ctx.lineTo(centerX + 100, centerY);
    ctx.moveTo(centerX, centerY - 100);
    ctx.lineTo(centerX, centerY + 100);
    ctx.stroke();

    ctx.fillStyle = "rgba(21, 32, 51, 0.88)";
    ctx.fillRect(DESIGN_SIZE.x - 360, DESIGN_SIZE.y - 168, 288, 92);
    ctx.fillStyle = "#ffd77d";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = '36px "JetBrains Mono", monospace';
    ctx.fillText(`AMP ${Math.round(52 + pulse)}`, DESIGN_SIZE.x - 332, DESIGN_SIZE.y - 108);

    if (pointerHud) {
      ctx.strokeStyle = "#ff8c7d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pointerHud.x, pointerHud.y, 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    const pointerText = pointerHud
      ? `${Math.round(pointerHud.x)}, ${Math.round(pointerHud.y)}`
      : "outside";
    this.meta.textContent = `scale ${this.viewport.scaleX.toFixed(3)} | offset ${this.viewport.ox.toFixed(0)},${this.viewport.oy.toFixed(0)} | hud pointer ${pointerText}`;
  }
}

class HudViewportPanel {
  public readonly runtime = new EcsRuntime();
  public readonly world: World;

  private readonly viewport = new HudViewport(DESIGN_SIZE, "contain", true);
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvasView: ICanvas;
  private readonly renderSystem: RenderSystem;
  private readonly panelEntity: HudViewportPanelEntity;

  constructor(canvasId: string, metaId: string, internalWidth: number, internalHeight: number) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) {
      throw new Error(`Missing canvas #${canvasId}`);
    }

    const meta = document.getElementById(metaId);
    if (!meta) {
      throw new Error(`Missing meta node #${metaId}`);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable");
    }

    this.canvas = canvas;
    this.ctx = ctx;
    this.canvas.width = internalWidth;
    this.canvas.height = internalHeight;

    this.canvasView = {
      context: this.ctx,
      size: new Vector2D(this.canvas.width, this.canvas.height),
    };

    const camera = EcsRuntime.runWith(this.runtime, () => {
      const entity = new CameraEntity();
      entity.awake();
      return entity;
    });

    this.renderSystem = new RenderSystem(this.canvasView, camera, this.runtime, this.viewport);

    this.panelEntity = EcsRuntime.runWith(this.runtime, () => {
      const entity = new HudViewportPanelEntity(meta, this.canvas, this.viewport);
      entity.awake();
      return entity;
    });

    this.canvas.addEventListener("mousemove", (event) => {
      this.panelEntity.state.pointerClient = new Vector2D(event.clientX, event.clientY);
    });
    this.canvas.addEventListener("mouseleave", () => {
      this.panelEntity.state.pointerClient = null;
    });

    this.world = new World({ runtime: this.runtime, fixedDeltaTime: 1 / 120, maxSubSteps: 8 });

    this.world.addSystem({
      phase: SystemPhase.Simulation,
      tickMode: SystemTickMode.Frame,
      update: (dt) => {
        this.panelEntity.state.time += dt;
      },
    });

    this.world.addSystem({
      phase: SystemPhase.Render,
      tickMode: SystemTickMode.Frame,
      update: () => {
        const sky = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        sky.addColorStop(0, "#182230");
        sky.addColorStop(1, "#0b111a");
        this.ctx.fillStyle = sky;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.renderSystem.render();
      },
    });
  }

  public step(dt: number): void {
    this.world.step(dt);
  }
}

const panels = [
  new HudViewportPanel("wide-canvas", "wide-meta", 1280, 720),
  new HudViewportPanel("square-canvas", "square-meta", 900, 900),
];

const appRuntime = new EcsRuntime();
const appWorld = new World({ runtime: appRuntime, fixedDeltaTime: 1 / 120, maxSubSteps: 8 });

appWorld.addSystem({
  phase: SystemPhase.Simulation,
  tickMode: SystemTickMode.Frame,
  update: (dt) => {
    for (const panel of panels) {
      panel.step(dt);
    }
  },
});

new WorldLoop(appWorld);
