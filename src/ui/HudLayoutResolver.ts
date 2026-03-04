import type { EcsRuntime } from "../ecs/EcsRuntime.ts";
import type { Entity, AbstractComponent } from "../ecs/Entity.ts";
import { HudDeckLayoutComponent } from "./HudDeckLayoutComponent.ts";
import { HudLayoutNodeComponent } from "./HudLayoutNodeComponent.ts";
import { HudStackLayoutComponent } from "./HudStackLayoutComponent.ts";
import { insetRect, isFillSize, normalizeAnchor, resolveUiSize, type UiRect } from "./types.ts";

type Constructor<T> = AbstractComponent<T> | { new (...args: unknown[]): T };

const getOptionalComponent = <C>(entity: Entity, constr: Constructor<C>): C | null => {
  if (!entity.hasComponent(constr)) return null;
  return entity.getComponent(constr as Constructor<unknown>) as unknown as C;
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
    const width = resolveUiSize(node.width, target.width);
    const height = resolveUiSize(node.height, target.height);
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

  let fixedMain = 0;
  let fillMainCount = 0;

  for (const [, node] of childNodes) {
    const mainSpec = isRow ? node.width : node.height;
    if (isFillSize(mainSpec)) {
      fillMainCount++;
      continue;
    }
    fixedMain += resolveUiSize(mainSpec, availableMain);
  }

  const remaining = Math.max(0, availableMain - totalGap - fixedMain);
  const fillMainSize = fillMainCount > 0 ? remaining / fillMainCount : 0;
  const totalMain = fixedMain + fillMainSize * fillMainCount + totalGap;

  let cursor = isRow ? target.x : target.y;
  if (container.mainAlign === "center") {
    cursor += (availableMain - totalMain) / 2;
  } else if (container.mainAlign === "end") {
    cursor += availableMain - totalMain;
  }

  const crossStart = isRow ? target.y : target.x;
  const crossSize = isRow ? target.height : target.width;

  for (const [child, node] of childNodes) {
    const mainSpec = isRow ? node.width : node.height;
    const mainSize = isFillSize(mainSpec) ? fillMainSize : resolveUiSize(mainSpec, availableMain);

    const rawCrossSize = resolveUiSize(isRow ? node.height : node.width, crossSize);
    const resolvedCrossSize = container.crossAlign === "stretch" ? crossSize : rawCrossSize;

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
        const width = resolveUiSize(node.width, parentBounds.width);
        const height = resolveUiSize(node.height, parentBounds.height);
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
