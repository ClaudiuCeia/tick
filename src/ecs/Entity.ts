import type { IWithUpdate, IAwakable } from "./lifecycle.ts";
import { Component } from "./Component.ts";
import { EntityRegistry } from "./EntityRegistry.ts";
import { EcsRuntime } from "./EcsRuntime.ts";

export type AbstractComponent<T> = Function & { prototype: T };
type Constructor<T> = AbstractComponent<T> | { new (...args: unknown[]): T };

export abstract class Entity implements IWithUpdate, IAwakable {
  private _componentMap: Map<Function, Component> = new Map();
  private _childMap: Map<Function, Entity[]> = new Map();
  private _awakenedComponents = new Set<Component>();

  protected _components: Component[] = [];
  private _isAwake: boolean = false;
  private _parent: Entity | null = null;
  private _children: Entity[] = [];
  public readonly id: string = crypto.randomUUID();
  private _runtime: EcsRuntime;
  private _baseCleanupComplete = false;
  private _adoptionPrepared = false;

  public _markForGc: boolean = false;

  constructor() {
    this._runtime = EcsRuntime.getCurrent();
    this._runtime._registerEntity(this);
  }

  public awake(): void {
    if (this._isAwake) {
      return;
    }
    if (this._markForGc) {
      throw new Error(`Cannot awaken destroyed entity ${this.constructor.name}`);
    }

    const components = [...this._components];
    const children = [...this._children];
    this._isAwake = true;

    try {
      for (const component of components) {
        if (!this._isAwake) break;
        if (
          component.entity === this &&
          this._components.includes(component) &&
          !this._awakenedComponents.has(component)
        ) {
          component.awake();
          if (component.entity === this && this._components.includes(component)) {
            this._awakenedComponents.add(component);
          }
        }
      }
      for (const child of children) {
        if (!this._isAwake) break;
        if (child._parent === this && !child._isAwake) {
          child.awake();
        }
      }
    } catch (error) {
      this._isAwake = false;
      throw error;
    }
  }

  public update(deltaTime: number): void {
    const components = [...this._components];
    const children = [...this._children];

    for (const component of components) {
      if (component.entity === this && this._components.includes(component)) {
        component.update(deltaTime);
      }
    }
    for (const child of children) {
      if (child._parent === this) {
        child.update(deltaTime);
      }
    }
  }

  public get components(): Component[] {
    return this._components;
  }

  public addComponent(component: Component): void {
    if (this._markForGc) {
      throw new Error(`Cannot add a component to destroyed entity ${this.constructor.name}`);
    }
    if (component.entity) {
      throw new Error(
        `Component ${component.constructor.name} is already attached to ${component.entity.constructor.name}`,
      );
    }

    if (this._components.length >= 100) {
      console.warn(
        `${this.constructor.name} has ${this._components.length} components, now adding ${component.constructor.name}`,
      );
    }

    if (this.hasComponent(component.constructor)) {
      throw new Error(
        `Component ${component.constructor.name} already exists on ${this.constructor.name}`,
      );
    }

    this._componentMap.set(component.constructor, component);
    this._components.push(component);
    component.entity = this;
    try {
      component._bindStoreHandles();
    } catch (error) {
      this._componentMap.delete(component.constructor);
      const index = this._components.indexOf(component);
      if (index !== -1) this._components.splice(index, 1);
      component._unbindStoreHandles();
      component.entity = undefined;
      throw error;
    }
    this._runtime.registry.markDirty();

    if (this._isAwake && component.awake) {
      try {
        component.awake();
        if (component.entity === this && this._components.includes(component)) {
          this._awakenedComponents.add(component);
        }
      } catch (error) {
        const shouldCleanUp = component.entity === this;
        this._componentMap.delete(component.constructor);
        const index = this._components.indexOf(component);
        if (index !== -1) this._components.splice(index, 1);
        this._awakenedComponents.delete(component);
        this._runtime.registry.markDirty();

        if (shouldCleanUp) {
          try {
            component.destroy();
          } catch {}
          try {
            component._unbindStoreHandles();
          } catch {}
          component.entity = undefined;
        }
        throw error;
      }
    }
  }

