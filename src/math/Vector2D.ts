export class Vector2D {
  constructor(
    public x: number,
    public y: number,
  ) {}

  subtract(v: Vector2D): Vector2D {
    return new Vector2D(this.x - v.x, this.y - v.y);
  }

  add(v: Vector2D): Vector2D {
    return new Vector2D(this.x + v.x, this.y + v.y);
  }

  multiply(scalar: number): Vector2D;
  multiply(v: Vector2D): Vector2D;
  multiply(scalarOrVector: number | Vector2D): Vector2D {
    if (typeof scalarOrVector === "number") {
      return new Vector2D(this.x * scalarOrVector, this.y * scalarOrVector);
    }
    return new Vector2D(this.x * scalarOrVector.x, this.y * scalarOrVector.y);
  }

  dot(v: Vector2D): number {
    return this.x * v.x + this.y * v.y;
  }

  get magnitude(): number {
    return Math.hypot(this.x, this.y);
  }

  /**
   * Returns the angle in radians pointing from this vector's position toward `v`.
   * This target-minus-source behavior is the intentional 0.2.0 correction.
   */
  angleTo(v: Vector2D): number {
    return Math.atan2(v.y - this.y, v.x - this.x);
  }

  /**
   * Returns the legacy reverse angle, pointing from `v` toward this vector's position.
   * @deprecated Prefer `v.angleTo(this)` so the direction is explicit at the call site.
   */
  angleFrom(v: Vector2D): number {
    return Math.atan2(this.y - v.y, this.x - v.x);
  }

  normalize(): Vector2D {
    const magnitude = this.magnitude;
    if (magnitude === 0) {
      return Vector2D.zero;
    }
    return new Vector2D(this.x / magnitude, this.y / magnitude);
  }

  scale(scalar: number): Vector2D {
    return new Vector2D(this.x * scalar, this.y * scalar);
  }

  divide(scalar: number): Vector2D;
  divide(v: Vector2D): Vector2D;
  divide(scalarOrVector: number | Vector2D): Vector2D {
    if (typeof scalarOrVector === "number") {
      return new Vector2D(this.x / scalarOrVector, this.y / scalarOrVector);
    }
    return new Vector2D(this.x / scalarOrVector.x, this.y / scalarOrVector.y);
  }

  negate(): Vector2D {
    return new Vector2D(this.x === 0 ? 0 : -this.x, this.y === 0 ? 0 : -this.y);
  }

  clone(): Vector2D {
    return new Vector2D(this.x, this.y);
  }

  lerp(target: Vector2D, t: number): Vector2D {
    return new Vector2D(this.x + (target.x - this.x) * t, this.y + (target.y - this.y) * t);
  }

  distanceTo(v: Vector2D): number {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  public set(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  public static get zero(): Vector2D {
    return new Vector2D(0, 0);
  }

  public static get one(): Vector2D {
    return new Vector2D(1, 1);
  }

  /**
   * Returns a Vector2D with the current browser window dimensions.
   * Note: allocates a new Vector2D on each call — cache at call site if used in a loop.
   */
  public static fromScreen(): Vector2D {
    return new Vector2D(window.innerWidth, window.innerHeight);
  }

  static fromAngle(angle: number): Vector2D {
    return new Vector2D(Math.cos(angle), Math.sin(angle));
  }
}
