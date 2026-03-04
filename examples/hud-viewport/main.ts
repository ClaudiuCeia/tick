import { HudViewport, Vector2D } from "../../index.ts";

type DemoPanel = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  meta: HTMLElement;
  viewport: HudViewport;
  pointerClient: Vector2D | null;
};

const DESIGN_SIZE = new Vector2D(1920, 1080);

const createPanel = (
  canvasId: string,
  metaId: string,
  internalWidth: number,
  internalHeight: number,
): DemoPanel => {
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

  canvas.width = internalWidth;
  canvas.height = internalHeight;

  const viewport = new HudViewport(DESIGN_SIZE, "contain", true);
  viewport.setCanvasSize(new Vector2D(canvas.width, canvas.height));

  const panel: DemoPanel = {
    canvas,
    ctx,
    meta,
    viewport,
    pointerClient: null,
  };

  canvas.addEventListener("mousemove", (event) => {
    panel.pointerClient = new Vector2D(event.clientX, event.clientY);
  });
  canvas.addEventListener("mouseleave", () => {
    panel.pointerClient = null;
  });

  return panel;
};

const drawHud = (panel: DemoPanel, nowMs: number): void => {
  const { canvas, ctx, meta, viewport, pointerClient } = panel;
  viewport.setCanvasSize(new Vector2D(canvas.width, canvas.height));

  const pointerHud = pointerClient ? viewport.clientToHud(pointerClient, canvas) : null;

  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#182230");
  sky.addColorStop(1, "#0b111a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(126, 170, 227, 0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    viewport.ox,
    viewport.oy,
    DESIGN_SIZE.x * viewport.scaleX,
    DESIGN_SIZE.y * viewport.scaleY,
  );

  ctx.save();
  viewport.applyTo(ctx);

  const pulse = 12 + Math.sin(nowMs * 0.004) * 6;

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

  ctx.restore();

  const pointerText = pointerHud
    ? `${Math.round(pointerHud.x)}, ${Math.round(pointerHud.y)}`
    : "outside";
  meta.textContent = `scale ${viewport.scaleX.toFixed(3)} | offset ${viewport.ox.toFixed(0)},${viewport.oy.toFixed(0)} | hud pointer ${pointerText}`;
};

const panels: DemoPanel[] = [
  createPanel("wide-canvas", "wide-meta", 1280, 720),
  createPanel("square-canvas", "square-meta", 900, 900),
];

const frame = (nowMs: number): void => {
  for (const panel of panels) {
    drawHud(panel, nowMs);
  }
  requestAnimationFrame(frame);
};

requestAnimationFrame(frame);
