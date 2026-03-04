import {
  EcsRuntime,
  Entity,
  HudDeckLayoutComponent,
  HudInputComponent,
  type HudInputEvent,
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
  type UiRect,
} from "../../index.ts";
import { WorldLoop } from "../shared/WorldLoop.ts";

const DESIGN_SIZE = new Vector2D(1920, 1080);

type DemoState = {
  t: number;
  pointerHud: Vector2D | null;
  hoveredAbility: number | null;
  selectedAbility: number | null;
  hp: number;
  mp: number;
  gold: number;
  objectiveTimer: number;
};

type PaintFn = (ctx: CanvasRenderingContext2D, frame: UiRect, state: DemoState) => void;

class CameraEntity extends Entity implements ICamera {
  public toCanvas(worldPos: Vector2D): Vector2D {
    return worldPos;
  }
}

class HudNodeEntity extends Entity {}

class PaintHudComponent extends HudRenderComponent<HudNodeEntity> {
  constructor(
    private readonly readState: () => DemoState,
    private readonly paint: PaintFn,
  ) {
    super(RenderLayer.HUD);
  }

  public override doRender(
    ctx: CanvasRenderingContext2D,
    _camera: ICamera,
    _canvasSize: Vector2D,
  ): void {
    const node = this.ent.getComponent(HudLayoutNodeComponent);
    const frame = node.getFrame();
    if (!frame) return;

    this.paint(ctx, frame, this.readState());
  }
}

class AbilitySlotInputComponent extends HudInputComponent<HudNodeEntity> {
  constructor(
    private readonly slotIndex: number,
    private readonly state: DemoState,
  ) {
    super();
    this.focusable = true;
    this.priority = 20;
  }

  protected override onPointerEnter(): void {
    this.state.hoveredAbility = this.slotIndex;
  }

  protected override onPointerLeave(): void {
    if (this.state.hoveredAbility === this.slotIndex) {
      this.state.hoveredAbility = null;
    }
  }

  protected override onPointerDown(event: HudInputEvent): void {
    this.state.hoveredAbility = this.slotIndex;
    this.state.selectedAbility = this.slotIndex;
    event.stopPropagation();
  }

  protected override onTouchStart(event: HudInputEvent): void {
    this.state.hoveredAbility = this.slotIndex;
    this.state.selectedAbility = this.slotIndex;
    event.stopPropagation();
  }

  protected override onKeyDown(event: HudInputEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      this.state.selectedAbility = this.slotIndex;
      this.state.hoveredAbility = this.slotIndex;
      event.stopPropagation();
    }
  }
}

class AbilityBarInputComponent extends HudInputComponent<HudNodeEntity> {
  constructor(private readonly state: DemoState) {
    super();
    this.priority = -5;
  }

  protected override onPointerDown(): void {
    this.state.hoveredAbility = null;
    this.state.selectedAbility = null;
  }
}

class GlobalHudKeyboardInputComponent extends HudInputComponent<HudNodeEntity> {
  constructor(
    private readonly state: DemoState,
    private readonly keys: readonly string[],
  ) {
    super();
    this.keyboardMode = "global";
    this.priority = -10;
  }

  protected override onKeyDown(event: HudInputEvent): void {
    const key = event.key?.toLowerCase() ?? "";
    const hit = this.keys.findIndex((entry) => entry.toLowerCase() === key);
    if (hit !== -1) {
      this.state.selectedAbility = hit;
      this.state.hoveredAbility = hit;
      event.stopPropagation();
      return;
    }

    if (key === "escape") {
      this.state.selectedAbility = null;
      this.state.hoveredAbility = null;
    }
  }
}

