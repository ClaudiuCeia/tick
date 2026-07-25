import type { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { EcsRuntime as Runtime } from "../ecs/EcsRuntime.ts";
import type { Component } from "../ecs/Component.ts";
import { Entity } from "../ecs/Entity.ts";
import { RefAtom } from "./RefAtom.ts";
import { getPersistedType } from "./PersistedType.ts";
import { PersistenceRegistry } from "./PersistenceRegistry.ts";
import type { RefToken, RestoreError, RestoreResult, Snapshot } from "./types.ts";

export type LoadOptions = {
  strict?: boolean;
};

export type LoadResult = RestoreResult;

class SnapshotLoadError extends Error {
  public constructor(public readonly restoreError: RestoreError) {
    super(restoreError.message);
  }
}

export class PersistenceLoader {
  public constructor(private readonly registry: PersistenceRegistry) {}

  public loadIntoRuntime(
    snapshot: Snapshot,
    runtime: EcsRuntime,
    options: LoadOptions = {},
  ): LoadResult {
    const payloadValidation = runtime.store.validate(snapshot, { strict: options.strict });
    if (!payloadValidation.ok) return payloadValidation;

    const errors = this.validateGraph(snapshot);
    if (errors.length > 0) {
      return { ok: false, errors };
    }

    const previousStoreState = runtime.store._captureState();
    const stagingRuntime = new Runtime();
    const sidToEntity = new Map<string, Entity>();
    const sidToRuntimeId = new Map<string, string>();
    const loadedEntities = new Set<Entity>();
    let loadedAtoms = new Map<string, unknown>();
    let refKeys = new Set<string>();

    try {
      Runtime.runWith(stagingRuntime, () => {
        for (const node of snapshot.entities) {
          const factory = this.registry.getEntityFactory(node.type)!;
          const entity = factory(node) as Entity;
          if (!this.isEntity(entity)) {
            throw new Error(`Factory for '${node.type}' did not return an Entity.`);
          }
          const actualType = getPersistedType(
            entity.constructor as Function & { type?: unknown },
            "entity",
          );
          if (actualType !== node.type) {
            throw new Error(
              `Factory for entity type '${node.type}' returned persisted type '${actualType}'.`,
            );
          }
          if (
            entity.runtime !== stagingRuntime ||
            stagingRuntime.registry.getEntityById(entity.id) !== entity ||
            loadedEntities.has(entity)
          ) {
            throw new Error(`Factory for '${node.type}' did not create a new runtime Entity.`);
          }
          loadedEntities.add(entity);
          sidToEntity.set(node.sid, entity);
          sidToRuntimeId.set(node.sid, entity.id);
        }

        this.reconstructComponents(snapshot, sidToEntity, options.strict === true);
        if (options.strict) this.validateStrictAtoms(snapshot, sidToEntity);
      });

      for (const entity of stagingRuntime.registry.getAllEntities()) {
        if (!loadedEntities.has(entity)) {
          throw new Error("A persistence factory created an entity outside the snapshot graph.");
        }
      }
      for (const entity of loadedEntities) {
        if (entity.isAwake) {
          throw new Error(`Factory for '${entity.constructor.name}' returned an awake Entity.`);
        }
      }

      for (const node of snapshot.entities) {
        if (!node.parentSid) continue;
        sidToEntity.get(node.parentSid)!.addChild(sidToEntity.get(node.sid)!);
      }

      loadedAtoms = new Map<string, unknown>();
      refKeys = new Set<string>();
      const constructedState = stagingRuntime.store._captureState();
      const runtimeIds = new Set(sidToRuntimeId.values());
      for (const key of constructedState.persistentKeys) {
        const separator = key.indexOf(":");
        if (separator < 0 || !runtimeIds.has(key.slice(0, separator))) continue;
        loadedAtoms.set(key, constructedState.atoms.get(key));
        if (constructedState.refKeys.has(key)) refKeys.add(key);
      }
      for (const [key, value] of Object.entries(snapshot.atoms)) {
        const parsed = this.parseSnapshotAtomKey(key);
        const runtimeId = sidToRuntimeId.get(parsed.sid)!;
        const mappedKey = `${runtimeId}:${parsed.componentType}:${parsed.atomName}`;
        let resolvedValue: unknown = value;

        if (this.isRefToken(value)) {
          resolvedValue = this.resolveToken(value, sidToEntity, key);
        }
        if (this.isRefToken(value) || stagingRuntime.store._isRefKey(mappedKey)) {
          refKeys.add(mappedKey);
        }
        loadedAtoms.set(mappedKey, resolvedValue);
      }

      stagingRuntime.store._replaceLoadedState(snapshot, loadedAtoms, sidToRuntimeId, refKeys);
      for (const entity of loadedEntities) Entity.prepareRuntimeAdoption(entity);
    } catch (error) {
      try {
        stagingRuntime.dispose();
      } finally {
        // Restores target-store writes made through captured handles. Arbitrary captured object
        // mutations remain outside the transactional factory contract.
        runtime.store._restoreState(previousStoreState);
      }
      const restoreError =
        error instanceof SnapshotLoadError
          ? error.restoreError
          : {
              code: "invalid_payload" as const,
              message: error instanceof Error ? error.message : "Failed to load snapshot.",
            };
      return { ok: false, errors: [restoreError] };
    }

    // No staged entity is visible while old hooks run, and their store mutations are discarded.
    runtime._destroyAllEntitiesGuaranteed();
    for (const entity of loadedEntities) Entity.adoptRuntime(entity, runtime);
    runtime.store._replaceLoadedState(snapshot, loadedAtoms, sidToRuntimeId, refKeys);
    for (const entity of loadedEntities) Entity.rebindStoreHandles(entity);
    stagingRuntime.dispose();
    return { ok: true, errors: [] };
  }

  private reconstructComponents(
    snapshot: Snapshot,
    sidToEntity: Map<string, Entity>,
    strict: boolean,
  ): void {
    const required = new Map<string, Map<string, boolean>>();
    for (const node of snapshot.entities) {
      const types = required.get(node.sid) ?? new Map<string, boolean>();
      for (const componentType of node.components ?? []) types.set(componentType, true);
      required.set(node.sid, types);
    }
    for (const key of Object.keys(snapshot.atoms)) {
      const parsed = this.parseSnapshotAtomKey(key);
      const types = required.get(parsed.sid) ?? new Map<string, boolean>();
      if (!types.has(parsed.componentType)) types.set(parsed.componentType, false);
      required.set(parsed.sid, types);
    }

    for (const [sid, componentTypes] of required) {
      const entity = sidToEntity.get(sid)!;
      for (const [componentType, declared] of componentTypes) {
        if (this.findComponent(entity, componentType)) continue;

        const factory = this.registry.getComponentFactory(componentType);
        if (factory) {
          const node = snapshot.entities.find((candidate) => candidate.sid === sid)!;
          const component = factory(node) as Component;
          if (!this.isComponent(component)) {
            throw new Error(`Factory for '${componentType}' did not return a Component.`);
          }
          if (component.entity) {
            throw new Error(`Factory for '${componentType}' returned an attached Component.`);
          }
          const actualType = getPersistedType(
            component.constructor as Function & { type?: unknown },
            "component",
          );
          if (actualType !== componentType) {
            throw new Error(
              `Factory for component type '${componentType}' returned persisted type '${actualType}'.`,
            );
          }
          entity.addComponent(component);
          continue;
        }

        if (strict || declared) {
          throw new SnapshotLoadError({
            code: "unknown_type",
            message: `Unknown component type '${componentType}' on entity '${sid}'.`,
            path: `atoms.${sid}:${componentType}`,
          });
        }
      }
    }
  }

  private validateStrictAtoms(snapshot: Snapshot, sidToEntity: Map<string, Entity>): void {
    for (const [key, value] of Object.entries(snapshot.atoms)) {
      const { sid, componentType, atomName } = this.parseSnapshotAtomKey(key);
      const component = this.findComponent(sidToEntity.get(sid)!, componentType);
      if (!component) continue;

      const handle = component._getStoreHandle(atomName);
      if (!handle) {
        throw new SnapshotLoadError({
          code: "invalid_payload",
          message: `Unknown atom '${atomName}' on component '${componentType}'.`,
          path: key,
        });
      }

      const isRefHandle = handle instanceof RefAtom;
      const hasWrongKind = isRefHandle
        ? value !== null && !this.isRefToken(value)
        : this.isRefToken(value);
      if (hasWrongKind) {
        throw new SnapshotLoadError({
          code: "invalid_payload",
          message: `Atom '${key}' has the wrong persisted value kind.`,
          path: key,
        });
      }
    }
  }

  private parseSnapshotAtomKey(snapshotKey: string): {
    sid: string;
    componentType: string;
    atomName: string;
  } {
    const firstSep = snapshotKey.indexOf(":");
    const secondSep = snapshotKey.indexOf(":", firstSep + 1);
    if (
      firstSep <= 0 ||
      secondSep <= firstSep + 1 ||
      secondSep >= snapshotKey.length - 1 ||
      snapshotKey.indexOf(":", secondSep + 1) !== -1
    ) {
      throw new SnapshotLoadError({
        code: "invalid_payload",
        message: `Invalid atom key format '${snapshotKey}'.`,
        path: snapshotKey,
      });
    }

    return {
      sid: snapshotKey.slice(0, firstSep),
      componentType: snapshotKey.slice(firstSep + 1, secondSep),
      atomName: snapshotKey.slice(secondSep + 1),
    };
  }

  private resolveToken(token: RefToken, sidToEntity: Map<string, Entity>, path: string): unknown {
    const ref = token.$ref;
    if (ref.kind === "entity") {
      const entity = sidToEntity.get(ref.sid);
      if (entity) return entity;
      throw new SnapshotLoadError({
        code: "dangling_ref",
        message: `Dangling entity ref '${ref.sid}'.`,
        path,
      });
    }

    const entity = sidToEntity.get(ref.entitySid);
    if (!entity) {
      throw new SnapshotLoadError({
        code: "dangling_ref",
        message: `Dangling component ref entity '${ref.entitySid}'.`,
        path,
      });
    }

    const component = this.findComponent(entity, ref.componentType);
    if (component) return component;
    throw new SnapshotLoadError({
      code: "dangling_ref",
      message: `Dangling component ref '${ref.componentType}' on entity '${ref.entitySid}'.`,
      path,
    });
  }

  private validateGraph(snapshot: Snapshot): RestoreError[] {
    const errors: RestoreError[] = [];
    const sidSet = new Set<string>();
    const parentBySid = new Map<string, string | null>();

    for (const node of snapshot.entities) {
      if (
        !node ||
        typeof node !== "object" ||
        typeof node.sid !== "string" ||
        node.sid.length === 0 ||
        typeof node.type !== "string" ||
        node.type.length === 0 ||
        (node.parentSid !== null && typeof node.parentSid !== "string")
      ) {
        errors.push({ code: "invalid_payload", message: "Invalid entity node in snapshot." });
        continue;
      }
      if (
        node.sid.includes(":") ||
        node.type.includes(":") ||
        node.parentSid?.includes(":") ||
        node.sid.trim() !== node.sid ||
        node.type.trim() !== node.type ||
        node.components?.some(
          (type) => type.length === 0 || type.includes(":") || type.trim() !== type,
        )
      ) {
        errors.push({
          code: "invalid_payload",
          message: `Entity '${node.sid}' contains an invalid persisted identifier.`,
          path: `entities.${node.sid}`,
        });
      }
      if (node.components && new Set(node.components).size !== node.components.length) {
        errors.push({
          code: "invalid_payload",
          message: `Entity '${node.sid}' contains duplicate component types.`,
          path: `entities.${node.sid}.components`,
        });
      }
      if (sidSet.has(node.sid)) {
        errors.push({
          code: "duplicate_sid",
          message: `Duplicate sid '${node.sid}' in snapshot.`,
          path: `entities.${node.sid}`,
        });
      }
      sidSet.add(node.sid);
      parentBySid.set(node.sid, node.parentSid);

      if (!this.registry.getEntityFactory(node.type)) {
        errors.push({
          code: "unknown_type",
          message: `Unknown entity type '${node.type}'.`,
          path: `entities.${node.sid}.type`,
        });
      }
    }

    if (snapshot.entities.length === 0) {
      if (snapshot.rootSid !== "") {
        errors.push({
          code: "invalid_payload",
          message: `Root sid '${snapshot.rootSid}' does not exist in the snapshot.`,
          path: "rootSid",
        });
      }
    } else if (!sidSet.has(snapshot.rootSid)) {
      errors.push({
        code: "invalid_payload",
        message: `Root sid '${snapshot.rootSid}' does not exist in the snapshot.`,
        path: "rootSid",
      });
    }
    if (snapshot.rootSid.includes(":")) {
      errors.push({
        code: "invalid_payload",
        message: `Root sid '${snapshot.rootSid}' contains ':'.`,
        path: "rootSid",
      });
    }

    for (const node of snapshot.entities) {
      if (node.parentSid && !sidSet.has(node.parentSid)) {
        errors.push({
          code: "missing_parent",
          message: `Missing parent '${node.parentSid}' for '${node.sid}'.`,
          path: `entities.${node.sid}.parentSid`,
        });
      }
    }

    const state = new Map<string, 0 | 1 | 2>();
    const reachesRoot = new Map<string, boolean>();
    const walk = (sid: string): boolean => {
      const current = state.get(sid) ?? 0;
      if (current === 1) {
        throw new SnapshotLoadError({
          code: "parent_cycle",
          message: `Parent cycle detected at '${sid}'.`,
          path: `entities.${sid}.parentSid`,
        });
      }
      if (current === 2) return reachesRoot.get(sid) ?? false;

      state.set(sid, 1);
      const parentSid = parentBySid.get(sid);
      const parentConnected = !!parentSid && sidSet.has(parentSid) && walk(parentSid);
      const connected = sid === snapshot.rootSid || parentConnected;
      state.set(sid, 2);
      reachesRoot.set(sid, connected);
      return connected;
    };

    try {
      for (const sid of sidSet) {
        if (!walk(sid)) {
          errors.push({
            code: "invalid_payload",
            message: `Entity '${sid}' is not connected to root '${snapshot.rootSid}'.`,
            path: `entities.${sid}.parentSid`,
          });
        }
      }
    } catch (error) {
      if (error instanceof SnapshotLoadError) errors.push(error.restoreError);
      else throw error;
    }

    if (sidSet.has(snapshot.rootSid) && parentBySid.get(snapshot.rootSid) !== null) {
      errors.push({
        code: "invalid_payload",
        message: `Root entity '${snapshot.rootSid}' must not have a parent.`,
        path: `entities.${snapshot.rootSid}.parentSid`,
      });
    }

    for (const key of Object.keys(snapshot.atoms)) {
      try {
        const { sid } = this.parseSnapshotAtomKey(key);
        if (!sidSet.has(sid)) {
          errors.push({
            code: "invalid_payload",
            message: `Unknown sid '${sid}' in atom key '${key}'.`,
            path: key,
          });
        }
      } catch (error) {
        if (error instanceof SnapshotLoadError) errors.push(error.restoreError);
        else throw error;
      }
    }

    for (const [key, value] of Object.entries(snapshot.atoms)) {
      if (!this.isRefToken(value)) continue;
      const ref = value.$ref;
      const ids = ref.kind === "entity" ? [ref.sid] : [ref.entitySid, ref.componentType];
      if (ids.some((id) => typeof id !== "string" || id.length === 0 || id.includes(":"))) {
        errors.push({
          code: "invalid_payload",
          message: `Reference '${key}' contains an invalid persisted identifier.`,
          path: key,
        });
      }
    }

    return errors;
  }

  private findComponent(entity: Entity, type: string): Component | undefined {
    return entity.components.find((component) => {
      const ctor = component.constructor as Function & { type?: unknown };
      return ctor.type === type;
    });
  }

  private isRefToken(value: unknown): value is RefToken {
    if (!value || typeof value !== "object") return false;
    const ref = (value as { $ref?: { kind?: unknown } }).$ref;
    return ref?.kind === "entity" || ref?.kind === "component";
  }

  private isEntity(value: unknown): value is Entity {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<Entity>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.addChild === "function" &&
      typeof candidate.destroy === "function"
    );
  }

  private isComponent(value: unknown): value is Component {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<Component>;
    return typeof candidate._bindStoreHandles === "function";
  }
}
