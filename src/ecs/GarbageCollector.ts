import type { Entity } from "./Entity.ts";
import { EntityRegistry } from "./EntityRegistry.ts";
import { EcsRuntime } from "./EcsRuntime.ts";

/**
 * Detects and destroys orphaned entities — entities registered in the
 * EntityRegistry but no longer reachable from the root entity tree.
 *
 * Useful after operations that remove entities without properly calling
 * destroy(), or when transient objects are created and discarded.
 */
export class GarbageCollector {
  private constructor(
    public root = "Game",
    private registry?: EntityRegistry,
  ) {}

  public static get(root?: string, registry?: EntityRegistry): GarbageCollector {
    return new GarbageCollector(root, registry);
  }

  public setRoot(root: string): void {
    this.root = root;
  }

  public setRegistry(registry: EntityRegistry): void {
    this.registry = registry;
  }

  public findOrphans(): Entity[] {
    const all = this.getRegistry().getAllEntities();
    const root = all.find((e) => e.constructor.name === this.root);
    if (!root) return [];

    const seen = new Set<Entity>();

    function walk(e: Entity) {
      if (seen.has(e)) return;
      seen.add(e);
      for (const child of e.children ?? []) {
        walk(child);
      }
    }
    walk(root);

    return all.filter((e) => !seen.has(e));
  }

  /** Destroys all orphaned entities. Returns the count destroyed. */
  public collect(): number {
    const orphans = this.findOrphans();
    for (const orphan of orphans) {
      orphan.destroy();
    }
    return orphans.length;
  }

  private getRegistry(): EntityRegistry {
    return this.registry ?? EcsRuntime.getCurrent().registry;
  }
}
