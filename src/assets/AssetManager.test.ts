import { describe, expect, test } from "bun:test";
import {
  AssetManager,
  defineAssetManifest,
  type SpriteSheetAsset,
  type SpriteSheetGridOptions,
} from "./AssetManager.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { EntityRegistry } from "../ecs/EntityRegistry.ts";
import { InputManager } from "../input/Input.ts";

const mockImage = (width: number, height: number, src: string): HTMLImageElement =>
  ({
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
    src,
  }) as unknown as HTMLImageElement;

const createEventTarget = (): {
  target: EventTarget;
  dispatch: (type: string) => void;
  listenerCount: (type: string) => number;
} => {
  const listeners = new Map<string, Set<EventListener>>();
  const target = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener !== "function") return;
      const list = listeners.get(type) ?? new Set<EventListener>();
      list.add(listener);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") {
        listeners.get(type)?.delete(listener);
      }
    },
  } as unknown as EventTarget;

  return {
    target,
    dispatch: (type) => {
      for (const listener of Array.from(listeners.get(type) ?? [])) {
        listener(new Event(type));
      }
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  };
};

const flushPromises = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("AssetManager", () => {
  test("playAudio queues before unlock and drains on first gesture", async () => {
    const manager = new AssetManager();
    const listeners = new Map<string, EventListener[]>();
    const target = {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        const list = listeners.get(type) ?? [];
        const fn =
          typeof listener === "function"
            ? listener
            : (((event: Event) => listener.handleEvent(event)) as EventListener);
        list.push(fn);
        listeners.set(type, list);
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        const list = listeners.get(type) ?? [];
        const fn =
          typeof listener === "function"
            ? listener
            : (((event: Event) => listener.handleEvent(event)) as EventListener);
        listeners.set(
          type,
          list.filter((entry) => entry !== fn),
        );
      },
    } as unknown as EventTarget;

    let plays = 0;
    const audio = {
      cloneNode: () =>
        ({
          volume: 1,
          currentTime: 0,
          play: async () => {
            plays++;
          },
        }) as HTMLAudioElement,
    } as unknown as HTMLAudioElement;

    manager.playAudio(audio, { volume: 0.4, unlockTarget: target });
    expect(plays).toBe(0);

    for (const listener of listeners.get("pointerdown") ?? []) {
      listener(new Event("pointerdown"));
    }
    await Promise.resolve();

    expect(plays).toBe(1);
  });

  test("playAudio with no unlock target plays immediately", async () => {
    const manager = new AssetManager();

    let plays = 0;
    const audio = {
      cloneNode: () =>
        ({
          volume: 1,
          currentTime: 0,
          play: async () => {
            plays++;
          },
        }) as HTMLAudioElement,
    } as unknown as HTMLAudioElement;

    manager.playAudio(audio, { volume: 0.5, unlockTarget: null });
    await Promise.resolve();
    expect(plays).toBe(1);
  });

  test("playAudio retries unlock after a rejected play", async () => {
    const manager = new AssetManager();
    const unlock = createEventTarget();
    let attempts = 0;
    const audio = {
      cloneNode: () =>
        ({
          volume: 1,
          currentTime: 0,
          play: async () => {
            attempts++;
            if (attempts === 1) throw new Error("autoplay blocked");
          },
        }) as HTMLAudioElement,
    } as unknown as HTMLAudioElement;

    manager.playAudio(audio, { unlockTarget: unlock.target });
    unlock.dispatch("pointerdown");
    await flushPromises();

    expect(attempts).toBe(1);
    expect(unlock.listenerCount("pointerdown")).toBe(1);

    unlock.dispatch("pointerdown");
    await flushPromises();
    expect(attempts).toBe(2);
    expect(unlock.listenerCount("pointerdown")).toBe(0);

    manager.playAudio(audio, { unlockTarget: unlock.target });
    await flushPromises();
    expect(attempts).toBe(3);
  });

  test("playAudio clamps finite and invalid volume values", async () => {
    const manager = new AssetManager();
    const volumes: number[] = [];
    const audio = {
      cloneNode: () =>
        ({
          set volume(value: number) {
            volumes.push(value);
          },
          currentTime: 0,
          play: async () => {},
        }) as HTMLAudioElement,
    } as unknown as HTMLAudioElement;

    manager.playAudio(audio, { volume: -1, unlockTarget: null });
    manager.playAudio(audio, { volume: 2, unlockTarget: null });
    manager.playAudio(audio, { volume: Number.NaN, unlockTarget: null });
    manager.playAudio(audio, { volume: Number.POSITIVE_INFINITY, unlockTarget: null });
    manager.playAudio(audio, { volume: Number.NEGATIVE_INFINITY, unlockTarget: null });
    await flushPromises();

    expect(volumes).toEqual([0, 1, 1, 1, 0]);
  });

  test("an older audio attempt cannot replace a newer unlock target", async () => {
    const manager = new AssetManager();
    const firstTarget = createEventTarget();
    const secondTarget = createEventTarget();
    let rejectFirstPlay!: (error: Error) => void;
    let firstPlays = 0;
    let secondPlays = 0;
    const firstAudio = {
      cloneNode: () =>
        ({
          volume: 1,
          currentTime: 0,
          play: () => {
            firstPlays++;
            if (firstPlays === 1) {
              return new Promise<void>((_, reject) => {
                rejectFirstPlay = reject;
              });
            }
            return Promise.resolve();
          },
        }) as HTMLAudioElement,
    } as unknown as HTMLAudioElement;
    const secondAudio = {
      cloneNode: () =>
        ({
          volume: 1,
          currentTime: 0,
          play: async () => {
            secondPlays++;
          },
        }) as HTMLAudioElement,
    } as unknown as HTMLAudioElement;

    manager.playAudio(firstAudio, { unlockTarget: firstTarget.target });
    firstTarget.dispatch("pointerdown");
    manager.playAudio(secondAudio, { unlockTarget: secondTarget.target });

    rejectFirstPlay(new Error("still blocked"));
    await flushPromises();
    expect(firstTarget.listenerCount("pointerdown")).toBe(0);
    expect(secondTarget.listenerCount("pointerdown")).toBe(1);

    secondTarget.dispatch("pointerdown");
    await flushPromises();
    expect(firstPlays).toBe(2);
    expect(secondPlays).toBe(1);
    expect(secondTarget.listenerCount("pointerdown")).toBe(0);
  });

  test("successful targetless playback drains queued target-based plays", async () => {
    const manager = new AssetManager();
    const unlock = createEventTarget();
    let queuedPlays = 0;
    let targetlessPlays = 0;
    const queuedAudio = {
      cloneNode: () =>
        ({
          volume: 1,
          currentTime: 0,
          play: async () => {
            queuedPlays++;
          },
        }) as HTMLAudioElement,
    } as unknown as HTMLAudioElement;
    const targetlessAudio = {
      cloneNode: () =>
        ({
          volume: 1,
          currentTime: 0,
          play: async () => {
            targetlessPlays++;
          },
        }) as HTMLAudioElement,
    } as unknown as HTMLAudioElement;

    manager.playAudio(queuedAudio, { unlockTarget: unlock.target });
    manager.playAudio(targetlessAudio, { unlockTarget: null });
    await flushPromises();

    expect(targetlessPlays).toBe(1);
    expect(queuedPlays).toBe(1);
    expect(unlock.listenerCount("pointerdown")).toBe(0);

    manager.playAudio(queuedAudio, { unlockTarget: unlock.target });
    await flushPromises();
    expect(queuedPlays).toBe(2);
  });

  test("deduplicates same image URL across scopes and cleans up on last release", async () => {
    let imageLoads = 0;
    const disposed: string[] = [];

    const manager = new AssetManager({
      loaders: {
        image: async (url) => {
          imageLoads++;
          return {
            asset: mockImage(64, 32, url),
            dispose: () => disposed.push(url),
          };
        },
      },
    });

    const a = manager.createScope("scene-a");
    const b = manager.createScope("scene-b");

    const imgA = await a.loadImage("hero", "/hero.png");
    const imgB = await b.loadImage("heroCopy", "/hero.png");

    expect(imageLoads).toBe(1);
    expect(imgA).toBe(imgB);
    expect(manager.getStats()).toEqual({ scopes: 2, cachedAssets: 1, refs: 2 });

    a.release();
    expect(manager.getStats()).toEqual({ scopes: 1, cachedAssets: 1, refs: 1 });

    b.release();
    expect(manager.getStats()).toEqual({ scopes: 0, cachedAssets: 0, refs: 0 });
    expect(disposed).toEqual(["/hero.png"]);
  });

  test("failed loads rollback alias/ref state and allow retry", async () => {
    let attempts = 0;
    const manager = new AssetManager({
      loaders: {
        image: async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error("boom");
          }
          return { asset: mockImage(32, 32, "/ok.png") };
        },
      },
    });

    const scope = manager.createScope("scene");

    await expect(scope.loadImage("bad", "/bad.png")).rejects.toThrow("boom");
    expect(scope.has("bad")).toBe(false);
    expect(manager.getStats()).toEqual({ scopes: 1, cachedAssets: 0, refs: 0 });

    await scope.loadImage("good", "/good.png");
    expect(scope.has("good")).toBe(true);
    expect(manager.getStats()).toEqual({ scopes: 1, cachedAssets: 1, refs: 1 });
  });

  test("reacquiring the same alias and cache key rejects the stale acquisition", async () => {
    let resolveLoad!: (result: { asset: HTMLImageElement; dispose: () => void }) => void;
    let disposals = 0;
    const manager = new AssetManager({
      loaders: {
        image: () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      },
    });
    const scope = manager.createScope("scene");
    const staleLoad = scope.loadImage("hero", "/hero.png");

    scope.releaseAlias("hero");
    const ownedLoad = scope.loadImage("hero", "/hero.png");
    resolveLoad({
      asset: mockImage(32, 32, "/hero.png"),
      dispose: () => disposals++,
    });

    await expect(staleLoad).rejects.toThrow("no longer active");
    expect(await ownedLoad).toBe(scope.getImage("hero"));
    expect(manager.getStats()).toEqual({ scopes: 1, cachedAssets: 1, refs: 1 });

    scope.release();
    expect(disposals).toBe(1);
  });

  test("spritesheet grid uses image dependency and keeps image alive until sheet release", async () => {
    const manager = new AssetManager({
      loaders: {
        image: async (url) => ({ asset: mockImage(64, 32, url) }),
        spritesheet: async (image, options) => {
          const frames = options.count ?? 1;
          return {
            asset: {
              image,
              frames: Array.from({ length: frames }, (_, i) => ({
                x: i * options.frameWidth,
                y: 0,
                width: options.frameWidth,
                height: options.frameHeight,
              })),
              tags: options.tags ?? {},
            } as SpriteSheetAsset,
          };
        },
      },
    });

    const scope = manager.createScope("scene");
    await scope.loadImage("atlas", "/atlas.png");

    const sheetOpts: SpriteSheetGridOptions = {
      frameWidth: 16,
      frameHeight: 16,
      count: 4,
      columns: 4,
    };

    const sheet = await scope.loadSpriteSheetGrid("runner", "atlas", sheetOpts);
    expect(sheet.frames).toHaveLength(4);

    scope.releaseAlias("atlas");
    expect(manager.getStats()).toEqual({ scopes: 1, cachedAssets: 2, refs: 2 });

    scope.releaseAlias("runner");
    expect(manager.getStats()).toEqual({ scopes: 1, cachedAssets: 0, refs: 0 });
  });

  test("spritesheet rejects an image handle from a retired cache generation", async () => {
    let sheetLoads = 0;
    const manager = new AssetManager({
      loaders: {
        image: async (url) => ({ asset: mockImage(64, 32, url) }),
        spritesheet: async (image) => {
          sheetLoads++;
          return { asset: { image, frames: [], tags: {} } };
        },
      },
    });
    const staleScope = manager.createScope("stale");
    const staleHandle = await manager.acquireImage(staleScope.id, "atlas", "/atlas.png");

    manager.clear();

    const freshScope = manager.createScope("fresh");
    const freshHandle = await manager.acquireImage(freshScope.id, "atlas", "/atlas.png");
    const options = { frameWidth: 16, frameHeight: 16 };

    await expect(
      manager.acquireSpriteSheet(freshScope.id, "stale-sheet", staleHandle, options),
    ).rejects.toThrow("must be loaded before spritesheet");
    expect(sheetLoads).toBe(0);
    expect(freshScope.has("stale-sheet")).toBe(false);

    const sheetHandle = await manager.acquireSpriteSheet(
      freshScope.id,
      "fresh-sheet",
      freshHandle,
      options,
    );
    expect(manager.getByHandle(sheetHandle)).toEqual({
      image: freshScope.getImage("atlas"),
      frames: [],
      tags: {},
    });
    expect(sheetLoads).toBe(1);
    freshScope.release();
    expect(manager.getStats()).toEqual({ scopes: 0, cachedAssets: 0, refs: 0 });
  });

  test("shared spritesheet owns one image dependency across multiple scopes", async () => {
    let imageDisposals = 0;
    let sheetDisposals = 0;
    const manager = new AssetManager({
      loaders: {
        image: async (url) => ({
          asset: mockImage(64, 32, url),
          dispose: () => imageDisposals++,
        }),
        spritesheet: async (image) => ({
          asset: { image, frames: [], tags: {} },
          dispose: () => sheetDisposals++,
        }),
      },
    });
    const options = { frameWidth: 16, frameHeight: 16 };
    const a = manager.createScope("a");
    const b = manager.createScope("b");

    await a.loadImage("atlas", "/atlas.png");
    await b.loadImage("atlas", "/atlas.png");
    const sheetA = await a.loadSpriteSheetGrid("sheet", "atlas", options);
    const sheetB = await b.loadSpriteSheetGrid("sheet", "atlas", options);

    expect(sheetA).toBe(sheetB);
    expect(manager.getStats()).toEqual({ scopes: 2, cachedAssets: 2, refs: 5 });

    a.release();
    expect(manager.getStats()).toEqual({ scopes: 1, cachedAssets: 2, refs: 3 });
    expect(imageDisposals).toBe(0);
    expect(sheetDisposals).toBe(0);

    b.release();
    expect(manager.getStats()).toEqual({ scopes: 0, cachedAssets: 0, refs: 0 });
    expect(imageDisposals).toBe(1);
    expect(sheetDisposals).toBe(1);

    manager.clear();
    a.release();
    b.release();
    expect(imageDisposals).toBe(1);
    expect(sheetDisposals).toBe(1);
  });

  test("clear releases a pending spritesheet and its image dependency", async () => {
    let resolveSheet!: (result: { asset: SpriteSheetAsset; dispose: () => void }) => void;
    const disposals: string[] = [];
    const manager = new AssetManager({
      loaders: {
        image: async (url) => ({
          asset: mockImage(64, 32, url),
          dispose: () => disposals.push("image"),
        }),
        spritesheet: (_image) =>
          new Promise((resolve) => {
            resolveSheet = resolve;
          }),
      },
    });
    const scope = manager.createScope("scene");
    const image = await scope.loadImage("atlas", "/atlas.png");
    const loading = scope.loadSpriteSheetGrid("sheet", "atlas", {
      frameWidth: 16,
      frameHeight: 16,
    });

    manager.clear();
    resolveSheet({
      asset: { image, frames: [], tags: {} },
      dispose: () => disposals.push("sheet"),
    });

    await expect(loading).rejects.toThrow("no longer active");
    expect(disposals).toEqual(["sheet", "image"]);
    expect(manager.getStats()).toEqual({ scopes: 0, cachedAssets: 0, refs: 0 });
  });

  test("a throwing spritesheet disposer still releases its image dependency", async () => {
    let imageDisposals = 0;
    let sheetDisposals = 0;
    const manager = new AssetManager({
      loaders: {
        image: async (url) => ({
          asset: mockImage(64, 32, url),
          dispose: () => imageDisposals++,
        }),
        spritesheet: async (image) => ({
          asset: { image, frames: [], tags: {} },
          dispose: () => {
            sheetDisposals++;
            throw new Error("sheet dispose failed");
          },
        }),
      },
    });
    const scope = manager.createScope("scene");
    await scope.loadImage("atlas", "/atlas.png");
    await scope.loadSpriteSheetGrid("sheet", "atlas", {
      frameWidth: 16,
      frameHeight: 16,
    });

    expect(() => scope.release()).toThrow("sheet dispose failed");
    expect(sheetDisposals).toBe(1);
    expect(imageDisposals).toBe(1);
    expect(manager.getStats()).toEqual({ scopes: 0, cachedAssets: 0, refs: 0 });

    manager.clear();
    expect(sheetDisposals).toBe(1);
    expect(imageDisposals).toBe(1);
  });

  test("clear disposes a successful in-flight load once and invalidates its scope", async () => {
    let resolveLoad!: (result: { asset: HTMLImageElement; dispose: () => void }) => void;
    let disposals = 0;
    const manager = new AssetManager({
      loaders: {
        image: () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      },
    });
    const scope = manager.createScope("stale");
    const loading = scope.loadImage("hero", "/hero.png");

    manager.clear();
    expect(manager.getStats()).toEqual({ scopes: 0, cachedAssets: 0, refs: 0 });
    expect(scope.has("hero")).toBe(false);
    expect(() => scope.getImage("hero")).toThrow("is not loaded");

    resolveLoad({
      asset: mockImage(32, 32, "/hero.png"),
      dispose: () => disposals++,
    });
    await expect(loading).rejects.toThrow("no longer active");
    expect(disposals).toBe(1);

    manager.clear();
    scope.release();
    await expect(scope.loadImage("again", "/hero.png")).rejects.toThrow("is not registered");
    expect(disposals).toBe(1);
  });

  test("clear safely retires a failed in-flight load", async () => {
    let rejectLoad!: (error: Error) => void;
    const manager = new AssetManager({
      loaders: {
        image: () =>
          new Promise((_, reject) => {
            rejectLoad = reject;
          }),
      },
    });
    const scope = manager.createScope("stale");
    const loading = scope.loadImage("hero", "/hero.png");

    manager.clear();
    rejectLoad(new Error("load failed"));

    await expect(loading).rejects.toThrow("load failed");
    expect(scope.has("hero")).toBe(false);
    expect(manager.getStats()).toEqual({ scopes: 0, cachedAssets: 0, refs: 0 });
  });

  test("an in-flight entry retired by clear cannot collect a replacement entry", async () => {
    const resolvers: Array<(result: { asset: HTMLImageElement; dispose: () => void }) => void> = [];
    const disposals: string[] = [];
    const manager = new AssetManager({
      loaders: {
        image: () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          }),
      },
    });
    const staleScope = manager.createScope("stale");
    const staleLoad = staleScope.loadImage("hero", "/hero.png");

    manager.clear();

    const freshScope = manager.createScope("fresh");
    const freshLoad = freshScope.loadImage("hero", "/hero.png");
    expect(resolvers).toHaveLength(2);

    resolvers[1]!({
      asset: mockImage(32, 32, "fresh"),
      dispose: () => disposals.push("fresh"),
    });
    expect((await freshLoad).src).toBe("fresh");

    resolvers[0]!({
      asset: mockImage(32, 32, "stale"),
      dispose: () => disposals.push("stale"),
    });
    await expect(staleLoad).rejects.toThrow("no longer active");

    expect(freshScope.getImage("hero").src).toBe("fresh");
    expect(disposals).toEqual(["stale"]);
    freshScope.release();
    expect(disposals).toEqual(["stale", "fresh"]);
  });

  test("EcsRuntime owns an independent AssetManager instance", async () => {
    let loads = 0;
    const managerA = new AssetManager({
      loaders: {
        image: async (url) => {
          loads++;
          return { asset: mockImage(16, 16, url) };
        },
      },
    });
    const managerB = new AssetManager({
      loaders: {
        image: async (url) => {
          loads++;
          return { asset: mockImage(16, 16, url) };
        },
      },
    });

    const runtimeA = new EcsRuntime(new EntityRegistry(), new InputManager(), managerA);
    const runtimeB = new EcsRuntime(new EntityRegistry(), new InputManager(), managerB);

    const scopeA = runtimeA.assets.createScope("a");
    const scopeB = runtimeB.assets.createScope("b");

    await scopeA.loadImage("hero", "/hero.png");
    await scopeB.loadImage("hero", "/hero.png");

    expect(loads).toBe(2);
    expect(runtimeA.assets).not.toBe(runtimeB.assets);
  });

  test("load(manifest) returns typed asset groups and can release scope", async () => {
    const manager = new AssetManager({
      loaders: {
        image: async (url) => ({ asset: mockImage(32, 32, url) }),
        audio: async (url) => ({ asset: { src: url } as HTMLAudioElement }),
        font: async (family) => ({ asset: { family } as FontFace }),
      },
    });

    const manifest = defineAssetManifest({
      images: {
        runner: "/runner.svg",
      },
      audio: {
        jump: "/jump.ogg",
      },
      fonts: {
        ui: {
          family: "Kenney Pixel",
          source: "url('/kenney.ttf')",
        },
      },
    });

    const loaded = await manager.load(manifest, { scopeLabel: "scene" });
    expect(loaded.images.runner.src).toBe("/runner.svg");
    expect(loaded.audio.jump.src).toBe("/jump.ogg");
    expect(loaded.fonts.ui.family).toBe("Kenney Pixel");
    expect(manager.getStats().refs).toBe(3);

    loaded.release();
    expect(manager.getStats()).toEqual({ scopes: 0, cachedAssets: 0, refs: 0 });
  });

  test("load(manifest) validates key and path formats", async () => {
    const manager = new AssetManager({
      loaders: {
        image: async (url) => ({ asset: mockImage(16, 16, url) }),
      },
    });

    await expect(
      manager.load({
        images: {
          "bad key": "/ok.svg",
        },
      }),
    ).rejects.toThrow("Invalid asset key");

    await expect(
      manager.load({
        images: {
          good: "/not-image.txt",
        },
      }),
    ).rejects.toThrow("unsupported file extension");
  });

  test("load(manifest) validates spritesheet image references", async () => {
    const manager = new AssetManager({
      loaders: {
        image: async (url) => ({ asset: mockImage(64, 64, url) }),
      },
    });

    await expect(
      manager.load({
        spritesheets: {
          hero: {
            image: "missing",
            options: {
              frameWidth: 16,
              frameHeight: 16,
              count: 4,
            },
          },
        },
      }),
    ).rejects.toThrow("references missing image key");
  });
});