  public getComponent<C extends Component>(constr: Constructor<C>): C {
    const component = this._componentMap.get(constr);
    if (component) {
      return component as C;
    }
    throw new Error(`Component ${(constr as any).name} not found on ${this.constructor.name}`);
  }

  public removeComponent<C extends Component>(constr: Constructor<C>): void {
    const component = this._componentMap.get(constr);
    if (!component) return;

    this._componentMap.delete(constr);
    this._awakenedComponents.delete(component);
    const index = this._components.indexOf(component);
    if (index !== -1) {
      this._components.splice(index, 1);
    }
    this._runtime.registry.markDirty();

    try {
      component.destroy();
    } finally {
      component._unbindStoreHandles();
      component.entity = undefined;
    }
  }

  public hasComponent<C extends Component>(constr: Constructor<C>): boolean {
    return this._componentMap.has(constr);
  }

  public addChild(entity: Entity): void {
    if (this._markForGc) {
      throw new Error(`Cannot add a child to destroyed entity ${this.constructor.name}`);
    }
    if (entity._markForGc) {
      throw new Error(`Cannot attach destroyed entity ${entity.constructor.name}`);
    }

    if (entity.runtime !== this.runtime) {
      throw new Error(
        `Cannot parent ${entity.constructor.name} across runtimes. ` +
          `Parent runtime and child runtime must match.`,
      );
    }

    if (entity === this) {
      throw new Error("Cannot create a cycle in the entity hierarchy");
    }
    for (let ancestor = this._parent; ancestor; ancestor = ancestor._parent) {
      if (ancestor === entity) {
        throw new Error("Cannot create a cycle in the entity hierarchy");
      }
    }

    if (this._children.includes(entity)) {
      console.warn(`${entity.constructor.name} is already a child of ${this.constructor.name}`);
      return;
    }

    if (this._children.length >= 200) {
      console.warn(
        `${this.constructor.name} has ${this._children.length} children, now adding ${entity.constructor.name}`,
      );
    }

    if (entity._parent) {
      entity._parent.detachChild(entity);
    }

    this._children.push(entity);
    entity._parent = this;

    const list = this._childMap.get(entity.constructor) ?? [];
    list.push(entity);
    this._childMap.set(entity.constructor, list);

    if (this._isAwake && !entity._isAwake) {
      entity.awake();
    }
  }

  public removeChild(cb: (child: Entity) => boolean): void;
  public removeChild(entity: Entity): void;
  public removeChild(entityOrCb: Entity | ((child: Entity) => boolean)): void {
    let entity: Entity | null = null;
    if (typeof entityOrCb === "function") {
      const entities = [...this._children].filter(entityOrCb);
      if (entities.length > 0) {
        for (const child of entities) {
          this.removeChild(child);
        }
      }
      return;
    } else {
      entity = entityOrCb;
    }

    if (!entity) {
      return;
    }

    if (this.detachChild(entity) && entity._isAwake) {
      entity.destroy();
    }
  }

  public removeAllChildren(): void {
    this.removeChild(() => true);
  }

  public get children(): Entity[] {
    return this._children;
  }

  public getChild<C extends Entity>(constr: Constructor<C>): C | null {
    const list = this._childMap.get(constr);
    return (list?.[0] as C) ?? null;
  }

  public getChildById(id: string): Entity | null {
    for (const child of this._children) {
      if (child.id === id) return child;
    }
    return null;
  }

  public getChildren<C extends Entity>(constr: Constructor<C>): C[] {
    return (this._childMap.get(constr) as C[] | undefined) ?? [];
  }

  public get parent(): Entity | null {
    return this._parent;
  }

  public getRoot(): Entity {
    if (!this.parent) return this;
    return this.parent.getRoot();
  }

  public get isAwake(): boolean {
    return this._isAwake;
  }

  public destroy(): void {
    Entity.forceDestroy(this);
  }

