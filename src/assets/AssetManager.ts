/* eslint-disable @typescript-eslint/no-explicit-any */

type AssetKind = "image" | "audio" | "font" | "spritesheet";

type AssetHandle = {
  kind: AssetKind;
  cacheKey: string;
  entryId: number;
  acquisitionId: number;
};

type LoaderResult<T> = {
  asset: T;
  dispose?: () => void;
};

type CacheEntry<T = unknown> = {
  id: number;
  kind: AssetKind;
  cacheKey: string;
  refs: number;
  promise: Promise<T> | null;
  value: T | null;
  dispose: (() => void) | null;
  dependencies: CacheEntry[];
  collected: boolean;
};

type AudioPlayRequest = {
  audio: HTMLAudioElement;
  volume: number;
};

const isAudioLike = (value: unknown): value is HTMLAudioElement => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    cloneNode?: unknown;
    play?: unknown;
  };
  return typeof candidate.cloneNode === "function" && typeof candidate.play === "function";
};

export type SpriteSheetTag = {
  from: number;
  to: number;
  loop?: boolean;
};

export type SpriteSheetFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  durationMs?: number;
};

export type SpriteSheetGridOptions = {
  frameWidth: number;
  frameHeight: number;
  count?: number;
  columns?: number;
  rows?: number;
  margin?: number;
  spacing?: number;
  names?: string[];
  durationMs?: number | number[];
  tags?: Record<string, SpriteSheetTag>;
};

export type SpriteSheetAsset = {
  image: HTMLImageElement;
  frames: SpriteSheetFrame[];
  tags: Record<string, SpriteSheetTag>;
};

export type FontManifestEntry = {
  family: string;
  source: string;
  descriptors?: FontFaceDescriptors;
};

export type SpriteSheetManifestEntry<TImageKey extends string> = {
  image: TImageKey;
  options: SpriteSheetGridOptions;
};

export type AssetManifest<
  TImages extends Record<string, string> = Record<string, string>,
  TAudio extends Record<string, string> = Record<string, string>,
  TFonts extends Record<string, FontManifestEntry> = Record<string, FontManifestEntry>,
  TSpritesheets extends Record<string, SpriteSheetManifestEntry<keyof TImages & string>> = Record<
    string,
    SpriteSheetManifestEntry<keyof TImages & string>
  >,
> = {
  images?: TImages;
  audio?: TAudio;
  fonts?: TFonts;
  spritesheets?: TSpritesheets;
};

type ManifestImages<TManifest extends AssetManifest> =
  TManifest extends AssetManifest<infer TImages>
    ? { [K in keyof TImages]: HTMLImageElement }
    : Record<string, HTMLImageElement>;

type ManifestAudio<TManifest extends AssetManifest> =
  TManifest extends AssetManifest<Record<string, string>, infer TAudio>
    ? { [K in keyof TAudio]: HTMLAudioElement }
    : Record<string, HTMLAudioElement>;

type ManifestFonts<TManifest extends AssetManifest> =
  TManifest extends AssetManifest<Record<string, string>, Record<string, string>, infer TFonts>
    ? { [K in keyof TFonts]: FontFace }
    : Record<string, FontFace>;

type ManifestSpritesheets<TManifest extends AssetManifest> =
  TManifest extends AssetManifest<
    Record<string, string>,
    Record<string, string>,
    Record<string, FontManifestEntry>,
    infer TSpritesheets
  >
    ? { [K in keyof TSpritesheets]: SpriteSheetAsset }
    : Record<string, SpriteSheetAsset>;

export type LoadedAssetManifest<TManifest extends AssetManifest> = {
  scope: AssetScope;
  release: () => void;
  images: ManifestImages<TManifest>;
  audio: ManifestAudio<TManifest>;
  fonts: ManifestFonts<TManifest>;
  spritesheets: ManifestSpritesheets<TManifest>;
};

