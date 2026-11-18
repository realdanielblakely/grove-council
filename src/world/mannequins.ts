import * as THREE from 'three';
import { seatedMannequinGeometry } from '../player/avatar';
import { chairLocalToWorld, SEAT_DEPTH, type ChairInfo } from './chairs';

/** Faceless seated silhouettes, one per chair, toggled as a group. */
export class Mannequins {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrices: THREE.Matrix4[];
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private vacant = -1;

  constructor(chairs: ChairInfo[]) {
    const material = new THREE.MeshStandardMaterial({ color: '#3a3f44', roughness: 0.48, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(seatedMannequinGeometry(), material, chairs.length);
    this.mesh.name = 'mannequins';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    this.matrices = chairs.map((c) => {
      q.setFromAxisAngle(up, c.yaw);
      return new THREE.Matrix4().compose(chairLocalToWorld(c, SEAT_DEPTH, 0), q, one);
    });
    this.matrices.forEach((m, i) => this.mesh.setMatrixAt(i, m));
    this.mesh.computeBoundingSphere();
    this.mesh.visible = false;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  /** Empties the seat the player is using, or restores it with -1. */
  setVacant(index: number): void {
    if (index === this.vacant) return;
    if (this.vacant >= 0) this.mesh.setMatrixAt(this.vacant, this.matrices[this.vacant]);
    if (index >= 0) this.mesh.setMatrixAt(index, this.hidden);
    this.vacant = index;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
