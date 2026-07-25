import { describe, expect, test } from "bun:test";
import { PersistenceRegistry } from "./PersistenceRegistry.ts";

describe("PersistenceRegistry", () => {
  test("registers and retrieves entity/component factories", () => {
    const registry = new PersistenceRegistry();
    const entityFactory = () => ({ kind: "entity" });
    const componentFactory = () => ({ kind: "component" });

    registry.registerEntity("player", entityFactory);
    registry.registerComponent("health", componentFactory);

    expect(registry.getEntityFactory("player")).toBe(entityFactory);
    expect(registry.getComponentFactory("health")).toBe(componentFactory);
  });

  test("throws on duplicate entity type", () => {
    const registry = new PersistenceRegistry();
    registry.registerEntity("player", () => ({}));

    expect(() => registry.registerEntity("player", () => ({}))).toThrow(
      "Duplicate persisted entity type: player",
    );
  });

  test("throws on duplicate component type", () => {
    const registry = new PersistenceRegistry();
    registry.registerComponent("health", () => ({}));

    expect(() => registry.registerComponent("health", () => ({}))).toThrow(
      "Duplicate persisted component type: health",
    );
  });

  test("registers factories using static type from classes", () => {
    class PlayerEntity {
      public static type = "player";
    }
    class HealthComponent {
      public static type = "health";
    }

    const registry = new PersistenceRegistry();
    const entityFactory = () => ({});
    const componentFactory = () => ({});

    registry.registerEntity(PlayerEntity, entityFactory);
    registry.registerComponent(HealthComponent, componentFactory);

    expect(registry.getEntityFactory("player")).toBe(entityFactory);
    expect(registry.getComponentFactory("health")).toBe(componentFactory);
  });

  test("throws when registering class without static type", () => {
    class PlayerEntity {}

    const registry = new PersistenceRegistry();
    expect(() => registry.registerEntity(PlayerEntity, () => ({}))).toThrow(
      "Missing static type on entity class PlayerEntity",
    );
  });

  test("throws when registering class with blank static type", () => {
    class HealthComponent {
      public static type = "  ";
    }

    const registry = new PersistenceRegistry();
    expect(() => registry.registerComponent(HealthComponent, () => ({}))).toThrow(
      "Invalid static type on component class HealthComponent",
    );
  });

  test("clear removes registered factories", () => {
    const registry = new PersistenceRegistry();
    registry.registerEntity("player", () => ({}));
    registry.registerComponent("health", () => ({}));

    registry.clear();

    expect(registry.getEntityFactory("player")).toBeUndefined();
    expect(registry.getComponentFactory("health")).toBeUndefined();
  });

  test("rejects persisted types containing the atom-key separator", () => {
    const registry = new PersistenceRegistry();

    expect(() => registry.registerEntity("bad:type", () => ({}))).toThrow("without ':'");
    expect(() => registry.registerComponent("bad:type", () => ({}))).toThrow("without ':'");
  });
});
