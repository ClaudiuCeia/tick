import type { EcsRuntime } from "../ecs/EcsRuntime.ts";
import type { Entity, AbstractComponent } from "../ecs/Entity.ts";
import { HudDeckLayoutComponent } from "./HudDeckLayoutComponent.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { HudStackLayoutComponent } from "./HudStackLayoutComponent.ts";
import {
  insetRect,
  isFillSize,
  normalizeAnchor,
  resolveUiSize,
  type UiRect,
  type UiSize,
} from "./types.ts";

type Constructor<T> = AbstractComponent<T> | { new (...args: unknown[]): T };
type SizeRange = { min: number; max: number };

const EPS = 0.00001;

const getOptionalComponent = <C>(entity: Entity, constr: Constructor<C>): C | null => {
  if (!entity.hasComponent(constr)) return null;
  return entity.getComponent(constr as Constructor<unknown>) as unknown as C;
};

const resolveSizeRange = (
  minSpec: UiSize | undefined,
  maxSpec: UiSize | undefined,
  parentSize: number,
): SizeRange => {
  const min = minSpec === undefined ? 0 : resolveUiSize(minSpec, parentSize);
  const maxRaw =
    maxSpec === undefined ? Number.POSITIVE_INFINITY : resolveUiSize(maxSpec, parentSize);
  const max = maxRaw < min ? min : maxRaw;

  return { min, max };
};

const clampToRange = (value: number, range: SizeRange): number => {
  if (value < range.min) return range.min;
  if (value > range.max) return range.max;
  return value;
};

const resolveConstrainedSize = (spec: UiSize, parentSize: number, range: SizeRange): number => {
  const value = resolveUiSize(spec, parentSize);
  return clampToRange(value, range);
};

const resolveNodeFrameSize = (
  node: HudLayoutNodeComponent,
  parentBounds: UiRect,
): { width: number; height: number } => {
  const widthRange = resolveSizeRange(node.minWidth, node.maxWidth, parentBounds.width);
  const heightRange = resolveSizeRange(node.minHeight, node.maxHeight, parentBounds.height);

  return {
    width: resolveConstrainedSize(node.width, parentBounds.width, widthRange),
    height: resolveConstrainedSize(node.height, parentBounds.height, heightRange),
  };
};

const placeAnchored = (
  bounds: UiRect,
  width: number,
  height: number,
  node: HudLayoutNodeComponent,
): UiRect => {
  const anchor = normalizeAnchor(node.anchor);

  let x = bounds.x;
  let y = bounds.y;

  if (anchor.x === "center") {
    x = bounds.x + (bounds.width - width) / 2;
  } else if (anchor.x === "right") {
    x = bounds.x + bounds.width - width;
  }

  if (anchor.y === "center") {
    y = bounds.y + (bounds.height - height) / 2;
  } else if (anchor.y === "bottom") {
    y = bounds.y + bounds.height - height;
  }

  return {
    x: x + node.offset.x,
    y: y + node.offset.y,
    width,
    height,
  };
};

const sortByNodeOrder = (
  a: [Entity, HudLayoutNodeComponent],
  b: [Entity, HudLayoutNodeComponent],
): number => {
  if (a[1].order === b[1].order) {
    return a[0].id.localeCompare(b[0].id);
  }
  return a[1].order - b[1].order;
};

const layoutWithDeck = (
  containerRect: UiRect,
  container: HudDeckLayoutComponent,
  children: Entity[],
  explicitFrames: Map<string, UiRect>,
): void => {
  const target = insetRect(containerRect, container.padding);

  const childNodes = children
    .map((child) => {
      const node = getOptionalComponent(child, HudLayoutNodeComponent);
      return node ? ([child, node] as [Entity, HudLayoutNodeComponent]) : null;
    })
    .filter((item): item is [Entity, HudLayoutNodeComponent] => item !== null)
    .sort(sortByNodeOrder);

  for (const [child, node] of childNodes) {
    const { width, height } = resolveNodeFrameSize(node, target);
    explicitFrames.set(child.id, placeAnchored(target, width, height, node));
  }
};

