import { describe, test, expect, beforeEach } from "bun:test";
import { Entity } from "./Entity.ts";
import { GarbageCollector } from "./GarbageCollector.ts";
import { EcsRuntime } from "./EcsRuntime.ts";

class GameRoot extends Entity {}
class ChildNode extends Entity {}
class OrphanNode extends Entity {}

function makeGc(): GarbageCollector {
  return GarbageCollector.get("GameRoot", EcsRuntime.getCurrent().registry);
}

beforeEach(() => {
  EcsRuntime.reset();
});

describe("GarbageCollector", () => {
  test("findOrphans returns empty when all entities reachable from root", () => {
    const root = new GameRoot();
    const child = new ChildNode();
    root.addChild(child);
    root.awake();

    const gc = makeGc();
    expect(gc.findOrphans()).toHaveLength(0);
  });

  test("findOrphans returns entities not in the live tree", () => {
    const root = new GameRoot();
    root.awake();

    // Create an entity that is registered but not a child of root
    const orphan = new OrphanNode();

    const gc = makeGc();
    const orphans = gc.findOrphans();
    expect(orphans).toContain(orphan);
  });

  test("findOrphans returns empty when root entity does not exist", () => {
    new ChildNode(); // no GameRoot in registry
    const gc = makeGc();
    expect(gc.findOrphans()).toHaveLength(0);
  });

  test("collect() destroys orphans and returns count", () => {
    const root = new GameRoot();
    root.awake();
    const orphan = new OrphanNode();

    const gc = makeGc();
    const count = gc.collect();
    expect(count).toBe(1);
    expect(EcsRuntime.getCurrent().registry.getEntityById(orphan.id)).toBeUndefined();
  });

  test("collect() returns 0 when no orphans", () => {
    const root = new GameRoot();
    root.awake();

    const gc = makeGc();
    expect(gc.collect()).toBe(0);
  });

  test("collect() does not destroy entities in live tree", () => {
    const root = new GameRoot();
    const child = new ChildNode();
    root.addChild(child);
    root.awake();

    const gc = makeGc();
    gc.collect();
    expect(EcsRuntime.getCurrent().registry.getEntityById(child.id)).toBe(child);
  });

  test("setRoot changes the root entity name", () => {
    const gc = makeGc();
    gc.setRoot("ChildNode");

    const root = new GameRoot();
    root.awake();
    const child = new ChildNode();
    root.addChild(child);
    child.awake();

    // With ChildNode as root, GameRoot is an orphan
    const orphans = gc.findOrphans();
    expect(orphans).toContain(root);
  });

  test("a collector without an explicit registry follows the current runtime", () => {
    const gc = GarbageCollector.get("GameRoot");
    const firstRoot = new GameRoot();
    firstRoot.awake();
    const firstOrphan = new OrphanNode();
    expect(gc.findOrphans()).toContain(firstOrphan);

    EcsRuntime.reset();
    const secondRoot = new GameRoot();
    secondRoot.awake();
    const secondOrphan = new OrphanNode();

    const orphans = gc.findOrphans();
    expect(orphans).toContain(secondOrphan);
    expect(orphans).not.toContain(firstOrphan);
  });

  test("collector configuration is not shared globally", () => {
    const gameCollector = GarbageCollector.get("GameRoot");
    const childCollector = GarbageCollector.get("ChildNode");

    expect(gameCollector.root).toBe("GameRoot");
    expect(childCollector.root).toBe("ChildNode");
  });
});