const rectPath = (ctx: CanvasRenderingContext2D, frame: UiRect, radius: number): void => {
  ctx.beginPath();
  const r = Math.max(0, Math.min(radius, Math.min(frame.width, frame.height) / 2));
  ctx.moveTo(frame.x + r, frame.y);
  ctx.lineTo(frame.x + frame.width - r, frame.y);
  ctx.arcTo(frame.x + frame.width, frame.y, frame.x + frame.width, frame.y + r, r);
  ctx.lineTo(frame.x + frame.width, frame.y + frame.height - r);
  ctx.arcTo(
    frame.x + frame.width,
    frame.y + frame.height,
    frame.x + frame.width - r,
    frame.y + frame.height,
    r,
  );
  ctx.lineTo(frame.x + r, frame.y + frame.height);
  ctx.arcTo(frame.x, frame.y + frame.height, frame.x, frame.y + frame.height - r, r);
  ctx.lineTo(frame.x, frame.y + r);
  ctx.arcTo(frame.x, frame.y, frame.x + r, frame.y, r);
  ctx.closePath();
};

const fillRounded = (
  ctx: CanvasRenderingContext2D,
  frame: UiRect,
  radius: number,
  fillStyle: string,
): void => {
  ctx.fillStyle = fillStyle;
  rectPath(ctx, frame, radius);
  ctx.fill();
};

const strokeRounded = (
  ctx: CanvasRenderingContext2D,
  frame: UiRect,
  radius: number,
  strokeStyle: string,
  lineWidth = 2,
): void => {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  rectPath(ctx, frame, radius);
  ctx.stroke();
};

const canvas = document.getElementById("hud-canvas") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error("Missing #hud-canvas");
}

const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("2D canvas context unavailable");
}

const runtime = new EcsRuntime();
runtime.input.init(window);

const canvasView: ICanvas = {
  context: ctx,
  size: new Vector2D(1, 1),
};

const hudViewport = new HudViewport(DESIGN_SIZE, "contain", true);
const camera = new CameraEntity();
camera.awake();
const renderSystem = new RenderSystem(canvasView, camera, runtime, hudViewport);

const state: DemoState = {
  t: 0,
  pointerHud: null,
  hoveredAbility: null,
  selectedAbility: null,
  hp: 0.84,
  mp: 0.72,
  gold: 420,
  objectiveTimer: 240,
};

const ABILITY_DEFS = [
  { key: "Q", label: "Volley", accent: "#7ecbff" },
  { key: "W", label: "Dash", accent: "#81f2b6" },
  { key: "E", label: "Trap", accent: "#f9d46c" },
  { key: "R", label: "Tempest", accent: "#ff8ca8" },
  { key: "D", label: "Relic", accent: "#b79fff" },
] as const;

