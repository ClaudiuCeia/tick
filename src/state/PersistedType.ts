export type PersistableClass = Function & {
  readonly type?: unknown;
};

export function getPersistedType(klass: PersistableClass, kind: "entity" | "component"): string {
  const type = klass.type;
  if (typeof type !== "string") {
    const className = klass.name && klass.name.length > 0 ? klass.name : "<anonymous>";
    throw new Error(
      `Missing static type on ${kind} class ${className}. ` +
        `Persisted ${kind} classes must define 'static type: string'.`,
    );
  }

  const normalized = type.trim();
  if (normalized.length === 0) {
    const className = klass.name && klass.name.length > 0 ? klass.name : "<anonymous>";
    throw new Error(
      `Invalid static type on ${kind} class ${className}. ` +
        `Persisted ${kind} classes must define a non-empty 'static type'.`,
    );
  }
  if (normalized.includes(":")) {
    const className = klass.name && klass.name.length > 0 ? klass.name : "<anonymous>";
    throw new Error(
      `Invalid static type on ${kind} class ${className}. Persisted types must not contain ':'.`,
    );
  }

  return normalized;
}

export function normalizePersistedType(type: string, kind: "entity" | "component"): string {
  const normalized = type.trim();
  if (normalized.length === 0 || normalized.includes(":")) {
    throw new Error(
      `Invalid persisted ${kind} type '${type}'. Types must be non-empty without ':'.`,
    );
  }
  return normalized;
}
