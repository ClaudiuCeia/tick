import { describe, test, expect } from "bun:test";
import { BroadcastEventBus, Priority } from "./EventBus.ts";
import { GameEvent } from "./GameEvent.ts";

type TestPayload = {
  ping: { value: number };
  pong: { text: string };
  empty: Record<string, never>;
};

function makeEventBus() {
  return new BroadcastEventBus<TestPayload>();
}

describe("BroadcastEventBus — subscribe / publish", () => {
  test("listener receives published event", () => {
    const bus = makeEventBus();
    const received: number[] = [];
    bus.subscribe("ping", (e) => received.push(e.payload.value));
    bus.publish("ping", { value: 42 });
    expect(received).toEqual([42]);
  });

  test("multiple subscribers all receive the event", () => {
    const bus = makeEventBus();
    const log: string[] = [];
    bus.subscribe("pong", (e) => log.push("a:" + e.payload.text));
    bus.subscribe("pong", (e) => log.push("b:" + e.payload.text));
    bus.publish("pong", { text: "hi" });
    expect(log).toContain("a:hi");
    expect(log).toContain("b:hi");
  });

  test("publishing to event type with no listeners is a no-op", () => {
    const bus = makeEventBus();
    expect(() => bus.publish("ping", { value: 1 })).not.toThrow();
  });

  test("subscribe returns a unique string id", () => {
    const bus = makeEventBus();
    const id1 = bus.subscribe("ping", () => {});
    const id2 = bus.subscribe("ping", () => {});
    expect(typeof id1).toBe("string");
    expect(id1).not.toBe(id2);
  });

  test("listeners added during publish wait until the next publish", () => {
    const bus = makeEventBus();
    const calls: string[] = [];
    bus.subscribe("ping", () => {
      calls.push("existing");
      bus.subscribe("ping", () => calls.push("added"));
    });

    bus.publish("ping", { value: 1 });
    expect(calls).toEqual(["existing"]);
  });

  test("self-unsubscription does not skip the next listener", () => {
    const bus = makeEventBus();
    const calls: string[] = [];
    let firstId = "";
    firstId = bus.subscribe("ping", () => {
      calls.push("first");
      bus.unsubscribe(firstId);
    });
    bus.subscribe("ping", () => calls.push("second"));

    bus.publish("ping", { value: 1 });
    expect(calls).toEqual(["first", "second"]);
  });

  test("a listener unsubscribed before its turn is skipped", () => {
    const bus = makeEventBus();
    const calls: string[] = [];
    let secondId = "";
    bus.subscribe("ping", () => {
      calls.push("first");
      bus.unsubscribe(secondId);
    });
    secondId = bus.subscribe("ping", () => calls.push("second"));
    bus.subscribe("ping", () => calls.push("third"));

    bus.publish("ping", { value: 1 });

    expect(calls).toEqual(["first", "third"]);
  });
});

describe("BroadcastEventBus — unsubscribe", () => {
  test("unsubscribed listener no longer receives events", () => {
    const bus = makeEventBus();
    const received: number[] = [];
    const id = bus.subscribe("ping", (e) => received.push(e.payload.value));
    bus.unsubscribe(id);
    bus.publish("ping", { value: 99 });
    expect(received).toHaveLength(0);
  });

  test("unsubscribing unknown id is a no-op", () => {
    const bus = makeEventBus();
    expect(() => bus.unsubscribe("ghost-id")).not.toThrow();
  });

  test("only the unsubscribed listener is removed", () => {
    const bus = makeEventBus();
    const log: string[] = [];
    const id = bus.subscribe("ping", () => log.push("removed"));
    bus.subscribe("ping", () => log.push("kept"));
    bus.unsubscribe(id);
    bus.publish("ping", { value: 1 });
    expect(log).toEqual(["kept"]);
  });
});

describe("BroadcastEventBus — priority ordering", () => {
  test("High priority listener fires before Medium, Medium before Low", () => {
    const bus = makeEventBus();
    const order: string[] = [];
    bus.subscribe("ping", () => order.push("low"), Priority.Low);
    bus.subscribe("ping", () => order.push("high"), Priority.High);
    bus.subscribe("ping", () => order.push("medium"), Priority.Medium);
    bus.publish("ping", { value: 0 });
    expect(order).toEqual(["high", "medium", "low"]);
  });

  test("same priority listeners fire in subscription order", () => {
    const bus = makeEventBus();
    const order: string[] = [];
    bus.subscribe("ping", () => order.push("first"), Priority.High);
    bus.subscribe("ping", () => order.push("second"), Priority.High);
    bus.publish("ping", { value: 0 });
    expect(order).toEqual(["first", "second"]);
  });

  test("default priority is High", () => {
    const bus = makeEventBus();
    const order: string[] = [];
    bus.subscribe("ping", () => order.push("default"));
    bus.subscribe("ping", () => order.push("low"), Priority.Low);
    bus.publish("ping", { value: 0 });
    expect(order[0]).toBe("default");
  });
});

describe("BroadcastEventBus — stopPropagation", () => {
  test("stopPropagation prevents remaining listeners from firing", () => {
    const bus = makeEventBus();
    const log: string[] = [];
    bus.subscribe(
      "ping",
      (e) => {
        log.push("first");
        e.stopPropagation();
      },
      Priority.High,
    );
    bus.subscribe("ping", () => log.push("second"), Priority.Medium);
    bus.publish("ping", { value: 0 });
    expect(log).toEqual(["first"]);
  });

  test("stopPropagation on lower-priority does not affect earlier listeners", () => {
    const bus = makeEventBus();
    const log: string[] = [];
    bus.subscribe("ping", () => log.push("high"), Priority.High);
    bus.subscribe(
      "ping",
      (e) => {
        log.push("low");
        e.stopPropagation();
      },
      Priority.Low,
    );
    bus.publish("ping", { value: 0 });
    expect(log).toEqual(["high", "low"]);
  });
});

describe("BroadcastEventBus — multiple event types", () => {
  test("listeners only receive their subscribed event type", () => {
    const bus = makeEventBus();
    const pings: number[] = [];
    const pongs: string[] = [];
    bus.subscribe("ping", (e) => pings.push(e.payload.value));
    bus.subscribe("pong", (e) => pongs.push(e.payload.text));
    bus.publish("ping", { value: 7 });
    bus.publish("pong", { text: "hello" });
    expect(pings).toEqual([7]);
    expect(pongs).toEqual(["hello"]);
  });
});

describe("GameEvent", () => {
  test("stopPropagation sets propagationStopped", () => {
    const e = new GameEvent<TestPayload, "ping">("ping", { value: 1 });
    expect(e.propagationStopped).toBe(false);
    e.stopPropagation();
    expect(e.propagationStopped).toBe(true);
  });

  test("GameEvent.from constructs correctly", () => {
    const e = GameEvent.from<TestPayload, "pong">({
      type: "pong",
      payload: { text: "world" },
      contextId: "ctx-1",
    });
    expect(e.type).toBe("pong");
    expect(e.payload.text).toBe("world");
    expect(e.contextId).toBe("ctx-1");
  });
});
