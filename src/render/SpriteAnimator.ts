export type SpriteClip<TFrame> = {
  frames: TFrame[];
  frameDuration: number;
  loop?: boolean;
};

export class SpriteAnimator<TFrame> {
  private readonly clips = new Map<string, SpriteClip<TFrame>>();
  private activeClipName: string | null = null;
  private frameIndex = 0;
  private frameTime = 0;
  private currentFrame: TFrame;

  constructor(initialFrame: TFrame) {
    this.currentFrame = initialFrame;
  }

  public defineClip(name: string, clip: SpriteClip<TFrame>): this {
    if (clip.frames.length === 0) {
      throw new Error("Sprite clip must include at least one frame");
    }
    if (!Number.isFinite(clip.frameDuration) || !(clip.frameDuration > 0)) {
      throw new Error("Sprite clip frameDuration must be finite and > 0");
    }
    this.clips.set(name, { ...clip, frames: [...clip.frames] });
    return this;
  }

  public play(name: string): this {
    if (this.activeClipName === name) return this;
    const clip = this.clips.get(name);
    if (!clip) {
      throw new Error(`Unknown sprite clip: ${name}`);
    }
    this.activeClipName = name;
    this.frameIndex = 0;
    this.frameTime = 0;
    this.currentFrame = clip.frames[0]!;
    return this;
  }

  public update(dt: number): void {
    const clip = this.activeClipName ? this.clips.get(this.activeClipName) : null;
    if (!clip || clip.frames.length <= 1 || !Number.isFinite(dt) || !(dt > 0)) return;

    const frameCount = clip.frames.length;
    const looping = clip.loop ?? true;
    const cycleDuration = clip.frameDuration * frameCount;
    const elapsed = looping && Number.isFinite(cycleDuration) ? dt % cycleDuration : dt;
    const untilNextFrame = clip.frameDuration - this.frameTime;
    if (elapsed < untilNextFrame) {
      this.frameTime += elapsed;
      return;
    }

    const remaining = elapsed - untilNextFrame;
    const additionalSteps = Math.floor(remaining / clip.frameDuration);
    const steps = Number.isFinite(additionalSteps) ? 1 + additionalSteps : frameCount;
    this.frameTime = remaining % clip.frameDuration;

    this.frameIndex = looping
      ? (this.frameIndex + (steps % frameCount)) % frameCount
      : Math.min(this.frameIndex + steps, frameCount - 1);
    this.currentFrame = clip.frames[this.frameIndex]!;
  }

  public getFrame(): TFrame {
    return this.currentFrame;
  }
}
