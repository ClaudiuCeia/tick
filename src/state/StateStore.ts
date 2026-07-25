import type { RestoreOptions, RestoreResult, Snapshot, SnapshotOptions } from "./types.ts";

type StateStoreState = {
  atoms: Map<string, unknown>;
  persistentKeys: Set<string>;
  refKeys: Set<string>;
  rootSid: string;
  entities: Snapshot["entities"];
  meta: Snapshot["meta"];
  sidToRuntimeId: Map<string, string>;
  runtimeIdToSid: Map<string, string>;
};

export class StateStore {
  private atoms = new Map<string, unknown>();
  private persistentKeys = new Set<string>();
  private refKeys = new Set<string>();
  private rootSid = "";
  private entities: Snapshot["entities"] = [];
  private meta: Snapshot["meta"] = undefined;
  private sidToRuntimeId = new Map<string, string>();
  private runtimeIdToSid = new Map<string, string>();

  public registerAtom(
    key: string,
    defaultValue: unknown,
    options: { persist?: boolean; ref?: boolean } = {},
  ): void {
    if (!this.atoms.has(key)) {
      this.atoms.set(key, defaultValue);
    }
    if (options.persist !== false) {
      this.persistentKeys.add(key);
    }
    if (options.ref) {
      this.refKeys.add(key);
    }
  }

  public setAtomValue(key: string, value: unknown): void {
    this.atoms.set(key, value);
  }

  public getAtomValue<T>(key: string): T | undefined {
    return this.atoms.get(key) as T | undefined;
  }

  public hasAtom(key: string): boolean {
    return this.atoms.has(key);
  }

  public _isRefKey(key: string): boolean {
    return this.refKeys.has(key);
  }

  public snapshot(options: SnapshotOptions = {}): Snapshot {
    const atoms: Record<string, unknown> = {};
    for (const key of this.persistentKeys) {
      if (this.atoms.has(key)) {
        const separator = key.indexOf(":");
        if (
          this.runtimeIdToSid.size > 0 &&
          separator >= 0 &&
          !this.runtimeIdToSid.has(key.slice(0, separator))
        ) {
          continue;
        }
        const snapshotKey = this.toSnapshotKey(key);
        const value = this.atoms.get(key);
        atoms[snapshotKey] = this.refKeys.has(key) ? this.encodeRef(value) : value;
      }
    }

    const rootSid = options.rootSid ?? this.rootSid;
    const entities = options.entities ?? this.entities;
    const sceneId = options.sceneId ?? this.meta?.sceneId;
    const createdAt = options.createdAt ?? this.meta?.createdAt;

    const snapshot: Snapshot = {
      version: 1,
      rootSid,
      meta: { sceneId, createdAt },
      entities: entities.map((node) => this.cloneNode(node)),
      atoms,
    };
    return snapshot;
  }

  public validate(snapshot: Snapshot, _options: RestoreOptions = {}): RestoreResult {
    if (!snapshot || typeof snapshot !== "object") {
      return {
        ok: false,
        errors: [{ code: "invalid_payload", message: "Snapshot payload must be an object." }],
      };
    }
    if (snapshot.version !== 1) {
      return {
        ok: false,
        errors: [
          {
            code: "unsupported_version",
            message: `Unsupported snapshot version: ${snapshot.version}`,
            path: "version",
          },
        ],
      };
    }

    if (typeof snapshot.rootSid !== "string" || !Array.isArray(snapshot.entities)) {
      return {
        ok: false,
        errors: [
          {
            code: "invalid_payload",
            message: "Snapshot rootSid and entities payload are invalid.",
          },
        ],
      };
    }

    if (
      typeof snapshot.atoms !== "object" ||
      snapshot.atoms === null ||
      Array.isArray(snapshot.atoms)
    ) {
      return {
        ok: false,
        errors: [
          {
            code: "invalid_payload",
            message: "Snapshot atoms payload must be an object.",
            path: "atoms",
          },
        ],
      };
    }

    if (
      snapshot.meta !== undefined &&
      (typeof snapshot.meta !== "object" || snapshot.meta === null || Array.isArray(snapshot.meta))
    ) {
      return {
        ok: false,
        errors: [
          {
            code: "invalid_payload",
            message: "Snapshot metadata payload must be an object.",
            path: "meta",
          },
        ],
      };
    }

    if (
      snapshot.entities.some(
        (node) =>
          !node ||
          typeof node !== "object" ||
          typeof node.sid !== "string" ||
          typeof node.type !== "string" ||
          (node.parentSid !== null && typeof node.parentSid !== "string") ||
          (node.components !== undefined &&
            (!Array.isArray(node.components) ||
              node.components.some((type) => typeof type !== "string"))),
      )
    ) {
      return {
        ok: false,
        errors: [
          {
            code: "invalid_payload",
            message: "Snapshot entities payload contains an invalid node.",
            path: "entities",
          },
        ],
      };
    }

    return { ok: true, errors: [] };
  }