const layoutWithStack = (
  containerRect: UiRect,
  container: HudStackLayoutComponent,
  children: Entity[],
  explicitFrames: Map<string, UiRect>,
): void => {
  const target = insetRect(containerRect, container.padding);

  const childNodes = children
    .map((child) => {
      const node = getOptionalComponent(child, HudLayoutNodeComponent);
      return node ? ([child, node] as [Entity, HudLayoutNodeComponent]) : null;
    })
    .filter((item): item is [Entity, HudLayoutNodeComponent] => item !== null)
    .sort(sortByNodeOrder);

  if (childNodes.length === 0) return;

  const isRow = container.direction === "row";
  const availableMain = isRow ? target.width : target.height;
  const totalGap = container.gap * Math.max(0, childNodes.length - 1);
  const crossSize = isRow ? target.height : target.width;

  const stackNodes = childNodes.map(([child, node]) => {
    const mainSpec = isRow ? node.width : node.height;
    const crossSpec = isRow ? node.height : node.width;

    const mainRange = isRow
      ? resolveSizeRange(node.minWidth, node.maxWidth, availableMain)
      : resolveSizeRange(node.minHeight, node.maxHeight, availableMain);

    const crossRange = isRow
      ? resolveSizeRange(node.minHeight, node.maxHeight, crossSize)
      : resolveSizeRange(node.minWidth, node.maxWidth, crossSize);

    return {
      child,
      node,
      mainSpec,
      crossSpec,
      mainRange,
      crossRange,
    };
  });

  const fillMain = new Map<string, number>();
  let fixedMain = 0;
  const fillItems: Array<(typeof stackNodes)[number]> = [];

  for (const item of stackNodes) {
    if (isFillSize(item.mainSpec)) {
      fillItems.push(item);
      continue;
    }
    fixedMain += resolveConstrainedSize(item.mainSpec, availableMain, item.mainRange);
  }

  const availableForFill = Math.max(0, availableMain - totalGap - fixedMain);
  if (fillItems.length > 0) {
    const totalMin = fillItems.reduce((sum, item) => sum + item.mainRange.min, 0);

    if (totalMin > availableForFill + EPS && totalMin > EPS) {
      const ratio = availableForFill / totalMin;
      for (const item of fillItems) {
        fillMain.set(item.child.id, item.mainRange.min * ratio);
      }
    } else {
      let remaining = availableForFill;
      for (const item of fillItems) {
        fillMain.set(item.child.id, item.mainRange.min);
        remaining -= item.mainRange.min;
      }

      let active = fillItems.filter(
        (item) => item.mainRange.max - (fillMain.get(item.child.id) ?? 0) > EPS,
      );

      while (remaining > EPS && active.length > 0) {
        const share = remaining / active.length;
        const nextActive: Array<(typeof stackNodes)[number]> = [];

        for (const item of active) {
          const current = fillMain.get(item.child.id) ?? 0;
          const capacity = item.mainRange.max - current;
          const delta = Math.min(share, capacity);
          fillMain.set(item.child.id, current + delta);
          remaining -= delta;

          if (capacity - delta > EPS) {
            nextActive.push(item);
          }
        }

        active = nextActive;
      }
    }
  }

  const totalMain =
    fixedMain +
    totalGap +
    fillItems.reduce((sum, item) => sum + (fillMain.get(item.child.id) ?? 0), 0);

  let cursor = isRow ? target.x : target.y;
  if (container.mainAlign === "center") {
    cursor += (availableMain - totalMain) / 2;
  } else if (container.mainAlign === "end") {
    cursor += availableMain - totalMain;
  }

  const crossStart = isRow ? target.y : target.x;

  for (const item of stackNodes) {
    const { child, node, mainSpec, crossSpec, mainRange, crossRange } = item;
    const mainSize = isFillSize(mainSpec)
      ? (fillMain.get(child.id) ?? 0)
      : resolveConstrainedSize(mainSpec, availableMain, mainRange);

    const rawCrossSize = resolveConstrainedSize(crossSpec, crossSize, crossRange);
    const resolvedCrossSize =
      container.crossAlign === "stretch" ? clampToRange(crossSize, crossRange) : rawCrossSize;

    let crossPos = crossStart;
    if (container.crossAlign === "center") {
      crossPos += (crossSize - resolvedCrossSize) / 2;
    } else if (container.crossAlign === "end") {
      crossPos += crossSize - resolvedCrossSize;
    }

    const frame: UiRect = isRow
      ? {
          x: cursor + node.offset.x,
          y: crossPos + node.offset.y,
          width: mainSize,
          height: resolvedCrossSize,
        }
      : {
          x: crossPos + node.offset.x,
          y: cursor + node.offset.y,
          width: resolvedCrossSize,
          height: mainSize,
        };

    explicitFrames.set(child.id, frame);
    cursor += mainSize + container.gap;
  }
};

const resolveEntityLayout = (
  entity: Entity,
  parentBounds: UiRect,
  explicitFrame: UiRect | null,
): void => {
  const node = getOptionalComponent(entity, HudLayoutNodeComponent);

  const ownBounds = node
    ? (() => {
        const { width, height } = resolveNodeFrameSize(node, parentBounds);
        const frame = explicitFrame ?? placeAnchored(parentBounds, width, height, node);
        node.setResolvedFrame(frame);
        return frame;
      })()
    : parentBounds;

  const children = entity.children.filter((child) => child.isAwake);
  const explicitFrames = new Map<string, UiRect>();

  if (node) {
    const stack = getOptionalComponent(entity, HudStackLayoutComponent);
    if (stack) {
      layoutWithStack(ownBounds, stack, children, explicitFrames);
    } else {
      const deck = getOptionalComponent(entity, HudDeckLayoutComponent);
      if (deck) {
        layoutWithDeck(ownBounds, deck, children, explicitFrames);
      }
    }
  }

  for (const child of children) {
    const childNode = getOptionalComponent(child, HudLayoutNodeComponent);
    if (childNode) {
      childNode.clearResolvedFrame();
    }
  }

  for (const child of children) {
    resolveEntityLayout(child, ownBounds, explicitFrames.get(child.id) ?? null);
  }
};

export const resolveHudLayout = (runtime: EcsRuntime, bounds: UiRect): void => {
  const roots = runtime.registry
    .getAllEntities()
    .filter((entity) => entity.isAwake && entity.parent === null);

  for (const root of roots) {
    resolveEntityLayout(root, bounds, null);
  }
};
