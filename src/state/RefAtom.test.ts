import { describe, expect, test } from "bun:test";
import { RefAtom } from "./RefAtom.ts";
import { StateStore } from "./StateStore.ts";

describe("RefAtom", () => {
  test("returns default reference", () => {
    const target = { id: "t-1" };
    const ref = new RefAtom("target", target);
    expect(ref.get()).toBe(target);
  });

  test("set updates reference and supports null", () => {
    const ref = new RefAtom<{ id: string } | null>("target", null);
    const target = { id: "t-2" };

    ref.set(target);
    expect(ref.get()).toBe(target);

    ref.set(null);
    expect(ref.get()).toBeNull();
  });

  test("bind and unbind update internal bound state", () => {
    const ref = new RefAtom<{ id: string } | null>("target", null);
    const store = new StateStore();

    expect(ref._isBound).toBe(false);
    ref._bind(store, "e1:targeting:target");
    expect(ref._isBound).toBe(true);
    expect(store.getAtomValue("e1:targeting:target")).toBeNull();
    ref._unbind();
    expect(ref._isBound).toBe(false);
  });

  test("retains the current reference when unbound", () => {
    const first = { id: "t-1" };
    const second = { id: "t-2" };
    const ref = new RefAtom<{ id: string } | null>("target", null);
    const store = new StateStore();
    ref._bind(store, "e1:targeting:target");
    ref.set(first);

    ref._unbind();
    store.setAtomValue("e1:targeting:target", second);

    expect(ref.get()).toBe(first);
  });
});
