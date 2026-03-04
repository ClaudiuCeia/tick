export type UiRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type UiSize = number | `${number}%` | "fill";

export type UiAxisAlign = "start" | "center" | "end";

export type UiCrossAlign = UiAxisAlign | "stretch";

export type UiAnchorX = "left" | "center" | "right";

export type UiAnchorY = "top" | "center" | "bottom";

export type UiAnchorKeyword =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type UiAnchor = UiAnchorKeyword | { x: UiAnchorX; y: UiAnchorY };

export type UiInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type UiInsetsInput = number | Partial<UiInsets>;

export const normalizeAnchor = (anchor: UiAnchor = "top-left"): { x: UiAnchorX; y: UiAnchorY } => {
  if (typeof anchor !== "string") return anchor;

  switch (anchor) {
    case "top-left":
      return { x: "left", y: "top" };
    case "top-center":
      return { x: "center", y: "top" };
    case "top-right":
      return { x: "right", y: "top" };
    case "center-left":
      return { x: "left", y: "center" };
    case "center":
      return { x: "center", y: "center" };
    case "center-right":
      return { x: "right", y: "center" };
    case "bottom-left":
      return { x: "left", y: "bottom" };
    case "bottom-center":
      return { x: "center", y: "bottom" };
    case "bottom-right":
      return { x: "right", y: "bottom" };
  }
};

export const normalizeInsets = (value: UiInsetsInput = 0): UiInsets => {
  if (typeof value === "number") {
    return {
      top: value,
      right: value,
      bottom: value,
      left: value,
    };
  }

  return {
    top: value.top ?? 0,
    right: value.right ?? 0,
    bottom: value.bottom ?? 0,
    left: value.left ?? 0,
  };
};

export const insetRect = (rect: UiRect, insets: UiInsets): UiRect => {
  const width = Math.max(0, rect.width - insets.left - insets.right);
  const height = Math.max(0, rect.height - insets.top - insets.bottom);

  return {
    x: rect.x + insets.left,
    y: rect.y + insets.top,
    width,
    height,
  };
};

export const isFillSize = (value: UiSize): boolean => value === "fill";

export const resolveUiSize = (value: UiSize, parentSize: number): number => {
  if (value === "fill") return Math.max(0, parentSize);
  if (typeof value === "number") return Math.max(0, value);

  const trimmed = value.trim();
  const match = /^(-?\d+(?:\.\d+)?)%$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid UiSize percentage value: ${value}`);
  }

  const percent = Number(match[1]);
  if (!Number.isFinite(percent)) {
    throw new Error(`Invalid UiSize percentage value: ${value}`);
  }

  return Math.max(0, (parentSize * percent) / 100);
};
