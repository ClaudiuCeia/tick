import type { CollisionEntity } from "./CollisionEntity.ts";

type AABB = { x: number; y: number; width: number; height: number };

export type CollisionPair = [CollisionEntity, CollisionEntity];

const intersects = (a: AABB, b: AABB): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export class SpatialHashBroadphase {
  constructor(private readonly cellSize = 64) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error("SpatialHashBroadphase cellSize must be finite and > 0");
    }
  }

  public queryPairs(colliders: CollisionEntity[]): CollisionPair[] {
    const buckets = new Map<string, number[]>();
    const bounds: AABB[] = [];

    for (let i = 0; i < colliders.length; i++) {
      const collider = colliders[i]!;
      const bbox = collider.bbox();
      bounds[i] = bbox;
      const minX = Math.floor(bbox.x / this.cellSize);
      const maxX = Math.floor((bbox.x + bbox.width) / this.cellSize);
      const minY = Math.floor(bbox.y / this.cellSize);
      const maxY = Math.floor((bbox.y + bbox.height) / this.cellSize);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${x}:${y}`;
          const list = buckets.get(key);
          if (list) {
            list.push(i);
          } else {
            buckets.set(key, [i]);
          }
        }
      }
    }

    const pairs: CollisionPair[] = [];
    const seen = new Set<number>();

    for (const list of buckets.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const indexA = list[i]!;
          const indexB = list[j]!;
          const a = colliders[indexA]!;
          const b = colliders[indexB]!;
          if (!a.canCollideWith(b)) continue;

          const low = Math.min(indexA, indexB);
          const high = Math.max(indexA, indexB);
          const key = low * colliders.length + high;
          if (seen.has(key)) continue;

          if (!intersects(bounds[indexA]!, bounds[indexB]!)) continue;

          seen.add(key);
          pairs.push([colliders[low]!, colliders[high]!]);
        }
      }
    }

    return pairs;
  }
}
