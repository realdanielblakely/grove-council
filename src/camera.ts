import * as THREE from 'three';
import { PLAYER } from './config';
import type { CollisionWorld } from './physics/collision';
import type { Player } from './player/player';
import { clamp, damp, easeInOutCubic } from './utils/math';
import { chairLocalToWorld, SEAT_DEPTH, SEAT_HEIGHT } from './world/chairs';

export type ViewMode = 'third' | 'first';
export type CameraShot = 'third' | 'first' | 'seated' | 'overview';

const SENSITIVITY = 0.0022;
const SEATED_PITCH = 0.035;
const OVERVIEW_POSITION = new THREE.Vector3(0, 33, 10.5);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0.2, 0.9);

const FOV: Record<CameraShot, number> = { third: 60, first: 68, seated: 64, overview: 50 };

export class CameraRig {
  view: ViewMode = 'third';
  overview = false;
  yaw = 0;
  /** Positive looks down. */
  pitch = 0.22;
  distance = 3.6;

  private seatYaw = 0;
  private seatPitch = 0;
  private started = false;
  private shot: CameraShot = 'third';
  private blend = 1;
  private blendDuration = 0.6;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private fromFov = 60;
  private reach = 3.6;
  private readonly target = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly far = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly desiredQuat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly up = new THREE.Vector3(0, 1, 0);

  readonly camera: THREE.PerspectiveCamera;
  private readonly world: CollisionWorld;

  constructor(camera: THREE.PerspectiveCamera, world: CollisionWorld) {
    this.camera = camera;
    this.world = world;
  }

  get currentShot(): CameraShot {
    return this.shot;
  }

  /** True while the camera is close enough to the head that the avatar would block it. */
  get insideHead(): boolean {
    return this.shot === 'first' || (this.shot === 'third' && this.reach < 0.7 && this.blend >= 1);
  }

  look(dx: number, dy: number, zoom: number): void {
    if (this.overview) return;
    if (this.shot === 'seated') {
      this.seatYaw = clamp(this.seatYaw - dx * SENSITIVITY, -1.9, 1.9);
      this.seatPitch = clamp(this.seatPitch + dy * SENSITIVITY, -0.75, 0.9);
      return;
    }
    this.yaw -= dx * SENSITIVITY;
    this.pitch = clamp(this.pitch + dy * SENSITIVITY, this.shot === 'first' ? -1.35 : -0.5, this.shot === 'first' ? 1.35 : 1.15);
    this.distance = clamp(this.distance + zoom * 0.45, 1.8, 7);
  }

  /** Called when the player sits: look straight across the chamber. */
  resetSeatLook(): void {
    this.seatYaw = 0;
    this.seatPitch = 0;
  }

  /** Hand the seated look direction back to the free camera when standing up. */
  adoptSeatLook(chairYaw: number): void {
    this.yaw = chairYaw + this.seatYaw;
    this.pitch = clamp(SEATED_PITCH + this.seatPitch + 0.1, -0.4, 0.8);
  }

  update(dt: number, player: Player): void {
    const next: CameraShot = this.overview ? 'overview' : player.inSeat ? 'seated' : this.view;
    if (!this.started) {
      this.started = true;
      this.shot = next;
      this.blend = 1;
    } else if (next !== this.shot) {
      this.fromPos.copy(this.camera.position);
      this.fromQuat.copy(this.camera.quaternion);
      this.fromFov = this.camera.fov;
      this.blendDuration = next === 'overview' || this.shot === 'overview' ? 1.4 : next === 'seated' ? 1.0 : 0.6;
      this.blend = 0;
      if (this.shot === 'seated' || this.shot === 'overview') this.reach = 0.8;
      this.shot = next;
    }

    this.computeDesired(dt, player);

    this.blend = Math.min(1, this.blend + dt / this.blendDuration);
    const e = easeInOutCubic(this.blend);
    const fov = this.fovFor(this.shot);
    if (e >= 1) {
      this.camera.position.copy(this.desired);
      this.camera.quaternion.copy(this.desiredQuat);
      this.camera.fov = fov;
    } else {
      this.camera.position.lerpVectors(this.fromPos, this.desired, e);
      this.camera.quaternion.slerpQuaternions(this.fromQuat, this.desiredQuat, e);
      this.camera.fov = this.fromFov + (fov - this.fromFov) * e;
    }
    this.camera.updateProjectionMatrix();
  }

  /** Vertical FOV for a shot, widened on portrait screens so the horizontal view stays usable. */
  private fovFor(shot: CameraShot): number {
    const base = FOV[shot];
    const aspect = this.camera.aspect;
    if (aspect >= 1) return base;
    const horizontal = THREE.MathUtils.degToRad(Math.min(base, 56));
    const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / aspect));
    return Math.min(100, Math.max(base, needed));
  }

  private lookAlong(yaw: number, pitch: number): void {
    this.euler.set(-pitch, yaw + Math.PI, 0);
    this.desiredQuat.setFromEuler(this.euler);
  }

  private computeDesired(dt: number, player: Player): void {
    switch (this.shot) {
      case 'overview': {
        this.desired.copy(OVERVIEW_POSITION);
        this.lookMatrix.lookAt(this.desired, OVERVIEW_TARGET, this.up);
        this.desiredQuat.setFromRotationMatrix(this.lookMatrix);
        return;
      }
      case 'seated': {
        const chair = player.seat;
        if (!chair) return;
        chairLocalToWorld(chair, SEAT_DEPTH + 0.08, SEAT_HEIGHT + 0.8, this.desired);
        this.lookAlong(chair.yaw + this.seatYaw, SEATED_PITCH + this.seatPitch);
        return;
      }
      case 'first': {
        const fx = Math.sin(this.yaw);
        const fz = Math.cos(this.yaw);
        this.desired.set(player.position.x + fx * 0.1, player.position.y + PLAYER.eyeHeight, player.position.z + fz * 0.1);
        this.lookAlong(this.yaw, this.pitch);
        return;
      }
      case 'third': {
        this.target.set(player.position.x, player.position.y + 1.45, player.position.z);
        const cp = Math.cos(this.pitch);
        this.dir.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
        this.far.copy(this.target).addScaledVector(this.dir, -this.distance);
        const free = this.world.sweep(this.target, this.far, 0.2) * this.distance;
        this.reach = free < this.reach ? free : damp(this.reach, free, 3, dt);
        this.desired.copy(this.target).addScaledVector(this.dir, -Math.max(0.05, this.reach));
        const floor = this.world.groundFn(this.desired.x, this.desired.z) + 0.25;
        if (this.desired.y < floor) this.desired.y = floor;
        this.lookAlong(this.yaw, this.pitch);
        return;
      }
    }
  }
}
