import { CollisionEntity } from "../collision/CollisionEntity.ts";
import { CurveCollisionShape } from "../collision/shapes/CurveCollisionShape.ts";
import { type System, SystemPhase, SystemTickMode } from "../world/System.ts";
import { TransformComponent } from "../transform/TransformComponent.ts";
import { SpatialHashBroadphase } from "../collision/SpatialHashBroadphase.ts";
import { Vector2D } from "../math/Vector2D.ts";
import { EcsRuntime } from "../ecs/EcsRuntime.ts";
import { PhysicsBodyComponent } from "./PhysicsBodyComponent.ts";
import { PhysicsBodyType } from "./PhysicsBodyType.ts";
import type { PhysicsStepStats, PhysicsSystemOptions } from "./types.ts";

type BodyEntry = {
  body: PhysicsBodyComponent;
  transform: TransformComponent;
  collider: CollisionEntity;
};

type Contact = {
  orderA: number;
  orderB: number;
  a: BodyEntry;
  b: BodyEntry;
  normal: Vector2D;
  penetration: number;
  coincidentNormal: Vector2D | null;
};

const EPS = 1e-8;
const requireFiniteAtLeast = (value: number, minimum: number, name: string): number => {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be finite and >= ${minimum}`);
  }
  return value;
};
const requireIterationCount = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 1) throw new Error(`${name} must be finite and >= 1`);
  return Math.floor(value);
};

export class PhysicsSystem implements System {
  public readonly phase = SystemPhase.Collision;
  public readonly tickMode = SystemTickMode.Fixed;

  private readonly gravity: Vector2D;
  private readonly velocityIterations: number;
  private readonly positionIterations: number;
  private readonly maxPenetrationCorrection: number;
  private readonly penetrationSlop: number;
  private readonly sleepLinearThreshold: number;
  private readonly sleepTimeThreshold: number;
  private readonly broadphase: SpatialHashBroadphase;

  private readonly warnedMissingTransform = new Set<string>();
  private readonly warnedMissingCollider = new Set<string>();
  private readonly warnedCurveDynamic = new Set<string>();

  private stepStats: PhysicsStepStats = {
    colliders: 0,
    broadphasePairs: 0,
    contacts: 0,
    sleepingBodies: 0,
  };

  constructor(options: PhysicsSystemOptions = {}) {
    this.gravity = options.gravity?.clone() ?? new Vector2D(0, 980);
    if (!Number.isFinite(this.gravity.x) || !Number.isFinite(this.gravity.y)) {
      throw new Error("Physics gravity must be finite");
    }
    this.velocityIterations = requireIterationCount(
      options.velocityIterations ?? 4,
      "Velocity iterations",
    );
    this.positionIterations = requireIterationCount(
      options.positionIterations ?? 2,
      "Position iterations",
    );
    this.maxPenetrationCorrection = requireFiniteAtLeast(
      options.maxPenetrationCorrection ?? 8,
      0,
      "Maximum penetration correction",
    );
    this.penetrationSlop = requireFiniteAtLeast(
      options.penetrationSlop ?? 0.01,
      0,
      "Penetration slop",
    );
    this.sleepLinearThreshold = requireFiniteAtLeast(
      options.sleepLinearThreshold ?? 8,
      0,
      "Sleep linear threshold",
    );
    this.sleepTimeThreshold = requireFiniteAtLeast(
      options.sleepTimeThreshold ?? 0.35,
      0,
      "Sleep time threshold",
    );
    this.broadphase = new SpatialHashBroadphase(options.broadphaseCellSize ?? 64);
  }

  public update(deltaTime: number): void {
    requireFiniteAtLeast(deltaTime, 0, "Physics delta time");
    const entries = this.collectBodies();

    this.integrate(deltaTime, entries);

    const colliders = entries.map((entry) => entry.collider);
    const colliderToBody = new Map<CollisionEntity, { entry: BodyEntry; order: number }>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      colliderToBody.set(entry.collider, { entry, order: i });
    }
    const pairs = this.broadphase.queryPairs(colliders);

    const contacts: Contact[] = [];
    for (const [colA, colB] of pairs) {
      const itemA = colliderToBody.get(colA);
      const itemB = colliderToBody.get(colB);
      if (!itemA || !itemB) continue;
      const a = itemA.entry;
      const b = itemB.entry;

      const mtv = a.collider.getCollisionNormal(b.collider);
      if (!mtv) continue;

      const penetration = mtv.magnitude;
      if (penetration <= EPS) continue;

      const contact: Contact = {
        orderA: itemA.order,
        orderB: itemB.order,
        a,
        b,
        normal: Vector2D.zero,
        penetration,
        coincidentNormal: null,
      };
      this.configureContactGeometry(contact, mtv, true);
      contacts.push(contact);

      if (this.hasMeaningfulPenetration(contact.penetration)) {
        if (a.body.type === PhysicsBodyType.Dynamic && a.body.isSleeping) a.body.wake();
        if (b.body.type === PhysicsBodyType.Dynamic && b.body.isSleeping) b.body.wake();
      }

      const relativeSpeed = b.body.getVelocity().subtract(a.body.getVelocity()).magnitude;
      if (relativeSpeed > this.sleepLinearThreshold) {
        if (a.body.isSleeping && this.canMove(b.body) && !b.body.isSleeping) a.body.wake();
        if (b.body.isSleeping && this.canMove(a.body) && !a.body.isSleeping) b.body.wake();
      }
    }

    contacts.sort((a, b) => a.orderA - b.orderA || a.orderB - b.orderB);

    for (let i = 0; i < this.velocityIterations; i++) {
      for (const contact of contacts) {
        this.solveVelocity(contact);
      }
    }

    for (let i = 0; i < this.positionIterations; i++) {
      for (const contact of contacts) {
        this.solvePosition(contact);
      }
    }

    const activeContactBodies = new Set<PhysicsBodyComponent>();
    for (const contact of contacts) {
      const relativeSpeed = contact.b.body
        .getVelocity()
        .subtract(contact.a.body.getVelocity()).magnitude;
      if (relativeSpeed > this.sleepLinearThreshold) {
        activeContactBodies.add(contact.a.body);
        activeContactBodies.add(contact.b.body);
      }
      if (this.refreshContact(contact) && this.hasMeaningfulPenetration(contact.penetration)) {
        if (contact.a.body.type === PhysicsBodyType.Dynamic) {
          activeContactBodies.add(contact.a.body);
        }
        if (contact.b.body.type === PhysicsBodyType.Dynamic) {
          activeContactBodies.add(contact.b.body);
        }
      }
    }
    this.updateSleeping(deltaTime, entries, activeContactBodies);

    this.stepStats = {
      colliders: entries.length,
      broadphasePairs: pairs.length,
      contacts: contacts.length,
      sleepingBodies: entries.reduce((count, entry) => count + (entry.body.isSleeping ? 1 : 0), 0),
    };
  }

  public getLastStepStats(): PhysicsStepStats {
    return this.stepStats;
  }

  private collectBodies(): BodyEntry[] {
    const entries: BodyEntry[] = [];

    for (const entity of this.getAllEntities()) {
      if (!entity.hasComponent(PhysicsBodyComponent)) continue;

      if (!entity.hasComponent(TransformComponent)) {
        if (!this.warnedMissingTransform.has(entity.id)) {
          this.warnedMissingTransform.add(entity.id);
          console.warn(`PhysicsSystem: ${entity.constructor.name} is missing TransformComponent`);
        }
        continue;
      }

      const collider =
        entity.getChild(CollisionEntity) ?? (entity instanceof CollisionEntity ? entity : null);
      if (!collider) {
        if (!this.warnedMissingCollider.has(entity.id)) {
          this.warnedMissingCollider.add(entity.id);
          console.warn(
            `PhysicsSystem: ${entity.constructor.name} is missing CollisionEntity child`,
          );
        }
        continue;
      }

      const body = entity.getComponent(PhysicsBodyComponent);
      if (collider.shape instanceof CurveCollisionShape && body.type !== PhysicsBodyType.Static) {
        if (!this.warnedCurveDynamic.has(entity.id)) {
          this.warnedCurveDynamic.add(entity.id);
          console.warn(
            `PhysicsSystem: Curve colliders must be static. ${entity.constructor.name} will be treated as static.`,
          );
        }
      }

      entries.push({
        body,
        transform: entity.getComponent(TransformComponent),
        collider,
      });
    }

    return entries;
  }

  private getAllEntities() {
    return EcsRuntime.getCurrent().registry.getAllEntities();
  }

  private integrate(dt: number, entries: BodyEntry[]): void {
    for (const entry of entries) {
      const body = entry.body;

      if (body.type === PhysicsBodyType.Static || this.isCurveForcedStatic(entry)) {
        continue;
      }

      if (body.type === PhysicsBodyType.Kinematic) {
        const v = body.getVelocity();
        entry.transform.translateWorld(v.x * dt, v.y * dt);
        continue;
      }

      if (body.isSleeping) continue;

      const forceAcc = body.consumeForces().multiply(body.invMass);
      const gravityAcc = this.gravity.multiply(body.gravityScale);
      const accel = gravityAcc.add(forceAcc);

      let velocity = body.getVelocity().add(accel.multiply(dt));
      const damping = Math.max(0, 1 - body.linearDamping * dt);
      velocity = velocity.multiply(damping);

      body.setVelocity(velocity, false);

      entry.transform.translateWorld(velocity.x * dt, velocity.y * dt);
    }
  }

  private solveVelocity(contact: Contact): void {
    const bodyA = contact.a.body;
    const bodyB = contact.b.body;

    if (!this.canResolvePair(bodyA, bodyB, contact.a, contact.b)) return;

    const vA = bodyA.getVelocity();
    const vB = bodyB.getVelocity();
    const rv = vB.subtract(vA);

    const velAlongNormal = rv.dot(contact.normal);
    if (velAlongNormal > 0) return;

    const invMassA = this.effectiveInvMass(contact.a);
    const invMassB = this.effectiveInvMass(contact.b);
    const invMassSum = invMassA + invMassB;
    if (invMassSum <= EPS) return;

    const restitution = Math.max(bodyA.restitution, bodyB.restitution);
    const impulseScalar = (-(1 + restitution) * velAlongNormal) / invMassSum;
    const impulse = contact.normal.multiply(impulseScalar);

    if (invMassA > 0) bodyA.applyImpulse(impulse.negate(), false);
    if (invMassB > 0) bodyB.applyImpulse(impulse, false);

    const nextVA = bodyA.getVelocity();
    const nextVB = bodyB.getVelocity();
    const nextRv = nextVB.subtract(nextVA);

    const tangentBase = nextRv.subtract(contact.normal.multiply(nextRv.dot(contact.normal)));
    if (tangentBase.magnitude <= EPS) return;

    const tangent = tangentBase.normalize();
    const jt = -nextRv.dot(tangent) / invMassSum;
    const friction = Math.sqrt(bodyA.friction * bodyB.friction);
    const maxFriction = impulseScalar * friction;
    const clampedJt = Math.max(-maxFriction, Math.min(jt, maxFriction));
    const frictionImpulse = tangent.multiply(clampedJt);

    if (invMassA > 0) bodyA.applyImpulse(frictionImpulse.negate(), false);
    if (invMassB > 0) bodyB.applyImpulse(frictionImpulse, false);
  }

  private solvePosition(contact: Contact): void {
    if (!this.refreshContact(contact)) return;

    const invMassA = this.effectiveInvMass(contact.a);
    const invMassB = this.effectiveInvMass(contact.b);
    const invMassSum = invMassA + invMassB;
    if (invMassSum <= EPS) return;

    const correctedPenetration = Math.max(contact.penetration - this.penetrationSlop, 0);
    if (correctedPenetration <= EPS) return;

    const correctionMagnitude = Math.min(
      (correctedPenetration / invMassSum) * 0.8,
      this.maxPenetrationCorrection,
    );
    const correction = contact.normal.multiply(correctionMagnitude);

    if (invMassA > 0) {
      contact.a.transform.translateWorld(-correction.x * invMassA, -correction.y * invMassA);
    }

    if (invMassB > 0) {
      contact.b.transform.translateWorld(correction.x * invMassB, correction.y * invMassB);
    }
  }

  private refreshContact(contact: Contact): boolean {
    const mtv = contact.a.collider.getCollisionNormal(contact.b.collider);
    if (!mtv || mtv.magnitude <= EPS) return false;
    this.configureContactGeometry(contact, mtv, false);
    return true;
  }

  private configureContactGeometry(
    contact: Contact,
    mtv: Vector2D,
    detectCoincidence: boolean,
  ): void {
    let penetration = mtv.magnitude;
    // Shape MTV moves A out of B; the impulse solver uses a normal from A to B.
    let normal = mtv.multiply(-1 / penetration);
    if (contact.coincidentNormal) {
      contact.normal = contact.coincidentNormal;
      contact.penetration = penetration;
      return;
    }
    if (!detectCoincidence) {
      contact.normal = normal;
      contact.penetration = penetration;
      return;
    }

    const boundsA = contact.a.collider.bbox();
    const boundsB = contact.b.collider.bbox();
    const centerDx = boundsB.x + boundsB.width / 2 - (boundsA.x + boundsA.width / 2);
    const centerDy = boundsB.y + boundsB.height / 2 - (boundsA.y + boundsA.height / 2);

    if (Math.abs(centerDx) <= EPS && Math.abs(centerDy) <= EPS) {
      const relativeVelocity = contact.b.body.getVelocity().subtract(contact.a.body.getVelocity());
      const moving = relativeVelocity.magnitude > EPS;
      const useX = moving
        ? Math.abs(relativeVelocity.x) >= Math.abs(relativeVelocity.y)
        : Math.abs(normal.x) >= Math.abs(normal.y);
      const relativeAxisVelocity = useX ? relativeVelocity.x : relativeVelocity.y;
      let sign: number;

      if (moving && Math.abs(relativeAxisVelocity) > EPS) {
        sign = relativeAxisVelocity > 0 ? -1 : 1;
      } else {
        const mobilityA = this.mobilityRank(contact.a.body);
        const mobilityB = this.mobilityRank(contact.b.body);
        sign = mobilityA === mobilityB ? 1 : mobilityA > mobilityB ? 1 : -1;
      }
      contact.coincidentNormal = useX ? new Vector2D(sign, 0) : new Vector2D(0, sign);

      normal = contact.coincidentNormal;
      penetration =
        normal.x !== 0
          ? Math.min(boundsA.x + boundsA.width, boundsB.x + boundsB.width) -
            Math.max(boundsA.x, boundsB.x)
          : Math.min(boundsA.y + boundsA.height, boundsB.y + boundsB.height) -
            Math.max(boundsA.y, boundsB.y);
    }

    contact.normal = normal;
    contact.penetration = penetration;
  }

  private mobilityRank(body: PhysicsBodyComponent): number {
    if (body.type === PhysicsBodyType.Dynamic) return 2;
    if (body.type === PhysicsBodyType.Kinematic) return 1;
    return 0;
  }

  private hasMeaningfulPenetration(penetration: number): boolean {
    return penetration > Math.max(this.penetrationSlop * 3, this.penetrationSlop + EPS);
  }

  private updateSleeping(
    dt: number,
    entries: BodyEntry[],
    activeContactBodies: Set<PhysicsBodyComponent>,
  ): void {
    for (const entry of entries) {
      const body = entry.body;
      if (!body.canSleep || body.type !== PhysicsBodyType.Dynamic) continue;

      const speed = body.getVelocity().magnitude;
      if (speed <= this.sleepLinearThreshold && !activeContactBodies.has(body)) {
        body.accumulateSleepTime(dt);
        if (body.sleepTime >= this.sleepTimeThreshold) {
          body.sleep();
        }
      } else {
        body.resetSleepTime();
      }
    }
  }

  private canMove(body: PhysicsBodyComponent): boolean {
    return body.type === PhysicsBodyType.Dynamic || body.type === PhysicsBodyType.Kinematic;
  }

  private canResolvePair(
    bodyA: PhysicsBodyComponent,
    bodyB: PhysicsBodyComponent,
    entryA: BodyEntry,
    entryB: BodyEntry,
  ): boolean {
    return (
      this.effectiveInvMass(entryA) > 0 ||
      this.effectiveInvMass(entryB) > 0 ||
      (bodyA.type === PhysicsBodyType.Dynamic && bodyB.type === PhysicsBodyType.Kinematic) ||
      (bodyB.type === PhysicsBodyType.Dynamic && bodyA.type === PhysicsBodyType.Kinematic)
    );
  }

  private effectiveInvMass(entry: BodyEntry): number {
    if (this.isCurveForcedStatic(entry)) return 0;
    if (entry.body.isSleeping) return 0;
    return entry.body.invMass;
  }

  private isCurveForcedStatic(entry: BodyEntry): boolean {
    return entry.collider.shape instanceof CurveCollisionShape;
  }
}
