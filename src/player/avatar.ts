import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp, TAU } from '../utils/math';
import { SEAT_HEIGHT } from '../world/chairs';

const THIGH = 0.44;
const SHIN = 0.46;
const ANKLE = 0.08;
const HIP_HEIGHT = THIGH + SHIN + ANKLE;
/** Hip joint height when seated: the pelvis rests on the cushion. */
const SEATED_HIP = SEAT_HEIGHT + 0.1;

export interface AvatarState {
  /** Horizontal speed in m/s. */
  speed: number;
  grounded: boolean;
  /** 0 standing, 1 fully seated. */
  sit: number;
}

type Part = 'jacket' | 'trousers' | 'skin' | 'boots' | 'hair' | 'accent' | 'pack';

const PALETTE: Record<Part, string> = {
  jacket: '#2f6a63',
  trousers: '#3a3e45',
  skin: '#c69f80',
  boots: '#4d3a2a',
  hair: '#2b211b',
  accent: '#c79a4e',
  pack: '#6d5b40',
};

function capsule(radius: number, length: number, y: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, length, 5, 14);
  g.translate(0, y, 0);
  return g;
}

interface Rig {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  thighs: THREE.Group[];
  shins: THREE.Group[];
  feet: THREE.Group[];
  arms: THREE.Group[];
  forearms: THREE.Group[];
}

/**
 * Builds the jointed figure. Every limb group pivots at its upper joint and
 * hangs along -Y; the figure faces +Z.
 */
function buildRig(material: (part: Part) => THREE.Material, mannequin: boolean): Rig {
  const mesh = (geo: THREE.BufferGeometry, part: Part) => {
    const m = new THREE.Mesh(geo, material(part));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_HEIGHT;
  root.add(hips);

  const pelvis = new THREE.SphereGeometry(1, 18, 12);
  pelvis.scale(0.165, 0.12, 0.12);
  pelvis.translate(0, 0.03, 0);
  hips.add(mesh(pelvis, 'trousers'));

  const thighs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  const feet: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const thigh = new THREE.Group();
    thigh.position.x = side * 0.095;
    thigh.add(mesh(capsule(0.075, THIGH - 0.12, -THIGH / 2), 'trousers'));
    const shin = new THREE.Group();
    shin.position.y = -THIGH;
    shin.add(mesh(capsule(0.06, SHIN - 0.14, -SHIN / 2 + 0.02), 'trousers'));
    shin.add(mesh(capsule(0.066, 0.12, -SHIN + 0.1), 'boots'));
    const foot = new THREE.Group();
    foot.position.y = -SHIN;
    const footGeo = new THREE.CapsuleGeometry(0.052, 0.17, 4, 10);
    footGeo.rotateX(Math.PI / 2);
    footGeo.scale(1.05, 0.8, 1);
    footGeo.translate(0, -ANKLE + 0.045, 0.06);
    foot.add(mesh(footGeo, 'boots'));
    shin.add(foot);
    thigh.add(shin);
    hips.add(thigh);
    thighs.push(thigh);
    shins.push(shin);
    feet.push(foot);
  }

  const spine = new THREE.Group();
  spine.position.y = 0.06;
  hips.add(spine);
  const torso = capsule(0.155, 0.26, 0.25);
  torso.scale(1.12, 1, 0.78);
  spine.add(mesh(torso, 'jacket'));
  if (!mannequin) {
    const belt = new THREE.CylinderGeometry(0.162, 0.158, 0.05, 20);
    belt.scale(1.06, 1, 0.8);
    belt.translate(0, 0.03, 0);
    spine.add(mesh(belt, 'accent'));
    const pack = new THREE.CapsuleGeometry(0.11, 0.16, 4, 12);
    pack.scale(1.15, 1, 0.55);
    pack.translate(0, 0.3, -0.15);
    spine.add(mesh(pack, 'pack'));
    const strap = new THREE.TorusGeometry(0.15, 0.012, 6, 24, Math.PI);
    strap.rotateY(Math.PI / 2);
    strap.scale(1, 1.1, 0.72);
    for (const side of [-1, 1]) {
      const s = strap.clone();
      s.translate(side * 0.085, 0.32, 0);
      spine.add(mesh(s, 'accent'));
    }
  }
  spine.add(mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.12, 12).translate(0, 0.5, 0), 'skin'));

  const head = new THREE.Group();
  head.position.y = 0.56;
  const skull = new THREE.SphereGeometry(0.105, 24, 18);
  skull.scale(0.94, 1.08, 1);
  skull.translate(0, 0.06, 0.005);
  head.add(mesh(skull, 'skin'));
  if (!mannequin) {
    const hair = new THREE.SphereGeometry(0.112, 24, 14, 0, TAU, 0, Math.PI * 0.56);
    hair.scale(0.96, 1.04, 1.04);
    hair.rotateX(-0.32);
    hair.translate(0, 0.075, -0.012);
    head.add(mesh(hair, 'hair'));
  }
  spine.add(head);

  const arms: THREE.Group[] = [];
  const forearms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.2, 0.43, 0);
    arm.add(mesh(new THREE.SphereGeometry(0.062, 14, 10), 'jacket'));
    arm.add(mesh(capsule(0.052, 0.2, -0.14), 'jacket'));
    const forearm = new THREE.Group();
    forearm.position.y = -0.29;
    forearm.add(mesh(capsule(0.045, 0.18, -0.12), mannequin ? 'skin' : 'jacket'));
    const hand = new THREE.SphereGeometry(0.046, 12, 10);
    hand.scale(0.85, 1.15, 0.7);
    hand.translate(0, -0.28, 0.005);
    forearm.add(mesh(hand, 'skin'));
    arm.add(forearm);
    spine.add(arm);
    arms.push(arm);
    forearms.push(forearm);
  }

  return { root, hips, spine, head, thighs, shins, feet, arms, forearms };
}