const hudRefs = EcsRuntime.runWith(runtime, () => {
  const rootNode = new HudNodeEntity();
  rootNode.addComponent(
    new HudLayoutNodeComponent({ width: DESIGN_SIZE.x, height: DESIGN_SIZE.y, anchor: "top-left" }),
  );
  rootNode.addComponent(new HudDeckLayoutComponent());
  rootNode.addComponent(
    new GlobalHudKeyboardInputComponent(
      state,
      ABILITY_DEFS.map((entry) => entry.key),
    ),
  );

  const makeNode = (
    parent: Entity,
    options: ConstructorParameters<typeof HudLayoutNodeComponent>[0],
    paint?: PaintFn,
  ): HudNodeEntity => {
    const entity = new HudNodeEntity();
    entity.addComponent(new HudLayoutNodeComponent(options));
    if (paint) {
      entity.addComponent(new PaintHudComponent(() => state, paint));
    }
    parent.addChild(entity);
    return entity;
  };

  const topLeft = makeNode(
    rootNode,
    { width: 420, height: 188, anchor: "top-left", offset: { x: 24, y: 24 } },
    (c, frame) => {
      fillRounded(c, frame, 14, "rgba(12, 18, 31, 0.78)");
      strokeRounded(c, frame, 14, "rgba(110, 166, 255, 0.45)");
    },
  );
  topLeft.addComponent(new HudDeckLayoutComponent({ padding: 10 }));

  makeNode(
    topLeft,
    { width: 250, height: 66, anchor: "top-right", offset: { x: -12, y: 8 } },
    (c, frame, s) => {
      c.fillStyle = "#ecf4ff";
      c.font = '600 28px "Rajdhani", sans-serif';
      c.textBaseline = "top";
      c.textAlign = "left";
      c.fillText("Aria Windstrider", frame.x, frame.y);
      c.fillStyle = "#97b7de";
      c.font = '500 20px "Rajdhani", sans-serif';
      c.fillText("Lv. 18 Ranger", frame.x, frame.y + 26);
      c.fillStyle = "#f4cf7b";
      c.fillText(`Gold ${Math.floor(s.gold)}`, frame.x + 156, frame.y + 26);
    },
  );

  makeNode(
    topLeft,
    { width: 112, height: 112, anchor: "center-left", offset: { x: 8, y: 0 } },
    (c, frame) => {
      const cx = frame.x + frame.width / 2;
      const cy = frame.y + frame.height / 2;
      c.fillStyle = "#2b3f62";
      c.beginPath();
      c.arc(cx, cy, 56, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#8cc5ff";
      c.lineWidth = 4;
      c.beginPath();
      c.arc(cx, cy, 52, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#dff0ff";
      c.font = '700 48px "Rajdhani", sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("A", cx, cy + 2);
    },
  );

  const statColumn = makeNode(topLeft, {
    width: 250,
    height: 104,
    anchor: "bottom-right",
    offset: { x: -12, y: -10 },
  });
  statColumn.addComponent(
    new HudStackLayoutComponent({ direction: "column", gap: 7, crossAlign: "stretch" }),
  );

  makeNode(statColumn, { width: "fill", height: 30, order: 0 }, (c, frame, s) => {
    fillRounded(c, frame, 8, "rgba(30, 40, 60, 0.9)");
    fillRounded(
      c,
      {
        x: frame.x + 2,
        y: frame.y + 2,
        width: Math.max(0, (frame.width - 4) * s.hp),
        height: frame.height - 4,
      },
      7,
      "#e8617a",
    );
    c.fillStyle = "#ffeaf0";
    c.font = '600 17px "Rajdhani", sans-serif';
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText("HP", frame.x + 10, frame.y + frame.height / 2);
  });

  makeNode(statColumn, { width: "fill", height: 30, order: 1 }, (c, frame, s) => {
    fillRounded(c, frame, 8, "rgba(22, 33, 56, 0.92)");
    fillRounded(
      c,
      {
        x: frame.x + 2,
        y: frame.y + 2,
        width: Math.max(0, (frame.width - 4) * s.mp),
        height: frame.height - 4,
      },
      7,
      "#57a8ff",
    );
    c.fillStyle = "#eaf5ff";
    c.font = '600 17px "Rajdhani", sans-serif';
    c.textBaseline = "middle";
    c.fillText("MP", frame.x + 10, frame.y + frame.height / 2);
  });

  makeNode(statColumn, { width: "fill", height: 30, order: 2 }, (c, frame) => {
    fillRounded(c, frame, 8, "rgba(18, 26, 40, 0.9)");
    strokeRounded(c, frame, 8, "rgba(148, 184, 230, 0.38)");
    c.fillStyle = "#d8ebff";
    c.font = '600 17px "Rajdhani", sans-serif';
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText("XP 74%", frame.x + 10, frame.y + frame.height / 2);
  });

  const topCenter = makeNode(
    rootNode,
    {
      width: "27%",
      minWidth: 500,
      maxWidth: 620,
      height: 84,
      anchor: "top-center",
      offset: { x: 0, y: 18 },
    },
    (c, frame) => {
      fillRounded(c, frame, 12, "rgba(11, 18, 32, 0.74)");
      strokeRounded(c, frame, 12, "rgba(120, 172, 252, 0.35)");
    },
  );
  topCenter.addComponent(
    new HudStackLayoutComponent({
      direction: "row",
      gap: 12,
      padding: { top: 14, right: 16, bottom: 14, left: 16 },
      mainAlign: "center",
      crossAlign: "center",
    }),
  );

  const objectiveLabels = ["T1 East", "Dragon", "Baron"];
  for (const [i, text] of objectiveLabels.entries()) {
    makeNode(topCenter, { width: "fill", height: 52, order: i }, (c, frame) => {
      fillRounded(c, frame, 10, "rgba(30, 43, 66, 0.92)");
      strokeRounded(c, frame, 10, "rgba(160, 200, 255, 0.35)");
      c.fillStyle = "#ecf5ff";
      c.font = '600 22px "Rajdhani", sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(text, frame.x + frame.width / 2, frame.y + frame.height / 2 + 1);
    });
  }

  const topRight = makeNode(
    rootNode,
    { width: 312, height: 312, anchor: "top-right", offset: { x: -24, y: 24 } },
    (c, frame, s) => {
      fillRounded(c, frame, 14, "rgba(10, 16, 28, 0.78)");
      strokeRounded(c, frame, 14, "rgba(108, 160, 244, 0.45)");

      const pad = 14;
      const map = {
        x: frame.x + pad,
        y: frame.y + pad,
        width: frame.width - pad * 2,
        height: frame.height - pad * 2,
      };
      fillRounded(c, map, 10, "rgba(22, 36, 53, 0.95)");
      strokeRounded(c, map, 10, "rgba(130, 175, 236, 0.3)", 1.5);

      c.strokeStyle = "rgba(90, 125, 170, 0.3)";
      c.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        c.beginPath();
        c.moveTo(map.x + (map.width * i) / 4, map.y);
        c.lineTo(map.x + (map.width * i) / 4, map.y + map.height);
        c.stroke();
        c.beginPath();
        c.moveTo(map.x, map.y + (map.height * i) / 4);
        c.lineTo(map.x + map.width, map.y + (map.height * i) / 4);
        c.stroke();
      }

      const pulse = 0.5 + Math.sin(s.t * 4.3) * 0.5;
      const pingX = map.x + map.width * (0.32 + Math.sin(s.t * 0.6) * 0.08);
      const pingY = map.y + map.height * (0.64 + Math.cos(s.t * 0.55) * 0.06);
      c.fillStyle = "rgba(255, 124, 124, 0.95)";
      c.beginPath();
      c.arc(pingX, pingY, 4, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = `rgba(255, 124, 124, ${0.2 + pulse * 0.5})`;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(pingX, pingY, 14 + pulse * 20, 0, Math.PI * 2);
      c.stroke();

      c.fillStyle = "#ddecff";
      c.font = '700 20px "Rajdhani", sans-serif';
      c.textAlign = "left";
      c.textBaseline = "top";
      c.fillText("MINIMAP", frame.x + 16, frame.y + 8);
    },
  );
  topRight.addComponent(new HudDeckLayoutComponent({ padding: 8 }));

  const bottomLeft = makeNode(
    rootNode,
    { width: 320, height: 172, anchor: "bottom-left", offset: { x: 24, y: -24 } },
    (c, frame) => {
      fillRounded(c, frame, 14, "rgba(10, 16, 27, 0.8)");
      strokeRounded(c, frame, 14, "rgba(112, 164, 248, 0.35)");
    },
  );
  bottomLeft.addComponent(
    new HudStackLayoutComponent({
      direction: "column",
      gap: 8,
      padding: { top: 14, right: 14, bottom: 14, left: 14 },
      crossAlign: "stretch",
    }),
  );

  const quickRows = ["Ward +3", "Potion x2", "Elixir ready", "Recall 7.8s"];
  for (const [i, text] of quickRows.entries()) {
    makeNode(bottomLeft, { width: "fill", height: 30, order: i }, (c, frame) => {
      fillRounded(c, frame, 7, "rgba(24, 36, 55, 0.92)");
      c.fillStyle = "#d8ebff";
      c.font = '600 20px "Rajdhani", sans-serif';
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillText(text, frame.x + 10, frame.y + frame.height / 2 + 1);
    });
  }

  const abilityRoot = makeNode(
    rootNode,
    {
      width: "58.3333%",
      minWidth: 980,
      maxWidth: 1220,
      height: 232,
      anchor: "bottom-center",
      offset: { x: 0, y: -20 },
    },
    (c, frame) => {
      fillRounded(c, frame, 20, "rgba(8, 12, 20, 0.84)");
      strokeRounded(c, frame, 20, "rgba(110, 162, 246, 0.34)", 2);
    },
  );
  abilityRoot.addComponent(new HudDeckLayoutComponent({ padding: 12 }));

  makeNode(
    abilityRoot,
    { width: "60%", height: 26, anchor: "top-center", offset: { x: 0, y: 8 } },
    (c, frame, s) => {
      fillRounded(c, frame, 8, "rgba(22, 31, 46, 0.9)");
      const ratio = 1 - (s.objectiveTimer % 240) / 240;
      fillRounded(
        c,
        {
          x: frame.x + 2,
          y: frame.y + 2,
          width: (frame.width - 4) * ratio,
          height: frame.height - 4,
        },
        6,
        "#6ce2b2",
      );
      c.fillStyle = "#e6fff3";
      c.font = '600 18px "Rajdhani", sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(
        `Objective in ${Math.ceil(s.objectiveTimer)}s`,
        frame.x + frame.width / 2,
        frame.y + frame.height / 2 + 1,
      );
    },
  );

  const abilityRow = makeNode(abilityRoot, {
    width: "95%",
    height: 152,
    anchor: "bottom-center",
    offset: { x: 0, y: -8 },
  });
  abilityRow.addComponent(
    new HudStackLayoutComponent({
      direction: "row",
      gap: 12,
      mainAlign: "center",
      crossAlign: "center",
    }),
  );

  for (const [i, ability] of ABILITY_DEFS.entries()) {
    const key = ability.key;
    const label = ability.label;
    const accent = ability.accent;

    const slot = makeNode(abilityRow, {
      width: "fill",
      minWidth: 180,
      maxWidth: 240,
      height: 148,
      order: i,
    });
    slot.addComponent(new HudDeckLayoutComponent({ padding: 6 }));
    slot.addComponent(new AbilitySlotInputComponent(i, state));

    makeNode(slot, { width: "fill", height: "fill", anchor: "center" }, (c, frame, s) => {
      const hovered = s.hoveredAbility === i || s.selectedAbility === i;

      fillRounded(c, frame, 10, hovered ? "rgba(30, 51, 77, 0.96)" : "rgba(20, 33, 52, 0.92)");
      strokeRounded(
        c,
        frame,
        10,
        hovered ? "rgba(163, 216, 255, 0.85)" : "rgba(117, 165, 239, 0.42)",
        hovered ? 3 : 2,
      );

      c.fillStyle = hovered ? "#f1f8ff" : "#d6e9ff";
      c.font = '600 18px "Rajdhani", sans-serif';
      c.textAlign = "center";
      c.textBaseline = "top";
      c.fillText(label, frame.x + frame.width / 2, frame.y + 8);
    });

    makeNode(slot, { width: "70%", height: "66%", anchor: "center" }, (c, frame) => {
      fillRounded(c, frame, 8, "rgba(10, 17, 29, 0.95)");
      c.fillStyle = accent;
      c.globalAlpha = 0.18;
      c.beginPath();
      c.arc(frame.x + frame.width / 2, frame.y + frame.height / 2, 42, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = accent;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(frame.x + frame.width / 2, frame.y + frame.height / 2, 32, 0, Math.PI * 2);
      c.stroke();
    });

    const overlayDeck = makeNode(slot, {
      width: "70%",
      height: "66%",
      anchor: "center",
    });
    overlayDeck.addComponent(new HudDeckLayoutComponent({ padding: 4 }));

    makeNode(
      overlayDeck,
      { width: 30, height: 20, anchor: "top-right", offset: { x: -4, y: 4 } },
      (c, frame) => {
        fillRounded(c, frame, 6, "rgba(12, 18, 30, 0.86)");
        strokeRounded(c, frame, 6, "rgba(155, 198, 255, 0.36)", 1.5);
        c.fillStyle = "#dcedff";
        c.font = '700 14px "Rajdhani", sans-serif';
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(`${i + 1}`, frame.x + frame.width / 2, frame.y + frame.height / 2 + 1);
      },
    );

    makeNode(
      slot,
      { width: "34%", height: 24, anchor: "bottom-center", offset: { x: 0, y: -6 } },
      (c, frame) => {
        fillRounded(c, frame, 7, "rgba(14, 22, 36, 0.88)");
        strokeRounded(c, frame, 7, "rgba(127, 175, 247, 0.34)", 1.5);
        c.fillStyle = "#eaf5ff";
        c.font = '700 20px "Rajdhani", sans-serif';
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(key, frame.x + frame.width / 2, frame.y + frame.height / 2 + 1);
      },
    );
  }

  const tooltip = makeNode(
    rootNode,
    { width: 360, height: 64, anchor: "bottom-center", offset: { x: 0, y: -264 } },
    (c, frame, s) => {
      const activeIndex = s.hoveredAbility ?? s.selectedAbility;
      if (activeIndex === null) return;

      fillRounded(c, frame, 10, "rgba(9, 14, 22, 0.88)");
      strokeRounded(c, frame, 10, "rgba(136, 189, 255, 0.5)", 2);
      c.fillStyle = "#f2f8ff";
      c.font = '600 24px "Rajdhani", sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      const active = ABILITY_DEFS[activeIndex];
      if (!active) return;
      c.fillText(
        `Ability ${active.key} - ${active.label}`,
        frame.x + frame.width / 2,
        frame.y + 24,
      );
      c.fillStyle = "#a9c6e8";
      c.font = '500 18px "Rajdhani", sans-serif';
      c.fillText("Nested deck/stack slot layout", frame.x + frame.width / 2, frame.y + 46);
    },
  );
  tooltip.addComponent(new HudDeckLayoutComponent());
  const tooltipNode = tooltip.getComponent(HudLayoutNodeComponent);
  tooltipNode.setInteractive(false);
  tooltipNode.setVisible(false);

  abilityRoot.addComponent(new AbilityBarInputComponent(state));

  rootNode.awake();

  return { tooltipNode };
});

const drawBackdrop = (c: CanvasRenderingContext2D, width: number, height: number): void => {
  const sky = c.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#0d1524");
  sky.addColorStop(1, "#060a12");
  c.fillStyle = sky;
  c.fillRect(0, 0, width, height);

  c.strokeStyle = "rgba(82, 122, 170, 0.16)";
  c.lineWidth = 1;
  const spacing = 52;

  for (let x = 0; x <= width; x += spacing) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, height);
    c.stroke();
  }

  for (let y = 0; y <= height; y += spacing) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(width, y);
    c.stroke();
  }
};