  public restore(snapshot: Snapshot, options: RestoreOptions = {}): RestoreResult {
    const validation = this.validate(snapshot, options);
    if (!validation.ok) {
      return validation;
    }

    this.clear();
    this.rootSid = snapshot.rootSid;
    this.entities = snapshot.entities.map((node) => this.cloneNode(node));
    this.meta = snapshot.meta ? { ...snapshot.meta } : undefined;

    for (const [key, value] of Object.entries(snapshot.atoms)) {
      this.atoms.set(key, value);
      this.persistentKeys.add(key);
      if (this.isRefToken(value)) {
        this.refKeys.add(key);
      }
    }

    return { ok: true, errors: [] };
  }

  public clear(): void {
    this.atoms.clear();
    this.persistentKeys.clear();
    this.refKeys.clear();
    this.rootSid = "";
    this.entities = [];
    this.meta = undefined;
    this.sidToRuntimeId.clear();
    this.runtimeIdToSid.clear();
  }

  public _captureState(): StateStoreState {
    return {
      atoms: new Map(this.atoms),
      persistentKeys: new Set(this.persistentKeys),
      refKeys: new Set(this.refKeys),
      rootSid: this.rootSid,
      entities: this.entities.map((node) => this.cloneNode(node)),
      meta: this.meta ? { ...this.meta } : undefined,
      sidToRuntimeId: new Map(this.sidToRuntimeId),
      runtimeIdToSid: new Map(this.runtimeIdToSid),
    };
  }

  public _restoreState(state: StateStoreState): void {
    this.atoms = new Map(state.atoms);
    this.persistentKeys = new Set(state.persistentKeys);
    this.refKeys = new Set(state.refKeys);
    this.rootSid = state.rootSid;
    this.entities = state.entities.map((node) => this.cloneNode(node));
    this.meta = state.meta ? { ...state.meta } : undefined;
    this.sidToRuntimeId = new Map(state.sidToRuntimeId);
    this.runtimeIdToSid = new Map(state.runtimeIdToSid);
  }

  public _replaceLoadedState(
    snapshot: Snapshot,
    atoms: Map<string, unknown>,
    sidToRuntimeId: Map<string, string>,
    refKeys: Set<string>,
  ): void {
    this.clear();
    this.rootSid = snapshot.rootSid;
    this.entities = snapshot.entities.map((node) => this.cloneNode(node));
    this.meta = snapshot.meta ? { ...snapshot.meta } : undefined;
    this.sidToRuntimeId = new Map(sidToRuntimeId);
    this.runtimeIdToSid = new Map(
      Array.from(sidToRuntimeId, ([sid, runtimeId]) => [runtimeId, sid]),
    );

    for (const [key, value] of atoms) {
      this.atoms.set(key, value);
      this.persistentKeys.add(key);
    }
    this.refKeys = new Set(refKeys);
  }

  public _configureGraph(
    rootSid: string,
    entities: Snapshot["entities"],
    sidToRuntimeId: Map<string, string>,
    meta: Snapshot["meta"] = {},
  ): void {
    this.rootSid = rootSid;
    this.entities = entities.map((node) => this.cloneNode(node));
    this.meta = {
      sceneId: meta?.sceneId ?? this.meta?.sceneId,
      createdAt: meta?.createdAt ?? this.meta?.createdAt,
    };
    this.sidToRuntimeId = new Map(sidToRuntimeId);
    this.runtimeIdToSid = new Map(
      Array.from(sidToRuntimeId, ([sid, runtimeId]) => [runtimeId, sid]),
    );
  }

  public _getSidForRuntimeId(runtimeId: string): string | undefined {
    return this.runtimeIdToSid.get(runtimeId);
  }

  public _getEntityNode(sid: string): Snapshot["entities"][number] | undefined {
    const node = this.entities.find((candidate) => candidate.sid === sid);
    return node ? this.cloneNode(node) : undefined;
  }

  private toSnapshotKey(key: string): string {
    const separator = key.indexOf(":");
    if (separator < 0) return key;
    const runtimeId = key.slice(0, separator);
    const sid = this.runtimeIdToSid.get(runtimeId);
    return sid ? `${sid}${key.slice(separator)}` : key;
  }

  private encodeRef(value: unknown): unknown {
    if (value === null || this.isRefToken(value)) return value;
    if (!value || typeof value !== "object") return value;

    const entityId = (value as { id?: unknown }).id;
    if (typeof entityId === "string") {
      const sid = this.runtimeIdToSid.get(entityId);
      if (sid) return { $ref: { kind: "entity", sid } };
    }

    const entity = (value as { entity?: unknown }).entity;
    if (entity && typeof entity === "object") {
      const ownerId = (entity as { id?: unknown }).id;
      const componentType = (value.constructor as Function & { type?: unknown }).type;
      if (typeof ownerId === "string" && typeof componentType === "string") {
        const entitySid = this.runtimeIdToSid.get(ownerId);
        if (entitySid) {
          return { $ref: { kind: "component", entitySid, componentType } };
        }
      }
    }

    throw new Error(
      "RefAtom value does not reference an entity or component in the snapshot graph.",
    );
  }

  private isRefToken(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const ref = (value as { $ref?: { kind?: unknown } }).$ref;
    return ref?.kind === "entity" || ref?.kind === "component";
  }

  private cloneNode(node: Snapshot["entities"][number]): Snapshot["entities"][number] {
    return {
      ...node,
      ...(node.components ? { components: [...node.components] } : {}),
      ...(node.params ? { params: { ...node.params } } : {}),
    };
  }
}
