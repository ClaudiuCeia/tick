export type RefToken =
  | { $ref: { kind: "entity"; sid: string } }
  | { $ref: { kind: "component"; entitySid: string; componentType: string } };

export type SnapshotEntityNode = {
  sid: string;
  type: string;
  parentSid: string | null;
  components?: string[];
  params?: Record<string, unknown>;
};

export type SnapshotV1 = {
  version: 1;
  meta?: {
    sceneId?: string;
    createdAt?: string;
  };
  rootSid: string;
  entities: SnapshotEntityNode[];
  atoms: Record<string, unknown>;
};

export type Snapshot = SnapshotV1;

export type RestoreErrorCode =
  | "unknown_type"
  | "duplicate_type_key"
  | "duplicate_sid"
  | "missing_parent"
  | "parent_cycle"
  | "dangling_ref"
  | "unsupported_version"
  | "migration_failed"
  | "invalid_payload";

export type RestoreError = {
  code: RestoreErrorCode;
  message: string;
  path?: string;
};

export type RestoreResult = { ok: true; errors: [] } | { ok: false; errors: RestoreError[] };

export type SnapshotOptions = {
  sceneId?: string;
  createdAt?: string;
  rootSid?: string;
  entities?: SnapshotEntityNode[];
};

export type RestoreOptions = {
  strict?: boolean;
};