interface Pose {
  hipY: number;
  lean: number;
  thigh: [number, number];
  knee: [number, number];
  arm: [number, number];
  elbow: [number, number];
  spread: number;
  headTilt: number;
}

const SIT_POSE: Pose = {
  hipY: SEATED_HIP,
  lean: -0.07,
  thigh: [-1.52, -1.48],
  knee: [1.27, 1.2],
  arm: [-0.32, -0.36],
  elbow: [-1.05, -1.0],
  spread: 0.12,
  headTilt: 0.06,
};

function applyPose(rig: Rig, p: Pose): void {
  rig.hips.position.y = p.hipY;
  rig.spine.rotation.x = p.lean;
  rig.head.rotation.x = p.headTilt - p.lean * 0.6;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    rig.thighs[i].rotation.x = p.thigh[i];
    rig.shins[i].rotation.x = p.knee[i];
    rig.feet[i].rotation.x = -(p.thigh[i] + p.knee[i]) * 0.85;
    rig.arms[i].rotation.x = p.arm[i];
    rig.arms[i].rotation.z = side * p.spread;
    rig.forearms[i].rotation.x = p.elbow[i];
  }
}

function blendPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.hipY = lerp(a.hipY, b.hipY, t);
  out.lean = lerp(a.lean, b.lean, t);
  out.spread = lerp(a.spread, b.spread, t);
  out.headTilt = lerp(a.headTilt, b.headTilt, t);
  for (let i = 0; i < 2; i++) {
    out.thigh[i] = lerp(a.thigh[i], b.thigh[i], t);
    out.knee[i] = lerp(a.knee[i], b.knee[i], t);
    out.arm[i] = lerp(a.arm[i], b.arm[i], t);
    out.elbow[i] = lerp(a.elbow[i], b.elbow[i], t);
  }
  return out;
}

const newPose = (): Pose => ({ hipY: HIP_HEIGHT, lean: 0, thigh: [0, 0], knee: [0, 0], arm: [0, 0], elbow: [0, 0], spread: 0.07, headTilt: 0 });

export class Avatar {
  readonly root: THREE.Group;
  private readonly rig: Rig;
  private readonly headParts: THREE.Object3D;
  private readonly shadow: THREE.Mesh;
  private phase = 0;
  private time = 0;
  private air = 0;
  private gait = 0;
  private run = 0;
  private readonly locomotion = newPose();
  private readonly airPose = newPose();
  private readonly pose = newPose();

