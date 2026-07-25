import type { StateStore } from "./StateStore.ts";

export class RefAtom<T extends object | null> {
  private value: T;
  private bound = false;
  private store: StateStore | null = null;
  private key: string | null = null;

  public constructor(
    public readonly name: string,
    defaultValue: T,
  ) {
    this.value = defaultValue;
  }

  public get(): T {
    if (this.store && this.key) {
      if (this.store.hasAtom(this.key)) return this.store.getAtomValue<T>(this.key) as T;
    }
    return this.value;
  }

  public set(value: T): void {
    if (this.store && this.key) {
      this.store.setAtomValue(this.key, value);
      return;
    }
    this.value = value;
  }

  public _bind(store: StateStore, key: string, persist = true): void {
    this.store = store;
    this.key = key;
    this.store.registerAtom(key, this.value, { persist, ref: true });
    this.bound = true;
  }

  public _unbind(): void {
    if (this.store && this.key && this.store.hasAtom(this.key)) {
      this.value = this.store.getAtomValue<T>(this.key) as T;
    }
    this.store = null;
    this.key = null;
    this.bound = false;
  }

  public get _isBound(): boolean {
    return this.bound;
  }
}
