import { GameEvent } from "./GameEvent.ts";

export enum Priority {
  High = 0,
  Medium = 50,
  Low = 100,
}

type EventCallback<TPayload, T extends keyof TPayload> = (event: GameEvent<TPayload, T>) => void;

type EventListener<TPayload, T extends keyof TPayload> = {
  callback: EventCallback<TPayload, T>;
  priority: number;
  id: string;
};

type ListenerMap<TPayload> = {
  [K in keyof TPayload]?: EventListener<TPayload, K>[];
};

/**
 * Typed, priority-ordered publish/subscribe event bus.
 *
 * Games instantiate this with their own event payload map:
 * ```ts
 * type MyPayload = { mouse_click: { point: Vector2D }; jump: {} };
 * export const EventBus = new BroadcastEventBus<MyPayload>();
 * ```
 *
 * Listeners are kept pre-sorted by priority (lower number = fired first).
 * `stopPropagation()` on an event stops remaining listeners.
 */
export class BroadcastEventBus<TPayload extends Record<string, unknown>> {
  private listeners: ListenerMap<TPayload> = {};
  private activeListenerIds = new Set<string>();
  private contextId: string = crypto.randomUUID();

  /**
   * Subscribe to an event type. Returns a subscription ID for later unsubscription.
   * Listeners are inserted in priority order so dispatch needs no sorting.
   */
  public subscribe<T extends keyof TPayload>(
    eventType: T,
    callback: EventCallback<TPayload, T>,
    priority = Priority.High,
  ): string {
    const id = crypto.randomUUID();

    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }

    const list = this.listeners[eventType]!;
    const listener: EventListener<TPayload, T> = { callback, priority, id };

    // Insert sorted by priority (ascending) — O(n) but listener counts are tiny
    let insertAt = list.length;
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.priority > priority) {
        insertAt = i;
        break;
      }
    }
    list.splice(insertAt, 0, listener as EventListener<TPayload, keyof TPayload>);
    this.activeListenerIds.add(id);

    return id;
  }

  public unsubscribe(id: string): void {
    if (!this.activeListenerIds.delete(id)) return;

    for (const eventType in this.listeners) {
      const list = this.listeners[eventType as keyof TPayload];
      if (list) {
        const index = list.findIndex((l) => l.id === id);
        if (index !== -1) {
          list.splice(index, 1);
          break;
        }
      }
    }
  }

  public publish<T extends keyof TPayload>(type: T, payload: TPayload[T]): void {
    const event = new GameEvent<TPayload, T>(type, payload, this.contextId);
    this.dispatch(event);
  }

  private dispatch<T extends keyof TPayload>(event: GameEvent<TPayload, T>): void {
    const list = this.listeners[event.type];
    if (!list) return;

    for (const listener of list.slice()) {
      if (!this.activeListenerIds.has(listener.id)) continue;
      (listener.callback as EventCallback<TPayload, T>)(event);
      if (event.propagationStopped) break;
    }
  }

  public debugDump(): void {
    console.log("EventBus debug dump:");
    for (const eventType in this.listeners) {
      const list = this.listeners[eventType as keyof TPayload];
      if (!list) continue;
      console.log(`  ${eventType}:`);
      for (const l of list) {
        console.log(`    [${l.priority}] id=${l.id}`);
      }
    }
  }
}
