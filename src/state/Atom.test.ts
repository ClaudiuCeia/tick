import { describe, expect, test } from "bun:test";
import { Atom } from "./Atom.ts";
import { StateStore } from "./StateStore.ts";

describe("Atom", () => {
  test("returns default value", () => {
    const atom = new Atom("hp", 100);
    expect(atom.get()).toBe(100);
  });

  test("set updates the value", () => {
    const atom = new Atom("hp", 100);
    atom.set(75);
    expect(atom.get()).toBe(75);
  });

  test("bind and unbind update internal bound state", () => {
    const atom = new Atom("hp", 100);
    const store = new StateStore();

    expect(atom._isBound).toBe(false);
    atom._bind(store, "e1:stats:hp");
    expect(atom._isBound).toBe(true);
    expect(store.getAtomValue<number>("e1:stats:hp")).toBe(100);
    atom._unbind();
    expect(atom._isBound).toBe(false);
  });

  test("uses a stored undefined value instead of the handle default", () => {
    const atom = new Atom<string | undefined>("label", "default");
    const store = new StateStore();
    atom._bind(store, "e1:stats:label");

    store.setAtomValue("e1:stats:label", undefined);

    expect(atom.get()).toBeUndefined();
  });

  test("retains the current store value when unbound", () => {
    const atom = new Atom("hp", 100);
    const store = new StateStore();
    atom._bind(store, "e1:stats:hp");
    atom.set(42);

    atom._unbind();
    store.setAtomValue("e1:stats:hp", 1);

    expect(atom.get()).toBe(42);
  });
});