export const defineAssetManifest = <
  const TImages extends Record<string, string>,
  const TAudio extends Record<string, string> = Record<string, never>,
  const TFonts extends Record<string, FontManifestEntry> = Record<string, never>,
  const TSpritesheets extends Record<
    string,
    SpriteSheetManifestEntry<Extract<keyof TImages, string>>
  > = Record<string, never>,
>(
  manifest: AssetManifest<TImages, TAudio, TFonts, TSpritesheets>,
): AssetManifest<TImages, TAudio, TFonts, TSpritesheets> => manifest;

type AssetLoaders = {
  image: (url: string) => Promise<LoaderResult<HTMLImageElement>>;
  audio: (url: string) => Promise<LoaderResult<HTMLAudioElement>>;
  font: (
    family: string,
    source: string,
    descriptors?: FontFaceDescriptors,
  ) => Promise<LoaderResult<FontFace>>;
  spritesheet: (
    image: HTMLImageElement,
    options: SpriteSheetGridOptions,
  ) => Promise<LoaderResult<SpriteSheetAsset>>;
};

export type AssetManagerOptions = {
  loaders?: Partial<AssetLoaders>;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${parts.join(",")}}`;
};

const ASSET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const assertManifestKey = (section: string, key: string): void => {
  if (!ASSET_KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid asset key '${key}' in ${section}. Use letters, digits, '_' or '-', and start with a letter/digit.`,
    );
  }
};