  /** Explicit base lifecycle cleanup that bypasses subclass instance methods. */
  public static forceDestroy(entity: Entity): void {
    entity.#forceDestroy();
  }

  /** Explicit base preparation for no-fail persistence adoption. */
  public static prepareRuntimeAdoption(entity: Entity): void {
    entity.#prepareRuntimeAdoption();
  }

  /** Explicit base persistence transfer into a validated target runtime. */
  public static adoptRuntime(entity: Entity, runtime: EcsRuntime): void {
    entity.#adoptRuntime(runtime);
  }

  /** Explicit base state-handle rebind after the target store commit. */
  public static rebindStoreHandles(entity: Entity): void {
    entity.#rebindStoreHandles();
  }

  #forceDestroy(): void {
    if (this._baseCleanupComplete) return;

    const children = [...this._children];
    const components = [...this._components];
    let lifecycleError: unknown;
    this._markForGc = true;
    this._isAwake = false;

    if (this._parent) {
      this._parent.detachChild(this);
    }

    try {
      this._runtime.registry.unregister(this);
    } catch (error) {
      lifecycleError ??= error;
    }

    this._children.length = 0;
    this._childMap.clear();
    for (const child of children) {
      if (child._parent === this) {
        child._parent = null;
      }
    }

    for (const child of children) {
      try {
        child.destroy();
      } catch (error) {
        lifecycleError ??= error;
      } finally {
        try {
          Entity.forceDestroy(child);
        } catch (error) {
          lifecycleError ??= error;
        }
      }
    }

    this._components.length = 0;
    this._componentMap.clear();
    this._awakenedComponents.clear();
    for (const component of components) {
      if (component.entity !== this) continue;
      try {
        component.destroy();
      } catch (error) {
        lifecycleError ??= error;
      }
      try {
        component._unbindStoreHandles();
      } catch (error) {
        lifecycleError ??= error;
      }
      try {
        Component.forceUnbindStoreHandles(component);
      } catch (error) {
        lifecycleError ??= error;
      }
      component.entity = undefined;
    }

    this._baseCleanupComplete = true;

    if (lifecycleError !== undefined) {
      throw lifecycleError;
    }
  }

  #prepareRuntimeAdoption(): void {
    if (this._isAwake || this._markForGc || this._baseCleanupComplete) {
      throw new Error(`Cannot adopt non-live entity ${this.constructor.name}`);
    }
    for (const component of this._components) Component.forceUnbindStoreHandles(component);
    this._adoptionPrepared = true;
  }

  #adoptRuntime(runtime: EcsRuntime): void {
    if (!this._adoptionPrepared) {
      throw new Error(`Entity ${this.constructor.name} was not prepared for adoption`);
    }
    this._runtime.registry.unregister(this);
    this._runtime = runtime;
    runtime._registerEntity(this);
    this._adoptionPrepared = false;
  }

  #rebindStoreHandles(): void {
    for (const component of this._components) {
      Component.bindStoreHandlesAfterAdoption(component);
    }
  }

  public static getRegistry(): EntityRegistry {
    return EcsRuntime.getCurrent().registry;
  }

  public get runtime(): EcsRuntime {
    return this._runtime;
  }

  public printHeritageChain(): void {
    let current: Entity | null = this.parent;
    const chain: string[] = [this.constructor.name];
    while (current) {
      chain.push(current.constructor.name);
      current = current.parent;
    }
    console.log("Heritage chain:", chain.reverse().join(" -> "));
  }

  public getOldestAncestor(): Entity {
    return this.getRoot();
  }

  private detachChild(entity: Entity): boolean {
    const index = this._children.indexOf(entity);
    if (index === -1) return false;

    this._children.splice(index, 1);
    entity._parent = null;

    const list = this._childMap.get(entity.constructor);
    if (list) {
      const typeIndex = list.indexOf(entity);
      if (typeIndex !== -1) list.splice(typeIndex, 1);
      if (list.length === 0) this._childMap.delete(entity.constructor);
    }
    return true;
  }
}
