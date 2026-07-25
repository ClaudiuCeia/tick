import { describe, test, expect, beforeEach } from "bun:test";
import { Entity } from "./Entity.ts";
import { Component } from "./Component.ts";
import { EcsRuntime } from "./EcsRuntime.ts";

// --- test doubles ---

class NodeA extends Entity {}
class NodeB extends Entity {}

class CountingComponent extends Component {
  awakeCount = 0;
  updateCount = 0;
  destroyCount = 0;
  lastDt = 0;
  override awake() {
    this.awakeCount++;
  }
  override update(dt: number) {
    this.updateCount++;
    this.lastDt = dt;
  }
  override destroy() {
    this.destroyCount++;
  }
}

class AltComponent extends Component {
  updateCount = 0;
  override awake() {}
  override update(_dt: number) {
    this.updateCount++;
  }
}

class RemovingComponent extends Component {
  override update(): void {
    this.ent.removeComponent(AltComponent);
  }
}

class AddingChildComponent extends Component {
  child: NodeA | null = null;

  override update(): void {
    if (this.child) return;
    this.child = new NodeA();
    this.child.addComponent(new CountingComponent());
    this.ent.addChild(this.child);
  }
}

class BindingComponent extends Component {
  public static type = "binding";
  bindCount = 0;
  unbindCount = 0;
  hp = this.atom("hp", 100);

  override _bindStoreHandles(): void {
    super._bindStoreHandles();
    this.bindCount++;
  }

  override _unbindStoreHandles(): void {
    super._unbindStoreHandles();
    this.unbindCount++;
  }
}

class InvalidBindingComponent extends Component {
  hp = this.atom("hp", 100);
}

class FlakyAwakeComponent extends Component {
  awakeCount = 0;

  override awake(): void {
    this.awakeCount++;
    if (this.awakeCount === 1) {
      throw new Error("awake failed");
    }
  }
}

class FailingLazyComponent extends Component {
  public static type = "failing-lazy";
  awakeCount = 0;
  destroyCount = 0;
  hp = this.atom("hp", 100);

  override awake(): void {
    this.awakeCount++;
    throw new Error("lazy awake failed");
  }

  override destroy(): void {
    this.destroyCount++;
    throw new Error("lazy destroy failed");
  }
}

beforeEach(() => {
  EcsRuntime.reset();
});