const hasKnownExt = (url: string, exts: readonly string[]): boolean => {
  const normalized = url.split(/[?#]/, 1)[0]!.toLowerCase();
  return exts.some((ext) => normalized.endsWith(ext));
};

const assertUrlPath = (
  section: string,
  key: string,
  url: string,
  allowedExts: readonly string[],
): void => {
  if (url.trim().length === 0) {
    throw new Error(`Asset '${section}.${key}' has an empty path`);
  }
  if (!hasKnownExt(url, allowedExts)) {
    throw new Error(
      `Asset '${section}.${key}' has unsupported file extension. Expected one of: ${allowedExts.join(", ")}`,
    );
  }
};

const extractFirstFontSourceUrl = (source: string): string | null => {
  const match = source.match(/url\((["']?)([^"')]+)\1\)/i);
  return match?.[2] ?? null;
};

const defaultImageLoader: AssetLoaders["image"] = async (url) => {
  const image = new Image();
  image.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      cleanup();
      resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Failed to load image: ${url}`));
    };

    try {
      image.src = url;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });

  return { asset: image };
};

const defaultAudioLoader: AssetLoaders["audio"] = async (url) => {
  const audio = new Audio();
  audio.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load audio: ${url}`));
    };
    const cleanup = () => {
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("error", onError);
    };

    try {
      audio.addEventListener("canplaythrough", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.src = url;
      audio.load();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });

  return { asset: audio };
};

const defaultFontLoader: AssetLoaders["font"] = async (family, source, descriptors) => {
  const face = new FontFace(family, source, descriptors);
  const loaded = await face.load();
  const fontSet = (document as unknown as { fonts?: { add?: (f: FontFace) => void } }).fonts;
  fontSet?.add?.(loaded);

  return {
    asset: loaded,
    dispose: () => {
      const fonts = (document as unknown as { fonts?: { delete?: (f: FontFace) => void } }).fonts;
      fonts?.delete?.(loaded);
    },
  };
};

const resolveImageDimensions = (image: HTMLImageElement): { width: number; height: number } => {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  return { width, height };
};

const buildSpriteSheetFromGrid = (
  image: HTMLImageElement,
  options: SpriteSheetGridOptions,
): SpriteSheetAsset => {
  const margin = options.margin ?? 0;
  const spacing = options.spacing ?? 0;
  const { width: imageWidth, height: imageHeight } = resolveImageDimensions(image);

  if (options.frameWidth <= 0 || options.frameHeight <= 0) {
    throw new Error("Sprite sheet frameWidth/frameHeight must be > 0");
  }

  const maxColumns = Math.max(
    1,
    Math.floor((imageWidth - margin * 2 + spacing) / (options.frameWidth + spacing)),
  );
  const maxRows = Math.max(
    1,
    Math.floor((imageHeight - margin * 2 + spacing) / (options.frameHeight + spacing)),
  );

  const columns = Math.max(1, Math.min(options.columns ?? maxColumns, maxColumns));
  const rows = Math.max(1, Math.min(options.rows ?? maxRows, maxRows));
  const maxCount = columns * rows;
  const count = Math.max(1, Math.min(options.count ?? maxCount, maxCount));

  const frames: SpriteSheetFrame[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);

    const duration = Array.isArray(options.durationMs) ? options.durationMs[i] : options.durationMs;

    frames.push({
      x: margin + col * (options.frameWidth + spacing),
      y: margin + row * (options.frameHeight + spacing),
      width: options.frameWidth,
      height: options.frameHeight,
      name: options.names?.[i],
      durationMs: duration,
    });
  }

  return {
    image,
    frames,
    tags: options.tags ?? {},
  };
};

const defaultSpriteSheetLoader: AssetLoaders["spritesheet"] = async (image, options) => {
  return { asset: buildSpriteSheetFromGrid(image, options) };
};

const DEFAULT_LOADERS: AssetLoaders = {
  image: defaultImageLoader,
  audio: defaultAudioLoader,
  font: defaultFontLoader,
  spritesheet: defaultSpriteSheetLoader,
};

export class AssetScope {
  constructor(
    private readonly manager: AssetManager,
    public readonly id: string,
    public readonly label: string,
  ) {}

  public async loadImage(alias: string, url: string): Promise<HTMLImageElement> {
    const handle = await this.manager.acquireImage(this.id, alias, url);
    return this.manager.getByHandle(handle) as HTMLImageElement;
  }

  public async loadAudio(alias: string, url: string): Promise<HTMLAudioElement> {
    const handle = await this.manager.acquireAudio(this.id, alias, url);
    return this.manager.getByHandle(handle) as HTMLAudioElement;
  }

  public async loadFont(
    alias: string,
    family: string,
    source: string,
    descriptors?: FontFaceDescriptors,
  ): Promise<FontFace> {
    const handle = await this.manager.acquireFont(this.id, alias, family, source, descriptors);
    return this.manager.getByHandle(handle) as FontFace;
  }

  public async loadSpriteSheetGrid(
    alias: string,
    imageAlias: string,
    options: SpriteSheetGridOptions,
  ): Promise<SpriteSheetAsset> {
    const imageHandle = this.manager.getAliasHandle(this.id, imageAlias);
    if (!imageHandle || imageHandle.kind !== "image") {
      throw new Error(
        `Sprite sheet image alias '${imageAlias}' not found in scope '${this.label}'`,
      );
    }

    const handle = await this.manager.acquireSpriteSheet(this.id, alias, imageHandle, options);
    return this.manager.getByHandle(handle) as SpriteSheetAsset;
  }

  public has(alias: string): boolean {
    return this.manager.getAliasHandle(this.id, alias) !== null;
  }

  public getImage(alias: string): HTMLImageElement {
    return this.get(alias, "image") as HTMLImageElement;
  }

  public getAudio(alias: string): HTMLAudioElement {
    return this.get(alias, "audio") as HTMLAudioElement;
  }

  public getFont(alias: string): FontFace {
    return this.get(alias, "font") as FontFace;
  }

  public getSpriteSheet(alias: string): SpriteSheetAsset {
    return this.get(alias, "spritesheet") as SpriteSheetAsset;
  }

  public releaseAlias(alias: string): void {
    this.manager.releaseAlias(this.id, alias);
  }

  public release(): void {
    this.manager.releaseScope(this.id);
  }

  private get(alias: string, expectedKind: AssetKind): unknown {
    const handle = this.manager.getAliasHandle(this.id, alias);
    if (!handle) {
      throw new Error(`Asset alias '${alias}' is not loaded in scope '${this.label}'`);
    }
    if (handle.kind !== expectedKind) {
      throw new Error(`Asset alias '${alias}' is '${handle.kind}', expected '${expectedKind}'`);
    }
    return this.manager.getByHandle(handle);
  }
}

export class AssetManager {
  private readonly loaders: AssetLoaders;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly scopeAliases = new Map<string, Map<string, AssetHandle>>();
  private scopeCounter = 0;
  private cacheEntryCounter = 0;
  private acquisitionCounter = 0;
  private audioUnlocked = false;
  private audioUnlockTarget: EventTarget | null = null;
  private audioUnlockCleanup: (() => void) | null = null;
  private audioUnlockGeneration = 0;
  private audioUnlockAttemptCounter = 0;
  private readonly audioUnlockAttempts = new Set<number>();
  private audioPreferredUnlockTarget: EventTarget | null = null;
  private readonly pendingAudioPlays: AudioPlayRequest[] = [];

  constructor(options: AssetManagerOptions = {}) {
    this.loaders = {
      image: options.loaders?.image ?? DEFAULT_LOADERS.image,
      audio: options.loaders?.audio ?? DEFAULT_LOADERS.audio,
      font: options.loaders?.font ?? DEFAULT_LOADERS.font,
      spritesheet: options.loaders?.spritesheet ?? DEFAULT_LOADERS.spritesheet,
    };
  }

  public createScope(label = "scope"): AssetScope {
    const id = `${label}:${++this.scopeCounter}`;
    this.scopeAliases.set(id, new Map());
    return new AssetScope(this, id, label);
  }

  public async load<
    const TImages extends Record<string, string>,
    const TAudio extends Record<string, string>,
    const TFonts extends Record<string, FontManifestEntry>,
    const TSpritesheets extends Record<
      string,
      SpriteSheetManifestEntry<Extract<keyof TImages, string>>
    >,
  >(
    manifest: AssetManifest<TImages, TAudio, TFonts, TSpritesheets>,
    options: { scopeLabel?: string } = {},
  ): Promise<LoadedAssetManifest<AssetManifest<TImages, TAudio, TFonts, TSpritesheets>>> {
    const scope = this.createScope(options.scopeLabel ?? "manifest");
    const loaded = {
      scope,
      release: () => scope.release(),
      images: {},
      audio: {},
      fonts: {},
      spritesheets: {},
    } as LoadedAssetManifest<AssetManifest<TImages, TAudio, TFonts, TSpritesheets>>;

    const aliasFor = (section: string, key: string): string => `${section}:${key}`;

    try {
      const images = manifest.images ?? ({} as TImages);
      for (const [key, url] of Object.entries(images)) {
        assertManifestKey("images", key);
        assertUrlPath("images", key, url, [
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
          ".gif",
          ".svg",
          ".avif",
        ]);
        const image = await scope.loadImage(aliasFor("images", key), url);
        (loaded.images as Record<string, HTMLImageElement>)[key] = image;
      }

      const audio = manifest.audio ?? ({} as TAudio);
      for (const [key, url] of Object.entries(audio)) {
        assertManifestKey("audio", key);
        assertUrlPath("audio", key, url, [".ogg", ".mp3", ".wav", ".m4a", ".aac"]);
        const clip = await scope.loadAudio(aliasFor("audio", key), url);
        (loaded.audio as Record<string, HTMLAudioElement>)[key] = clip;
      }

      const fonts = manifest.fonts ?? ({} as TFonts);
      for (const [key, entry] of Object.entries(fonts)) {
        assertManifestKey("fonts", key);
        if (!entry.family.trim()) {
          throw new Error(`Asset 'fonts.${key}' has empty family`);
        }
        const fontUrl = extractFirstFontSourceUrl(entry.source);
        if (!fontUrl) {
          throw new Error(`Asset 'fonts.${key}' must include a url(...) source`);
        }
        assertUrlPath("fonts", key, fontUrl, [".ttf", ".otf", ".woff", ".woff2"]);
        const face = await scope.loadFont(
          aliasFor("fonts", key),
          entry.family,
          entry.source,
          entry.descriptors,
        );
        (loaded.fonts as Record<string, FontFace>)[key] = face;
      }

      const spritesheets = manifest.spritesheets ?? ({} as TSpritesheets);
      for (const [key, entry] of Object.entries(spritesheets)) {
        assertManifestKey("spritesheets", key);
        const imageAlias = aliasFor("images", entry.image);
        if (!scope.has(imageAlias)) {
          throw new Error(
            `Asset 'spritesheets.${key}' references missing image key '${entry.image}'`,
          );
        }
        const sheet = await scope.loadSpriteSheetGrid(
          aliasFor("spritesheets", key),
          imageAlias,
          entry.options,
        );
        (loaded.spritesheets as Record<string, SpriteSheetAsset>)[key] = sheet;
      }

      return loaded;
    } catch (error) {
      scope.release();
      throw error;
    }
  }

  public releaseScope(scopeId: string): void {
    const aliases = this.scopeAliases.get(scopeId);
    if (!aliases) return;

    const errors: unknown[] = [];
    for (const alias of Array.from(aliases.keys())) {
      try {
        this.releaseAlias(scopeId, alias);
      } catch (error) {
        errors.push(error);
      }
    }

    this.scopeAliases.delete(scopeId);
    this.throwDisposalErrors(errors);
  }

  public clear(): void {
    const errors: unknown[] = [];
    for (const scopeId of Array.from(this.scopeAliases.keys())) {
      try {
        this.releaseScope(scopeId);
      } catch (error) {
        errors.push(error);
      }
    }

    const retiredEntries = Array.from(this.entries.values());
    this.entries.clear();
    for (const entry of retiredEntries) {
      try {
        this.maybeCollect(entry);
      } catch (error) {
        errors.push(error);
      }
    }
    this.resetAudioUnlock();
    this.throwDisposalErrors(errors);
  }

  public playAudio(
    audio: HTMLAudioElement | undefined,
    options: { volume?: number; unlockTarget?: EventTarget | null } = {},
  ): void {
    if (!audio) return;
    const volume = this.normalizeVolume(options.volume);
    const unlockTarget =
      options.unlockTarget === undefined ? this.getDefaultUnlockTarget() : options.unlockTarget;
    const generation = this.audioUnlockGeneration;

    if (this.audioUnlocked) {
      void this.playAudioNow(audio, volume).then((played) => {
        if (played || generation !== this.audioUnlockGeneration) return;
        this.audioUnlocked = false;
        if (unlockTarget) {
          this.pendingAudioPlays.push({ audio, volume });
          this.audioPreferredUnlockTarget = unlockTarget;
          this.installAudioUnlock(unlockTarget);
        }
      });
      return;
    }

    if (!unlockTarget) {
      // Non-browser environment or unavailable unlock target: best-effort immediate play.
      void this.playAudioNow(audio, volume).then((played) => {
        if (!played || generation !== this.audioUnlockGeneration) return;
        this.drainPendingAudio();
      });
      return;
    }

    this.pendingAudioPlays.push({ audio, volume });
    this.audioPreferredUnlockTarget = unlockTarget;
    this.installAudioUnlock(unlockTarget);
  }

  public getStats(): {
    scopes: number;
    cachedAssets: number;
    refs: number;
  } {
    let refs = 0;
    for (const entry of this.entries.values()) refs += entry.refs;

    return {
      scopes: this.scopeAliases.size,
      cachedAssets: this.entries.size,
      refs,
    };
  }

  public getByHandle(handle: AssetHandle): unknown {
    const entry = this.getEntryByHandle(handle);
    if (!entry?.value) {
      throw new Error(`Asset '${handle.cacheKey}' is not loaded`);
    }
    return entry.value;
  }

  public getAliasHandle(scopeId: string, alias: string): AssetHandle | null {
    const handle = this.scopeAliases.get(scopeId)?.get(alias);
    if (!handle || !this.getEntryByHandle(handle)?.value) return null;
    return handle;
  }

  public async acquireImage(scopeId: string, alias: string, url: string): Promise<AssetHandle> {
    const cacheKey = `image:${url}`;
    return this.acquire(scopeId, alias, "image", cacheKey, async () => this.loaders.image(url), []);
  }

  public async acquireAudio(scopeId: string, alias: string, url: string): Promise<AssetHandle> {
    const cacheKey = `audio:${url}`;
    return this.acquire(scopeId, alias, "audio", cacheKey, async () => this.loaders.audio(url), []);
  }

  public async acquireFont(
    scopeId: string,
    alias: string,
    family: string,
    source: string,
    descriptors?: FontFaceDescriptors,
  ): Promise<AssetHandle> {
    const cacheKey = `font:${family}:${source}:${stableStringify(descriptors ?? {})}`;
    return this.acquire(
      scopeId,
      alias,
      "font",
      cacheKey,
      async () => this.loaders.font(family, source, descriptors),
      [],
    );
  }

  public async acquireSpriteSheet(
    scopeId: string,
    alias: string,
    imageHandle: AssetHandle,
    options: SpriteSheetGridOptions,
  ): Promise<AssetHandle> {
    if (imageHandle.kind !== "image") {
      throw new Error("Sprite sheets can only be created from image assets");
    }

    const imageEntry = this.getEntryByHandle(imageHandle);
    if (!imageEntry?.value) {
      throw new Error(`Image asset '${imageHandle.cacheKey}' must be loaded before spritesheet`);
    }

    const cacheKey = `spritesheet:${imageHandle.cacheKey}:${stableStringify(options)}`;
    return this.acquire(
      scopeId,
      alias,
      "spritesheet",
      cacheKey,
      async () => this.loaders.spritesheet(imageEntry.value as HTMLImageElement, options),
      [imageEntry],
    );
  }

  public releaseAlias(scopeId: string, alias: string): void {
    const scopeAliases = this.scopeAliases.get(scopeId);
    if (!scopeAliases) return;

    const handle = scopeAliases.get(alias);
    if (!handle) return;

    scopeAliases.delete(alias);
    const entry = this.getEntryByHandle(handle);
    if (entry) {
      this.decrementRef(entry);
    }
  }

  private getScopeAliases(scopeId: string): Map<string, AssetHandle> {
    const scopeAliases = this.scopeAliases.get(scopeId);
    if (!scopeAliases) {
      throw new Error(`Asset scope '${scopeId}' is not registered`);
    }
    return scopeAliases;
  }

  private getEntryByHandle(handle: AssetHandle): CacheEntry | null {
    const entry = this.entries.get(handle.cacheKey);
    return entry?.id === handle.entryId ? entry : null;
  }

  private async acquire(
    scopeId: string,
    alias: string,
    kind: AssetKind,
    cacheKey: string,
    loader: () => Promise<LoaderResult<any>>,
    dependencies: CacheEntry[],
  ): Promise<AssetHandle> {
    const scopeAliases = this.getScopeAliases(scopeId);
    if (scopeAliases.has(alias)) {
      throw new Error(`Asset alias '${alias}' already exists in this scope`);
    }
    let entry = this.entries.get(cacheKey);
    if (entry) {
      const handle = {
        kind,
        cacheKey,
        entryId: entry.id,
        acquisitionId: ++this.acquisitionCounter,
      };
      this.incrementRef(entry);
      scopeAliases.set(alias, handle);

      try {
        await entry.promise;
        this.assertAcquisitionActive(scopeId, scopeAliases, alias, handle);
      } catch (error) {
        this.rollbackAlias(scopeAliases, alias, handle, entry);
        throw error;
      }
      return handle;
    }

    for (const dependency of dependencies) {
      this.incrementRef(dependency);
    }

    entry = {
      id: ++this.cacheEntryCounter,
      kind,
      cacheKey,
      refs: 1,
      promise: null,
      value: null,
      dispose: null,
      dependencies,
      collected: false,
    };
    const handle = {
      kind,
      cacheKey,
      entryId: entry.id,
      acquisitionId: ++this.acquisitionCounter,
    };
    this.entries.set(cacheKey, entry);
    scopeAliases.set(alias, handle);

    const loadPromise = (async () => {
      const loaded = await loader();
      entry!.value = loaded.asset;
      entry!.dispose = loaded.dispose ?? null;
      return loaded.asset;
    })();

    entry.promise = loadPromise;

    try {
      await loadPromise;
      this.assertAcquisitionActive(scopeId, scopeAliases, alias, handle);
    } catch (error) {
      this.rollbackAlias(scopeAliases, alias, handle, entry);
      throw error;
    } finally {
      entry.promise = null;
      this.maybeCollect(entry);
    }
    return handle;
  }

  private assertAcquisitionActive(
    scopeId: string,
    scopeAliases: Map<string, AssetHandle>,
    alias: string,
    handle: AssetHandle,
  ): void {
    const activeHandle = scopeAliases.get(alias);
    if (
      this.scopeAliases.get(scopeId) !== scopeAliases ||
      activeHandle?.acquisitionId !== handle.acquisitionId
    ) {
      throw new Error(`Asset scope '${scopeId}' is no longer active`);
    }
  }

  private rollbackAlias(
    scopeAliases: Map<string, AssetHandle>,
    alias: string,
    handle: AssetHandle,
    entry: CacheEntry,
  ): void {
    if (scopeAliases.get(alias)?.acquisitionId !== handle.acquisitionId) return;
    scopeAliases.delete(alias);
    this.decrementRef(entry);
  }

  private incrementRef(entry: CacheEntry): void {
    if (entry.collected) {
      throw new Error(`Asset '${entry.cacheKey}' has already been disposed`);
    }
    entry.refs++;
  }

  private decrementRef(entry: CacheEntry): void {
    if (entry.collected) return;
    entry.refs = Math.max(0, entry.refs - 1);
    this.maybeCollect(entry);
  }

  private maybeCollect(entry: CacheEntry): void {
    if (entry.collected) return;
    if (entry.refs > 0) return;
    if (entry.promise) return;

    entry.collected = true;
    if (this.entries.get(entry.cacheKey) === entry) {
      this.entries.delete(entry.cacheKey);
    }

    const errors: unknown[] = [];
    try {
      entry.dispose?.();
    } catch (error) {
      errors.push(error);
    }
    for (const dependency of entry.dependencies) {
      try {
        this.decrementRef(dependency);
      } catch (error) {
        errors.push(error);
      }
    }
    this.throwDisposalErrors(errors);
  }

  private installAudioUnlock(target: EventTarget): void {
    if (this.audioUnlocked) return;
    if (this.audioUnlockTarget === target && this.audioUnlockCleanup) return;

    this.clearAudioUnlockListeners();
    this.audioUnlockTarget = target;

    const generation = this.audioUnlockGeneration;
    const unlock = () => {
      if (generation !== this.audioUnlockGeneration || this.audioUnlockCleanup !== cleanup) {
        cleanup();
        return;
      }
      cleanup();
      if (this.audioUnlocked) return;
      this.primeLoadedAudio();
      this.drainPendingAudio();
    };

    const cleanup = () => {
      target.removeEventListener("pointerdown", unlock as EventListener);
      target.removeEventListener("keydown", unlock as EventListener);
      target.removeEventListener("touchstart", unlock as EventListener);
      if (this.audioUnlockCleanup === cleanup) {
        this.audioUnlockCleanup = null;
        this.audioUnlockTarget = null;
      }
    };

    this.audioUnlockCleanup = cleanup;
    try {
      target.addEventListener("pointerdown", unlock as EventListener, { once: true });
      target.addEventListener("keydown", unlock as EventListener, { once: true });
      target.addEventListener("touchstart", unlock as EventListener, { once: true });
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  private resetAudioUnlock(): void {
    this.audioUnlockGeneration++;
    this.clearAudioUnlockListeners();
    this.audioUnlocked = false;
    this.audioUnlockAttempts.clear();
    this.audioPreferredUnlockTarget = null;
    this.pendingAudioPlays.length = 0;
  }

  private clearAudioUnlockListeners(): void {
    this.audioUnlockCleanup?.();
    this.audioUnlockCleanup = null;
    this.audioUnlockTarget = null;
  }

  private getDefaultUnlockTarget(): EventTarget | null {
    if (typeof window !== "undefined") return window;
    return null;
  }

  private normalizeVolume(volume: number | undefined): number {
    if (volume === undefined || Number.isNaN(volume)) return 1;
    return Math.min(1, Math.max(0, volume));
  }

  private async playAudioNow(audio: HTMLAudioElement, volume: number): Promise<boolean> {
    try {
      const instance = audio.cloneNode(true) as HTMLAudioElement;
      instance.volume = volume;
      instance.currentTime = 0;
      await instance.play();
      return true;
    } catch {
      return false;
    }
  }

  private drainPendingAudio(): void {
    const queue = this.pendingAudioPlays.splice(0);
    if (queue.length === 0) {
      this.reconcileAudioUnlock();
      return;
    }

    this.audioUnlocked = false;
    this.clearAudioUnlockListeners();
    const generation = this.audioUnlockGeneration;
    const attemptId = ++this.audioUnlockAttemptCounter;
    this.audioUnlockAttempts.add(attemptId);

    void Promise.all(
      queue.map(async (request) => ({
        request,
        played: await this.playAudioNow(request.audio, request.volume),
      })),
    ).then((results) => {
      if (generation !== this.audioUnlockGeneration) return;

      this.audioUnlockAttempts.delete(attemptId);
      const failed = results.filter((result) => !result.played).map((result) => result.request);
      this.pendingAudioPlays.unshift(...failed);
      this.reconcileAudioUnlock();
    });
  }

  private reconcileAudioUnlock(): void {
    if (this.audioUnlockAttempts.size > 0) return;
    if (this.pendingAudioPlays.length === 0) {
      this.audioUnlocked = true;
      this.clearAudioUnlockListeners();
      return;
    }

    this.audioUnlocked = false;
    if (this.audioUnlockCleanup || !this.audioPreferredUnlockTarget) return;
    this.installAudioUnlock(this.audioPreferredUnlockTarget);
  }

  private throwDisposalErrors(errors: unknown[]): void {
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "One or more asset disposers failed");
    }
  }

  private primeLoadedAudio(): void {
    for (const entry of this.entries.values()) {
      if (entry.kind !== "audio" || !isAudioLike(entry.value)) continue;
      try {
        const probe = entry.value.cloneNode(true) as HTMLAudioElement;
        probe.muted = true;
        probe.volume = 0;
        probe.currentTime = 0;
        void probe
          .play()
          .then(() => {
            probe.pause?.();
            probe.currentTime = 0;
          })
          .catch(() => {
            // Best-effort warmup; ignore if browser still blocks.
          });
      } catch {
        // Best-effort warmup; continue priming other clips.
      }
    }
  }
}