let pointerInside = false;

canvas.addEventListener("mouseenter", () => {
  pointerInside = true;
});

canvas.addEventListener("mouseleave", () => {
  pointerInside = false;
});

const resizeCanvas = (): void => {
  const width = Math.max(1, Math.floor(window.innerWidth));
  const height = Math.max(1, Math.floor(window.innerHeight));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvasView.size.set(width, height);
};

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

const world = new World({ runtime, fixedDeltaTime: 1 / 120, maxSubSteps: 8 });

world.addSystem({
  phase: SystemPhase.Input,
  tickMode: SystemTickMode.Frame,
  update() {
    if (pointerInside) {
      state.pointerHud = hudViewport.clientToHud(runtime.input.getMousePos(), canvas);
    } else {
      state.pointerHud = null;
      if (state.selectedAbility === null) {
        state.hoveredAbility = null;
      }
    }

    hudRefs.tooltipNode.setVisible(state.hoveredAbility !== null || state.selectedAbility !== null);
  },
});

world.addSystem({
  phase: SystemPhase.Simulation,
  tickMode: SystemTickMode.Frame,
  update(dt) {
    state.t += dt;
    state.hp = 0.82 + Math.sin(state.t * 0.5) * 0.09;
    state.mp = 0.74 + Math.cos(state.t * 0.35) * 0.08;
    state.gold +=
      dt * (state.hoveredAbility === null && state.selectedAbility === null ? 1.2 : 2.1);
    state.objectiveTimer = (state.objectiveTimer - dt + 240) % 240 || 240;
  },
});

world.addSystem({
  phase: SystemPhase.Render,
  tickMode: SystemTickMode.Frame,
  update() {
    drawBackdrop(ctx, canvas.width, canvas.height);
    renderSystem.render();

    if (state.pointerHud) {
      const pointer = hudViewport.hudToScreen(state.pointerHud);
      ctx.fillStyle = "rgba(182, 223, 255, 0.86)";
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    runtime.input.clearFrame();
  },
});

new WorldLoop(world);
