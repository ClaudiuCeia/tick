import { describe, test, expect, beforeEach } from "bun:test";
import { Entity } from "./Entity.ts";
import { EcsRuntime } from "./EcsRuntime.ts";
import { EntityRegistry } from "./EntityRegistry.ts";

class Alpha extends Entity {}
class Beta extends Entity {}
class AlphaChild extends Alpha {}

const registry = () => EcsRuntime.getCurrent().registry;

beforeEach(() => {
  EcsRuntime.reset();
});

describe("EntityRegistry — registration", () => {
  test("entities are registered on construction", () => {
    const e = new Alpha();
    expect(registry().getEntityById(e.id)).toBe(e);
  });

  test("count increments on registration", () => {
    expect(registry().count).toBe(0);
    new Alpha();
    new Alpha();
    expect(registry().count).toBe(2);
  });

  test("registering the same id twice is a no-op", () => {
    const e = new Alpha();
    registry().register(e); // second call
    expect(registry().count).toBe(1);
  });

  test("unregister removes entity", () => {
    const e = new Alpha();
    registry().unregister(e);
    expect(registry().getEntityById(e.id)).toBeUndefined();
    expect(registry().count).toBe(0);
  });

  test("unregistering unknown entity is a no-op", () => {
    const e = new Alpha();
    registry().unregister(e);
    expect(() => registry().unregister(e)).not.toThrow();
  });
});

describe("EntityRegistry — queries", () => {
  test("getEntityById returns entity", () => {
    const e = new Beta();
    expect(registry().getEntityById(e.id)).toBe(e);
  });

  test("getEntityById returns undefined for unknown id", () => {
    expect(registry().getEntityById("no-such-id")).toBeUndefined();
  });

  test("getEntitiesByType returns entities of that type", () => {
    const a1 = new Alpha();
    const a2 = new Alpha();
    new Beta(); // should not appear
    const result = registry().getEntitiesByType(Alpha);
    expect(result).toHaveLength(2);
    expect(result).toContain(a1);
    expect(result).toContain(a2);
  });

  test("getEntitiesByType returns empty array when none", () => {
    new Beta();
    expect(registry().getEntitiesByType(Alpha)).toHaveLength(0);
  });

  test("type queries include subclasses even when exact instances exist", () => {
    const exact = new Alpha();
    const child = new AlphaChild();

    expect(registry().getEntitiesByType(Alpha)).toEqual([exact, child]);
    expect(registry().getFirstEntityByType(Alpha)).toBe(exact);
  });

  test("getFirstEntityByType returns one entity", () => {
    new Alpha();
    new Alpha();
    const result = registry().getFirstEntityByType(Alpha);
    expect(result).toBeInstanceOf(Alpha);
  });

  test("getFirstEntityByType returns null when none", () => {
    expect(registry().getFirstEntityByType(Alpha)).toBeNull();
  });

  test("getAllEntities returns all registered entities", () => {
    const a = new Alpha();
    const b = new Beta();
    const all = registry().getAllEntities();
    expect(all).toContain(a);
    expect(all).toContain(b);
  });

  test("findEntities filters by predicate", () => {
    new Alpha();
    const b = new Beta();
    const result = registry().findEntities((e) => e instanceof Beta);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(b);
  });
});

describe("EntityRegistry — type cache consistency", () => {
  test("type cache updated after unregister", () => {
    const a = new Alpha();
    registry().unregister(a);
    expect(registry().getEntitiesByType(Alpha)).toHaveLength(0);
  });

  test("type cache entry removed when last entity of type is unregistered", () => {
    const a = new Alpha();
    registry().unregister(a);
    // Should not throw, should return empty
    expect(registry().getEntitiesByType(Alpha)).toHaveLength(0);
  });

  test("clear() wipes both entity map and type cache", () => {
    new Alpha();
    new Beta();
    registry().clear();
    expect(registry().count).toBe(0);
    expect(registry().getEntitiesByType(Alpha)).toHaveLength(0);
    expect(registry().getFirstEntityByType(Beta)).toBeNull();
  });

  test("new entities register correctly after clear()", () => {
    new Alpha();
    registry().clear();
    const a2 = new Alpha();
    expect(registry().getEntityById(a2.id)).toBe(a2);
    expect(registry().getEntitiesByType(Alpha)).toHaveLength(1);
  });
});

describe("EntityRegistry — creation site tracking", () => {
  test("creation stack capture is disabled by default", () => {
    const e = new Alpha();
    expect(registry().getCreationSite(e.id)).toBeUndefined();
  });

  test("creation stack capture can be enabled and is cleared on unregister", () => {
    const tracedRegistry = new EntityRegistry({ captureCreationSites: true });
    const runtime = new EcsRuntime(tracedRegistry);
    const e = EcsRuntime.runWith(runtime, () => new Alpha());

    expect(typeof tracedRegistry.getCreationSite(e.id)).toBe("string");
    tracedRegistry.unregister(e);
    expect(tracedRegistry.getCreationSite(e.id)).toBeUndefined();
  });

  test("getCreationSite returns undefined for unknown id", () => {
    expect(registry().getCreationSite("nope")).toBeUndefined();
  });
});