// ---------------------------------------------------------------------------
describe("Entity — registration", () => {
  test("auto-registers with EntityRegistry on construction", () => {
    const e = new NodeA();
    expect(EcsRuntime.getCurrent().registry.getEntityById(e.id)).toBe(e);
  });

  test("each entity gets a unique id", () => {
    const a = new NodeA();
    const b = new NodeA();
    expect(a.id).not.toBe(b.id);
  });

  test("isAwake starts false", () => {
    expect(new NodeA().isAwake).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Entity — awake lifecycle", () => {
  test("awake() sets isAwake", () => {
    const e = new NodeA();
    e.awake();
    expect(e.isAwake).toBe(true);
  });

  test("awake() is idempotent — components awakened once", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);
    e.awake();
    e.awake();
    expect(c.awakeCount).toBe(1);
  });

  test("awake() propagates to components", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);
    e.awake();
    expect(c.awakeCount).toBe(1);
  });

  test("awake() propagates to children", () => {
    const parent = new NodeA();
    const child = new NodeB();
    parent.addChild(child);
    parent.awake();
    expect(child.isAwake).toBe(true);
  });

  test("awake() propagates to grandchildren", () => {
    const root = new NodeA();
    const mid = new NodeA();
    const leaf = new NodeA();
    root.addChild(mid);
    mid.addChild(leaf);
    root.awake();
    expect(leaf.isAwake).toBe(true);
  });

  test("addComponent on an awake entity immediately awakens the component", () => {
    const e = new NodeA();
    e.awake();
    const c = new CountingComponent();
    e.addComponent(c);
    expect(c.awakeCount).toBe(1);
  });

  test("addChild on an awake parent immediately awakens the child", () => {
    const parent = new NodeA();
    parent.awake();
    const child = new NodeB();
    parent.addChild(child);
    expect(child.isAwake).toBe(true);
  });

  test("awake retry resumes without rerunning successful component or child work", () => {
    const parent = new NodeA();
    const parentComponent = new CountingComponent();
    const successfulChild = new NodeA();
    const successfulChildComponent = new CountingComponent();
    const flakyChild = new NodeA();
    const successfulFlakyChildComponent = new CountingComponent();
    const flakyComponent = new FlakyAwakeComponent();
    parent.addComponent(parentComponent);
    successfulChild.addComponent(successfulChildComponent);
    flakyChild.addComponent(successfulFlakyChildComponent);
    flakyChild.addComponent(flakyComponent);
    parent.addChild(successfulChild);
    parent.addChild(flakyChild);

    expect(() => parent.awake()).toThrow("awake failed");
    expect(parent.isAwake).toBe(false);
    expect(flakyChild.isAwake).toBe(false);

    parent.awake();

    expect(parent.isAwake).toBe(true);
    expect(flakyChild.isAwake).toBe(true);
    expect(parentComponent.awakeCount).toBe(1);
    expect(successfulChildComponent.awakeCount).toBe(1);
    expect(successfulFlakyChildComponent.awakeCount).toBe(1);
    expect(flakyComponent.awakeCount).toBe(2);
  });

  test("failed lazy component awake atomically rolls back attachment", () => {
    const entity = new NodeA();
    const component = new FailingLazyComponent();
    entity.awake();

    expect(() => entity.addComponent(component)).toThrow("lazy awake failed");

    expect(component.awakeCount).toBe(1);
    expect(component.destroyCount).toBe(1);
    expect(component.entity).toBeUndefined();
    expect(component.hp._isBound).toBe(false);
    expect(entity.components).not.toContain(component);
    expect(entity.hasComponent(FailingLazyComponent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Entity — update", () => {
  test("update() propagates deltaTime to components", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);
    e.awake();
    e.update(0.016);
    expect(c.updateCount).toBe(1);
    expect(c.lastDt).toBeCloseTo(0.016);
  });

  test("update() propagates to children", () => {
    const parent = new NodeA();
    const child = new NodeA();
    const c = new CountingComponent();
    child.addComponent(c);
    parent.addChild(child);
    parent.awake();
    parent.update(1);
    expect(c.updateCount).toBe(1);
  });

  test("children added during component updates wait until the next update", () => {
    const parent = new NodeA();
    const adder = new AddingChildComponent();
    parent.addComponent(adder);
    parent.awake();

    parent.update(1);
    const childComponent = adder.child?.getComponent(CountingComponent);
    expect(childComponent?.updateCount).toBe(0);

    parent.update(1);
    expect(childComponent?.updateCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Entity — destroy", () => {
  test("destroy() sets isAwake false and _markForGc true", () => {
    const e = new NodeA();
    e.awake();
    e.destroy();
    expect(e.isAwake).toBe(false);
    expect(e._markForGc).toBe(true);
  });

  test("destroy() unregisters from EntityRegistry", () => {
    const e = new NodeA();
    e.awake();
    const id = e.id;
    e.destroy();
    expect(EcsRuntime.getCurrent().registry.getEntityById(id)).toBeUndefined();
  });

  test("destroy() calls component destroy", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);
    e.awake();
    e.destroy();
    expect(c.destroyCount).toBe(1);
  });

  test("destroy() unbinds component store handles", () => {
    const e = new NodeA();
    const c = new BindingComponent();
    e.addComponent(c);
    e.awake();

    e.destroy();

    expect(c.unbindCount).toBe(1);
    expect(c.hp._isBound).toBe(false);
  });

  test("destroy() propagates to children", () => {
    const parent = new NodeA();
    const child = new NodeA();
    const c = new CountingComponent();
    child.addComponent(c);
    parent.addChild(child);
    parent.awake();
    parent.destroy();
    expect(c.destroyCount).toBe(1);
  });

  test("destroy() unregisters children from EntityRegistry", () => {
    const parent = new NodeA();
    const child = new NodeA();
    parent.addChild(child);
    parent.awake();
    const childId = child.id;
    parent.destroy();
    expect(EcsRuntime.getCurrent().registry.getEntityById(childId)).toBeUndefined();
  });

  test("destroy() clears component list", () => {
    const e = new NodeA();
    e.addComponent(new CountingComponent());
    e.awake();
    e.destroy();
    expect(e.components).toHaveLength(0);
  });

  test("destroy() is idempotent and clears component and child indexes", () => {
    const e = new NodeA();
    const child = new NodeB();
    const component = new CountingComponent();
    e.addComponent(component);
    e.addChild(child);
    e.awake();

    e.destroy();
    e.destroy();

    expect(component.destroyCount).toBe(1);
    expect(e.hasComponent(CountingComponent)).toBe(false);
    expect(e.getChild(NodeB)).toBeNull();
    expect(e.getChildren(NodeB)).toEqual([]);
  });

  test("destroy() called directly removes entity from parent children list", () => {
    const parent = new NodeA();
    const child = new NodeA();
    parent.addChild(child);
    parent.awake();
    child.destroy();
    expect(parent.children).toHaveLength(0);
  });

  test("destroyed entities cannot be awakened or receive new attachments", () => {
    const entity = new NodeA();
    const child = new NodeB();
    entity.destroy();

    expect(() => entity.awake()).toThrow(/destroyed entity/i);
    expect(() => entity.addComponent(new CountingComponent())).toThrow(/destroyed entity/i);
    expect(() => entity.addChild(child)).toThrow(/destroyed entity/i);
    expect(() => child.addChild(entity)).toThrow(/destroyed entity/i);
  });
});

// ---------------------------------------------------------------------------
describe("Entity — components", () => {
  test("getComponent returns added component", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);
    expect(e.getComponent(CountingComponent)).toBe(c);
  });

  test("getComponent throws for missing component", () => {
    const e = new NodeA();
    expect(() => e.getComponent(CountingComponent)).toThrow();
  });

  test("hasComponent returns false before add", () => {
    expect(new NodeA().hasComponent(CountingComponent)).toBe(false);
  });

  test("hasComponent returns true after add", () => {
    const e = new NodeA();
    e.addComponent(new CountingComponent());
    expect(e.hasComponent(CountingComponent)).toBe(true);
  });

  test("addComponent throws on duplicate type", () => {
    const e = new NodeA();
    e.addComponent(new CountingComponent());
    expect(() => e.addComponent(new CountingComponent())).toThrow();
  });

  test("a component instance cannot be attached to multiple entities", () => {
    const first = new NodeA();
    const second = new NodeA();
    const component = new CountingComponent();
    first.addComponent(component);

    expect(() => second.addComponent(component)).toThrow(/already attached/i);
    expect(first.getComponent(CountingComponent)).toBe(component);
    expect(second.hasComponent(CountingComponent)).toBe(false);
  });

  test("addComponent sets component.entity", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);
    expect(c.entity).toBe(e);
  });

  test("addComponent binds store handles", () => {
    const e = new NodeA();
    const c = new BindingComponent();
    e.addComponent(c);

    expect(c.bindCount).toBe(1);
    expect(c.hp._isBound).toBe(true);
  });

  test("failed store-handle binding rolls back component attachment", () => {
    const e = new NodeA();
    const c = new InvalidBindingComponent();

    expect(() => e.addComponent(c)).toThrow(/Missing static type/);
    expect(c.entity).toBeUndefined();
    expect(c.hp._isBound).toBe(false);
    expect(e.components).not.toContain(c);
    expect(e.hasComponent(InvalidBindingComponent)).toBe(false);
  });

  test("removeComponent removes it from the entity", () => {
    const e = new NodeA();
    e.addComponent(new CountingComponent());
    e.removeComponent(CountingComponent);
    expect(e.hasComponent(CountingComponent)).toBe(false);
    expect(() => e.getComponent(CountingComponent)).toThrow();
  });

  test("removeComponent clears component.entity", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);
    e.removeComponent(CountingComponent);
    expect(c.entity).toBeUndefined();
  });

  test("removeComponent unbinds store handles", () => {
    const e = new NodeA();
    const c = new BindingComponent();
    e.addComponent(c);

    e.removeComponent(BindingComponent);

    expect(c.unbindCount).toBe(1);
    expect(c.hp._isBound).toBe(false);
  });

  test("removeComponent destroys exactly once and clears both component indexes", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);

    e.removeComponent(CountingComponent);
    e.removeComponent(CountingComponent);

    expect(c.destroyCount).toBe(1);
    expect(e.components).not.toContain(c);
    expect(e.hasComponent(CountingComponent)).toBe(false);
  });

  test("component removal during update does not update the removed component", () => {
    const e = new NodeA();
    const removed = new AltComponent();
    e.addComponent(new RemovingComponent());
    e.addComponent(removed);

    e.update(1);

    expect(removed.updateCount).toBe(0);
  });

  test("can add different component types", () => {
    const e = new NodeA();
    e.addComponent(new CountingComponent());
    e.addComponent(new AltComponent());
    expect(e.hasComponent(CountingComponent)).toBe(true);
    expect(e.hasComponent(AltComponent)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("Entity — children", () => {
  test("getChild returns first child of type", () => {
    const parent = new NodeA();
    const child = new NodeB();
    parent.addChild(child);
    expect(parent.getChild(NodeB)).toBe(child);
  });

  test("getChild returns null when no child of that type", () => {
    expect(new NodeA().getChild(NodeB)).toBeNull();
  });

  test("getChildren returns all children of type", () => {
    const parent = new NodeA();
    const b1 = new NodeB();
    const b2 = new NodeB();
    parent.addChild(b1);
    parent.addChild(b2);
    parent.addChild(new NodeA()); // different type
    const result = parent.getChildren(NodeB);
    expect(result).toHaveLength(2);
    expect(result).toContain(b1);
    expect(result).toContain(b2);
  });

  test("addChild sets child.parent", () => {
    const parent = new NodeA();
    const child = new NodeB();
    parent.addChild(child);
    expect(child.parent).toBe(parent);
  });

  test("addChild re-parents from old parent", () => {
    const p1 = new NodeA();
    const p2 = new NodeA();
    const child = new NodeB();
    p1.addChild(child);
    p2.addChild(child);
    expect(child.parent).toBe(p2);
    expect(p1.children).not.toContain(child);
    expect(p2.children).toContain(child);
  });

  test("re-parenting an awake child does not destroy it", () => {
    const p1 = new NodeA();
    const p2 = new NodeA();
    const child = new NodeB();
    const component = new CountingComponent();
    child.addComponent(component);
    p1.addChild(child);
    p1.awake();
    p2.awake();

    p2.addChild(child);

    expect(component.destroyCount).toBe(0);
    expect(child.isAwake).toBe(true);
    expect(EcsRuntime.getCurrent().registry.getEntityById(child.id)).toBe(child);
  });

  test("getChildById finds by id", () => {
    const parent = new NodeA();
    const child = new NodeB();
    parent.addChild(child);
    expect(parent.getChildById(child.id)).toBe(child);
  });

  test("getChildById returns null for unknown id", () => {
    expect(new NodeA().getChildById("nope")).toBeNull();
  });

  test("children getter returns live array", () => {
    const parent = new NodeA();
    parent.addChild(new NodeB());
    expect(parent.children).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("Entity — removeChild", () => {
  test("removeChild by entity removes from children", () => {
    const parent = new NodeA();
    const child = new NodeB();
    parent.addChild(child);
    parent.awake();
    parent.removeChild(child);
    expect(parent.children).toHaveLength(0);
    expect(parent.getChild(NodeB)).toBeNull();
  });

  test("removeChild by entity clears child.parent", () => {
    const parent = new NodeA();
    const child = new NodeB();
    parent.addChild(child);
    parent.awake();
    parent.removeChild(child);
    // child was awake → destroy() was called → _parent is null
    expect(child.parent).toBeNull();
  });

  test("removeChild by predicate removes matching children", () => {
    const parent = new NodeA();
    const b1 = new NodeB();
    const b2 = new NodeB();
    const a = new NodeA();
    parent.addChild(b1);
    parent.addChild(b2);
    parent.addChild(a);
    parent.awake();
    parent.removeChild((c) => c instanceof NodeB);
    // Only NodeA remains
    expect(parent.children).toHaveLength(1);
    expect(parent.getChild(NodeA)).toBe(a);
  });

  test("removeChild by predicate with no match is a no-op", () => {
    const parent = new NodeA();
    parent.addChild(new NodeB());
    parent.awake();
    expect(() =>
      parent.removeChild((c) => c instanceof NodeA /* no NodeA children */),
    ).not.toThrow();
    expect(parent.children).toHaveLength(1);
  });

  test("removeAllChildren removes all children", () => {
    const parent = new NodeA();
    parent.addChild(new NodeA());
    parent.addChild(new NodeB());
    parent.awake();
    parent.removeAllChildren();
    expect(parent.children).toHaveLength(0);
  });

  test("removing a non-awake child does not call destroy on it", () => {
    // Non-awake child: parent not yet awake, so child.awake() not called
    const parent = new NodeA();
    const child = new NodeB();
    const c = new CountingComponent();
    child.addComponent(c);
    parent.addChild(child);
    // parent is NOT awake, so child is not awake either
    parent.removeChild(child);
    expect(c.destroyCount).toBe(0); // destroy not called on non-awake child
  });
});

// ---------------------------------------------------------------------------
describe("Entity — hierarchy", () => {
  test("rejects self-parenting", () => {
    const entity = new NodeA();
    expect(() => entity.addChild(entity)).toThrow(/cycle/i);
    expect(entity.parent).toBeNull();
    expect(entity.children).toHaveLength(0);
  });

  test("rejects parenting an ancestor below its descendant", () => {
    const root = new NodeA();
    const child = new NodeA();
    const leaf = new NodeB();
    root.addChild(child);
    child.addChild(leaf);

    expect(() => leaf.addChild(root)).toThrow(/cycle/i);
    expect(child.parent).toBe(root);
    expect(leaf.parent).toBe(child);
  });

  test("getRoot returns topmost ancestor", () => {
    const root = new NodeA();
    const mid = new NodeA();
    const leaf = new NodeB();
    root.addChild(mid);
    mid.addChild(leaf);
    expect(leaf.getRoot()).toBe(root);
  });

  test("getRoot returns self if no parent", () => {
    const e = new NodeA();
    expect(e.getRoot()).toBe(e);
  });

  test("getOldestAncestor is same as getRoot", () => {
    const root = new NodeA();
    const child = new NodeB();
    root.addChild(child);
    expect(child.getOldestAncestor()).toBe(root);
  });

  test("parent returns null for root", () => {
    expect(new NodeA().parent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("Entity — Component.ent getter", () => {
  test("ent throws before entity is attached", () => {
    const c = new CountingComponent();
    expect(() => c.ent).toThrow();
  });

  test("ent returns entity after addComponent", () => {
    const e = new NodeA();
    const c = new CountingComponent();
    e.addComponent(c);
    expect(c.ent).toBe(e);
  });
});