  constructor(shadowTexture: THREE.Texture) {
    const mats = new Map<Part, THREE.Material>();
    const material = (part: Part) => {
      let m = mats.get(part);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color: PALETTE[part], roughness: part === 'accent' ? 0.45 : 0.78, metalness: part === 'accent' ? 0.35 : 0 });
        mats.set(part, m);
      }
      return m;
    };
    this.rig = buildRig(material, false);
    this.root = this.rig.root;
    this.root.name = 'avatar';
    this.headParts = this.rig.head;

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTexture, color: '#000000', transparent: true, opacity: 0.42, depthWrite: false }),
    );
    this.shadow.renderOrder = 1;
    this.shadow.name = 'avatar-shadow';
  }

  /** The blob shadow lives in world space so it can sit on whatever is underfoot. */
  get blobShadow(): THREE.Mesh {
    return this.shadow;
  }

  setHeadVisible(visible: boolean): void {
    this.headParts.visible = visible;
  }

  update(dt: number, s: AvatarState, groundY: number): void {
    this.time += dt;
    const moving = clamp(s.speed / 2.6, 0, 1);
    this.gait = damp(this.gait, s.grounded ? moving : 0, 10, dt);
    this.run = damp(this.run, clamp((s.speed - 3.2) / 3, 0, 1), 6, dt);
    this.air = damp(this.air, s.grounded ? 0 : 1, s.grounded ? 14 : 7, dt);
    const stride = lerp(1.5, 2.5, this.run);
    if (s.grounded) this.phase = (this.phase + (s.speed / stride) * TAU * dt) % TAU;

    const sw = Math.sin(this.phase);
    const cw = Math.cos(this.phase);
    const g = this.gait;
    const legAmp = (0.5 + this.run * 0.32) * g;
    const kneeAmp = (0.75 + this.run * 0.65) * g;
    const armAmp = (0.42 + this.run * 0.5) * g;
    const breathe = Math.sin(this.time * 1.7) * 0.012 * (1 - g);
    const L = this.locomotion;
    L.hipY = HIP_HEIGHT - (0.035 + this.run * 0.04) * g * (1 - Math.cos(2 * this.phase)) * 0.5 - this.run * 0.03;
    L.lean = (0.03 + this.run * 0.16) * g + breathe;
    L.thigh[0] = -sw * legAmp;
    L.thigh[1] = sw * legAmp;
    L.knee[0] = 0.06 + Math.max(0, cw) * kneeAmp;
    L.knee[1] = 0.06 + Math.max(0, -cw) * kneeAmp;
    L.arm[0] = sw * armAmp;
    L.arm[1] = -sw * armAmp;
    L.elbow[0] = -(0.18 + this.run * 1.0 * g) - Math.max(0, -sw) * 0.25 * g;
    L.elbow[1] = -(0.18 + this.run * 1.0 * g) - Math.max(0, sw) * 0.25 * g;
    L.spread = 0.07 + breathe;
    L.headTilt = 0.02;

    const A = this.airPose;
    A.hipY = HIP_HEIGHT;
    A.lean = 0.1;
    A.thigh[0] = -0.55;
    A.thigh[1] = 0.15;
    A.knee[0] = 0.8;
    A.knee[1] = 0.45;
    A.arm[0] = -0.5;
    A.arm[1] = 0.35;
    A.elbow[0] = -0.7;
    A.elbow[1] = -0.4;
    A.spread = 0.35;
    A.headTilt = -0.05;

    blendPose(L, A, this.air, this.pose);
    blendPose(this.pose, SIT_POSE, s.sit, this.pose);
    applyPose(this.rig, this.pose);

    this.shadow.visible = s.sit < 0.5 && this.root.visible;
    const lift = Math.max(0, this.root.position.y - groundY);
    this.shadow.position.set(this.root.position.x, groundY + 0.02, this.root.position.z);
    const k = 1 + lift * 0.5;
    this.shadow.scale.set(k, 1, k);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 / (k * k);
  }
}

/**
 * One merged, faceless seated figure in chair-local space (the seat point at
 * the origin, facing +Z), for the optional mannequin silhouettes.
 */
export function seatedMannequinGeometry(): THREE.BufferGeometry {
  const plain = new THREE.MeshBasicMaterial();
  const rig = buildRig(() => plain, true);
  applyPose(rig, SIT_POSE);
  rig.root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  rig.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
      g.deleteAttribute('uv');
      parts.push(g);
    }
  });
  plain.dispose();
  return mergeGeometries(parts);
}
