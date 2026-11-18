import * as THREE from 'three';
import { PLATFORM, PLAYER } from '../config';
import type { CollisionWorld, Point2 } from '../physics/collision';
import { clamp, damp, dampAngle, easeInOutCubic, lerp, smoothstep, wrapAngle } from '../utils/math';
import { chairLocalToWorld, SEAT_DEPTH, type ChairInfo } from '../world/chairs';

export type PlayerMode = 'free' | 'sitting' | 'seated' | 'standing';

export interface MoveInput {
  x: number;
  y: number;
  run: boolean;
  jump: boolean;
}

type Stage = 'route' | 'settle' | 'rise';

const ROUTE_SPEED = 2.3;
const SETTLE_DURATION = 1.0;
const RISE_DURATION = 0.8;
/** How far in front of the chair the player turns around to sit; the shell is open there. */
const FRONT_REACH = 0.62;

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Direction the body faces; forward is (sin yaw, 0, cos yaw). */
  yaw = 0;
  grounded = true;
  groundY = 0;
  mode: PlayerMode = 'free';
  seat: ChairInfo | null = null;
  /** Pose weight from standing (0) to seated (1). */
  sit = 0;
  /** Horizontal ground speed this frame, including scripted sit/stand moves. */
  moveSpeed = 0;

  private stage: Stage = 'route';
  private stageTime = 0;
  private stageDuration = 1;
  private readonly route: THREE.Vector3[] = [];
  private readonly routeLengths: number[] = [];
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private fromYaw = 0;
  private toYaw = 0;
  private readonly p2: Point2 = { x: 0, z: 0 };
  private readonly probe = new THREE.Vector3();

  private readonly world: CollisionWorld;
  private readonly chairs: ChairInfo[];

  constructor(world: CollisionWorld, chairs: ChairInfo[]) {
    this.world = world;
    this.chairs = chairs;
  }

  spawn(angle: number, radius: number): void {
    this.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    this.position.y = this.world.groundAt(this.position.x, this.position.z, 10, 0);
    this.groundY = this.position.y;
    this.yaw = Math.atan2(-this.position.x, -this.position.z);
    this.velocity.set(0, 0, 0);
    this.mode = 'free';
    this.seat = null;
    this.sit = 0;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** True while the body is in or at the seat: settling in, seated, or rising. */
  get inSeat(): boolean {
    if (this.mode === 'seated') return true;
    if (this.mode === 'sitting') return this.stage === 'settle';
    return this.mode === 'standing' && this.stage === 'rise';
  }

  /** The chair the player would sit in on pressing E, if one is in reach. */
  nearbyChair(): ChairInfo | null {
    if (this.mode !== 'free' || !this.grounded) return null;
    let best: ChairInfo | null = null;
    let bestScore = Infinity;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    for (const c of this.chairs) {
      const dx = c.position.x - this.position.x;
      const dz = c.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      const gap = dist - c.collisionRadius - PLAYER.radius;
      if (gap > PLAYER.sitReach) continue;
      const facing = (dx * fx + dz * fz) / (dist || 1);
      const score = gap - facing * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  update(dt: number, input: MoveInput, cameraYaw: number, faceCamera: boolean): void {
    const x0 = this.position.x;
    const z0 = this.position.z;
    if (this.mode === 'free') this.updateFree(dt, input, cameraYaw, faceCamera);
    else if (this.mode === 'sitting' || this.mode === 'standing') this.updateTransition(dt);
    this.moveSpeed = dt > 0 ? Math.hypot(this.position.x - x0, this.position.z - z0) / dt : 0;
  }

  /** Walks around the chair to its open front, turns, and settles into the seat. */
  sitDown(chair: ChairInfo): void {
    if (this.mode !== 'free') return;
    this.mode = 'sitting';
    this.seat = chair;
    this.velocity.set(0, 0, 0);
    const dx = this.position.x - chair.position.x;
    const dz = this.position.z - chair.position.z;
    const x = dx * chair.right.x + dz * chair.right.z;
    const z = dx * chair.forward.x + dz * chair.forward.z;
    this.planRoute(chair, Math.atan2(x, z), Math.hypot(x, z), 0, FRONT_REACH);
    this.beginStage('route', this.routeLength / ROUTE_SPEED);
  }

  /** Rises to the front of the chair, then walks around it to a free spot beside or behind. */
  standUp(): boolean {
    if (this.mode !== 'seated' || !this.seat) return false;
    const chair = this.seat;
    const exit = chair.collisionRadius + PLAYER.radius + 0.08;
    const exitAngle =
      [Math.PI / 2, -Math.PI / 2, Math.PI].find((a) => {
        const p = this.chairPoint(chair, a, exit, this.probe);
        return !this.world.blocked(p.x, PLATFORM.height + 0.9, p.z, PLAYER.radius + 0.02);
      }) ?? Math.PI;
    this.mode = 'standing';
    this.planRoute(chair, 0, FRONT_REACH, exitAngle, exit);
    this.from.copy(this.position);
    this.to.copy(this.route[0]);
    this.fromYaw = this.yaw;
    this.toYaw = this.segmentYaw(0);
    this.beginStage('rise', RISE_DURATION);
    return true;
  }

  private chairPoint(chair: ChairInfo, angle: number, radius: number, out: THREE.Vector3): THREE.Vector3 {
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    return out.set(
      chair.position.x + chair.right.x * x + chair.forward.x * z,
      chair.position.y,
      chair.position.z + chair.right.z * x + chair.forward.z * z,
    );
  }

  /**
   * A path in chair-local polar coordinates (angle 0 is straight in front) that
   * keeps clear of the shell on the sides and back and closes in at the front.
   */
  private planRoute(chair: ChairInfo, a0: number, r0: number, a1: number, r1: number): void {
    const span = wrapAngle(a1 - a0);
    const side = chair.collisionRadius + PLAYER.radius;
    const n = 2 + Math.ceil(Math.abs(span) * 9);
    this.route.length = 0;
    this.routeLengths.length = 0;
    let total = 0;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const a = a0 + span * u;
      const clearance = lerp(FRONT_REACH, side, smoothstep(0.3, 1.2, Math.abs(wrapAngle(a))));
      const p = this.chairPoint(chair, a, Math.max(lerp(r0, r1, u), clearance), new THREE.Vector3());
      if (i > 0) total += p.distanceTo(this.route[i - 1]);
      this.route.push(p);
      this.routeLengths.push(total);
    }
  }

  private get routeLength(): number {
    return this.routeLengths[this.routeLengths.length - 1] ?? 0;
  }

  private segmentYaw(i: number): number {
    const a = this.route[Math.min(i, this.route.length - 2)];
    const b = this.route[Math.min(i + 1, this.route.length - 1)];
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  private beginStage(stage: Stage, duration: number): void {
    this.stage = stage;
    this.stageTime = 0;
    this.stageDuration = Math.max(0.05, duration);
  }

  private updateFree(dt: number, input: MoveInput, cameraYaw: number, faceCamera: boolean): void {
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    const dirX = fx * input.y - fz * input.x;
    const dirZ = fz * input.y + fx * input.x;
    const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const rate = this.grounded ? 11 : 2.5;
    this.velocity.x = damp(this.velocity.x, dirX * speed, rate, dt);
    this.velocity.z = damp(this.velocity.z, dirZ * speed, rate, dt);

    if (faceCamera) this.yaw = cameraYaw;
    else if (Math.hypot(dirX, dirZ) > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(dirX, dirZ), 11, dt);

    if (input.jump && this.grounded) {
      this.velocity.y = PLAYER.jumpSpeed;
      this.grounded = false;
    }
    this.velocity.y -= PLAYER.gravity * dt;

    const x0 = this.position.x;
    const z0 = this.position.z;
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
    this.p2.x = x0;
    this.p2.z = z0;
    for (let i = 0; i < steps; i++) {
      this.p2.x += dx / steps;
      this.p2.z += dz / steps;
      this.world.resolve(this.p2, PLAYER.radius, this.position.y, PLAYER.stepHeight);
    }
    this.position.x = this.p2.x;
    this.position.z = this.p2.z;
    if (dt > 0) {
      this.velocity.x = (this.p2.x - x0) / dt;
      this.velocity.z = (this.p2.z - z0) / dt;
    }

    const ground = this.world.groundAt(this.position.x, this.position.z, this.position.y, PLAYER.stepHeight);
    const y = this.position.y + this.velocity.y * dt;
    if (y <= ground) {
      this.position.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else if (this.grounded && this.velocity.y <= 0 && y - ground <= PLAYER.stepHeight) {
      this.position.y = ground;
      this.velocity.y = 0;
    } else {
      this.position.y = y;
      this.grounded = false;
    }
    this.groundY = ground;
  }

  private updateTransition(dt: number): void {
    const sitting = this.mode === 'sitting';
    this.stageTime = Math.min(this.stageDuration, this.stageTime + dt);
    const t = this.stageTime / this.stageDuration;
    this.velocity.set(0, 0, 0);

    if (this.stage === 'route') {
      const faceTable = !sitting && this.seat ? smoothstep(0.55, 1, t) : 0;
      this.followRoute(lerp(t, t * t * (3 - 2 * t), 0.5), faceTable, dt);
      this.sit = 0;
    } else if (this.stage === 'settle') {
      const turn = easeInOutCubic(clamp(t / 0.5, 0, 1));
      this.yaw = this.fromYaw + wrapAngle(this.toYaw - this.fromYaw) * turn;
      this.position.lerpVectors(this.from, this.to, easeInOutCubic(clamp((t - 0.25) / 0.75, 0, 1)));
      this.sit = smoothstep(0.3, 1, t);
    } else {
      this.position.lerpVectors(this.from, this.to, easeInOutCubic(clamp(t / 0.7, 0, 1)));
      const turn = easeInOutCubic(clamp((t - 0.35) / 0.65, 0, 1));
      this.yaw = this.fromYaw + wrapAngle(this.toYaw - this.fromYaw) * turn;
      this.sit = 1 - smoothstep(0, 0.65, t);
    }
    this.groundY = this.position.y;
    if (t < 1 || !this.seat) return;

    if (this.stage === 'route' && sitting) {
      this.from.copy(this.position);
      chairLocalToWorld(this.seat, SEAT_DEPTH, 0, this.to);
      this.fromYaw = this.yaw;
      this.toYaw = this.seat.yaw;
      this.beginStage('settle', SETTLE_DURATION);
    } else if (this.stage === 'rise') {
      this.beginStage('route', this.routeLength / ROUTE_SPEED);
    } else if (this.stage === 'settle') {
      this.mode = 'seated';
      this.sit = 1;
    } else {
      this.mode = 'free';
      this.seat = null;
      this.sit = 0;
      this.grounded = true;
    }
  }

  /** `faceTable` turns the body from the walking direction toward the chamber center. */
  private followRoute(progress: number, faceTable: number, dt: number): void {
    const s = progress * this.routeLength;
    let i = 0;
    while (i < this.routeLengths.length - 2 && this.routeLengths[i + 1] < s) i++;
    const a = this.routeLengths[i];
    const b = this.routeLengths[i + 1] ?? a;
    this.position.lerpVectors(this.route[i], this.route[Math.min(i + 1, this.route.length - 1)], b > a ? (s - a) / (b - a) : 1);
    if (this.routeLength < 0.01) return;
    const walkYaw = this.segmentYaw(i);
    const target = this.seat ? walkYaw + wrapAngle(this.seat.yaw - walkYaw) * faceTable : walkYaw;
    this.yaw = dampAngle(this.yaw, target, 12, dt);
  }
}
