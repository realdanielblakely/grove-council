import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHAIRS, PLATFORM, type ChairVariant } from '../config';
import { clamp, smoothstep, TAU } from '../utils/math';

const DEG = Math.PI / 180;

/** Height of the seat surface above the platform, shared by every variant. */
export const SEAT_HEIGHT = 0.46;
/** Where a sitter's pelvis rests, along the chair's local Z (forward is +Z). */
export const SEAT_DEPTH = -0.12;

interface ProfileKey {
  y: number;
  rx: number;
  rz: number;
  cz: number;
  /** Half of the angular span of the shell around the sitter, in degrees. */
  span: number;
  flare: number;
}

interface ShellProfile {
  y0: number;
  top: number;
  bottomCap: number;
  topCap: number;
  /** 2 gives a round top, values toward 1 give a pointed petal tip. */
  topPower: number;
  thickness: number;
  /** Raised spine down the middle of the back, as a fraction of the radius. */
  ridge: number;
  keys: ProfileKey[];
}

const key = (y: number, rx: number, rz: number, cz: number, span: number, flare = 0): ProfileKey => ({ y, rx, rz, cz, span, flare });

const PROFILES: Record<ChairVariant, ShellProfile> = {
  egg: {
    y0: 0.22, top: 2.95, bottomCap: 0.22, topCap: 0.75, topPower: 2, thickness: 0.05, ridge: 0.03,
    keys: [
      key(0.22, 0.32, 0.28, 0, 180),
      key(0.44, 0.45, 0.36, -0.02, 180),
      key(0.52, 0.47, 0.37, -0.03, 179),
      key(0.62, 0.49, 0.37, -0.05, 146),
      key(0.8, 0.52, 0.37, -0.075, 114),
      key(1.05, 0.57, 0.37, -0.1, 98),
      key(1.5, 0.65, 0.38, -0.13, 96),
      key(2.0, 0.7, 0.37, -0.15, 102),
      key(2.5, 0.67, 0.35, -0.16, 110),
      key(2.95, 0.56, 0.3, -0.16, 114),
    ],
  },
  petal: {
    y0: 0.22, top: 3.4, bottomCap: 0.22, topCap: 1.05, topPower: 1.3, thickness: 0.05, ridge: 0.09,
    keys: [
      key(0.22, 0.35, 0.29, 0, 180),
      key(0.44, 0.45, 0.35, -0.02, 180),
      key(0.52, 0.47, 0.36, -0.03, 179),
      key(0.64, 0.49, 0.36, -0.05, 140),
      key(0.85, 0.52, 0.35, -0.08, 106),
      key(1.15, 0.55, 0.33, -0.11, 90),
      key(1.7, 0.6, 0.3, -0.15, 78, 0.06),
      key(2.4, 0.59, 0.26, -0.2, 70, 0.16),
      key(3.4, 0.44, 0.19, -0.24, 64, 0.24),
    ],
  },
  throne: {
    y0: 0.22, top: 3.8, bottomCap: 0.23, topCap: 0.6, topPower: 2.2, thickness: 0.055, ridge: 0.06,
    keys: [
      key(0.22, 0.42, 0.33, 0, 180),
      key(0.44, 0.55, 0.39, -0.02, 180),
      key(0.52, 0.58, 0.4, -0.03, 179),
      key(0.64, 0.61, 0.41, -0.05, 152),
      key(0.85, 0.63, 0.4, -0.08, 126),
      key(1.15, 0.65, 0.38, -0.11, 104),
      key(1.7, 0.68, 0.35, -0.15, 95, 0.08),
      key(2.4, 0.72, 0.32, -0.2, 93, 0.18),
      key(3.1, 0.73, 0.29, -0.24, 93, 0.26),
      key(3.8, 0.67, 0.26, -0.27, 93, 0.3),
    ],
  },
};

const WING: ShellProfile = {
  y0: 0.8, top: 3.0, bottomCap: 0.35, topCap: 1.1, topPower: 1.3, thickness: 0.045, ridge: 0,
  keys: [
    key(0.8, 0.3, 0.2, 0, 34),
    key(1.4, 0.35, 0.22, -0.03, 36, 0.1),
    key(2.2, 0.33, 0.2, -0.06, 36, 0.2),
    key(3.0, 0.26, 0.16, -0.08, 34, 0.25),
  ],
};

/** Wings flank the throne shell; this is how far they reach from its axis. */
const WING_OFFSET = 0.86;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const FIELDS = ['rx', 'rz', 'cz', 'span', 'flare'] as const;

function sampleProfile(p: ShellProfile, y: number, out: ProfileKey): ProfileKey {
  const keys = p.keys;
  let i = 0;
  while (i < keys.length - 2 && y > keys[i + 1].y) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = clamp((y - k1.y) / (k2.y - k1.y), 0, 1);
  for (const f of FIELDS) out[f] = catmull(k0[f], k1[f], k2[f], k3[f], t);
  out.y = y;
  return out;
}

function capFactor(p: ShellProfile, y: number): number {
  const db = (y - p.y0) / p.bottomCap;
  const dt = (p.top - y) / p.topCap;
  const fb = db >= 1 ? 1 : db <= 0 ? 0 : Math.sqrt(1 - (1 - db) * (1 - db));
  const ft = dt >= 1 ? 1 : dt <= 0 ? 0 : Math.pow(1 - Math.pow(1 - dt, p.topPower), 1 / p.topPower);
  return fb * ft;
}

const scratchKey = key(0, 0, 0, 0, 0);

function shellPoint(p: ShellProfile, s: number, u: number, out: THREE.Vector3): THREE.Vector3 {
  const g = (1 - Math.cos(Math.PI * clamp(s, 0, 1))) / 2;
  const y = p.y0 + (p.top - p.y0) * g;
  const k = sampleProfile(p, y, scratchKey);
  const cap = capFactor(p, y);
  const span = clamp(k.span, 1, 180) * DEG;
  const theta = u * span;
  const fl = 1 + Math.max(0, k.flare) * Math.pow(Math.abs(u), 3);
  const spine = 1 + p.ridge * Math.exp(-(theta * theta) / 0.018) * smoothstep(p.y0 + 0.25, p.y0 + 0.9, y);
  const rx = Math.max(0.001, k.rx) * cap * fl * spine;
  const rz = Math.max(0.001, k.rz) * cap * fl * spine;
  return out.set(rx * Math.sin(theta), y, k.cz - rz * Math.cos(theta));
}

/**
 * A sculpted shell with real wall thickness: an outer skin, an inner skin
 * offset along the normals, and half-round rims along the open edges.
 */
function buildShell(p: ShellProfile, ns = 60, nu = 40, rimSteps = 6): THREE.BufferGeometry {
  const rows = ns + 1;
  const cols = nu + 1;
  const P: THREE.Vector3[] = [];
  const N: THREE.Vector3[] = [];
  const DU: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const h = 1e-3;
  for (let j = 0; j < rows; j++) {
    const s = j / ns;
    const sn = clamp(s, 0.006, 0.994);
    for (let i = 0; i < cols; i++) {
      const u = -1 + (2 * i) / nu;
      P.push(shellPoint(p, s, u, new THREE.Vector3()));
      shellPoint(p, sn, u + h, a);
      shellPoint(p, sn, u - h, b);
      const du = new THREE.Vector3().subVectors(a, b);
      shellPoint(p, sn + h, u, c);
      shellPoint(p, sn - h, u, d);
      const ds = new THREE.Vector3().subVectors(c, d);
      const n = new THREE.Vector3().crossVectors(ds, du);
      if (n.lengthSq() < 1e-14) n.set(0, s < 0.5 ? -1 : 1, 0);
      N.push(n.normalize());
      DU.push(du.normalize());
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const grid = (count: number, rowLen: number, flip: boolean) => {
    const start = positions.length / 3 - count;
    const nRows = count / rowLen;
    for (let j = 0; j < nRows - 1; j++) {
      for (let i = 0; i < rowLen - 1; i++) {
        const v00 = start + j * rowLen + i;
        const v10 = v00 + 1;
        const v01 = v00 + rowLen;
        const v11 = v01 + 1;
        if (flip) indices.push(v00, v10, v01, v10, v11, v01);
        else indices.push(v00, v01, v10, v10, v01, v11);
      }
    }
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      positions.push(P[k].x, P[k].y, P[k].z);
      normals.push(N[k].x, N[k].y, N[k].z);
      uvs.push(i / nu, j / ns);
    }
  }
  grid(rows * cols, cols, false);

  const T = p.thickness;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      positions.push(P[k].x - N[k].x * T, P[k].y - N[k].y * T, P[k].z - N[k].z * T);
      normals.push(-N[k].x, -N[k].y, -N[k].z);
      uvs.push(i / nu, j / ns);
    }
  }
  grid(rows * cols, cols, true);

  for (const side of [-1, 1]) {
    const i = side < 0 ? 0 : nu;
    for (let j = 0; j < rows; j++) {
      const k = j * cols + i;
      const n = N[k];
      const t = DU[k].clone().multiplyScalar(side);
      for (let r = 0; r < rimSteps; r++) {
        const alpha = (Math.PI * r) / (rimSteps - 1);
        const ca = Math.cos(alpha);
        const sa = Math.sin(alpha);
        const nx = ca * n.x + sa * t.x;
        const ny = ca * n.y + sa * t.y;
        const nz = ca * n.z + sa * t.z;
        positions.push(P[k].x - n.x * T * 0.5 + nx * T * 0.5, P[k].y - n.y * T * 0.5 + ny * T * 0.5, P[k].z - n.z * T * 0.5 + nz * T * 0.5);
        normals.push(nx, ny, nz);
        uvs.push(r / (rimSteps - 1), j / ns);
      }
    }
    grid(rows * rimSteps, rimSteps, side < 0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function lathe(points: Array<[number, number]>, segments = 56): THREE.BufferGeometry {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function pedestal(variant: ChairVariant): THREE.BufferGeometry {
  const w = variant === 'throne' ? 1.22 : 1;
  const disc: Array<[number, number]> = [
    [0, 0], [0.4 * w, 0], [0.43 * w, 0.012], [0.44 * w, 0.032], [0.43 * w, 0.05], [0.4 * w, 0.06],
    [0.24 * w, 0.075], [0.13, 0.1], [0.085, 0.15], [0.078, 0.2], [0.09, 0.245], [0.15, 0.28], [0.21, 0.3], [0, 0.31],
  ];
  const parts = [lathe(disc)];
  if (variant === 'throne') {
    parts.push(lathe([[0, -0.001], [0.66, -0.001], [0.68, 0.02], [0.66, 0.045], [0.6, 0.05], [0, 0.05]]));
  }
  return mergeGeometries(parts);
}

function cushion(variant: ChairVariant): THREE.BufferGeometry {
  const prof = PROFILES[variant];
  const k = sampleProfile(prof, SEAT_HEIGHT - 0.05, key(0, 0, 0, 0, 0));
  const pts: Array<[number, number]> = [[0, 0], [0.84, 0], [0.95, 0.012], [1, 0.045], [0.97, 0.08], [0.88, 0.098], [0.4, 0.105], [0, 0.106]];
  const geo = lathe(pts, 48);
  const sx = k.rx - prof.thickness - 0.02;
  const sz = k.rz - prof.thickness - 0.02;
  geo.scale(sx, 1, sz);
  geo.translate(0, SEAT_HEIGHT - 0.1, k.cz);
  return geo;
}

function wings(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const g = buildShell(WING, 36, 12, 5);
    const m = new THREE.Matrix4()
      .makeTranslation(side * WING_OFFSET, 0, -0.3)
      .multiply(new THREE.Matrix4().makeRotationY(side * 0.5))
      .multiply(new THREE.Matrix4().makeRotationZ(-side * 0.1));
    g.applyMatrix4(m);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

export interface ChairInfo {
  index: number;
  variant: ChairVariant;
  angle: number;
  /** Pedestal center on the platform. */
  position: THREE.Vector3;
  /** Rotation about Y that turns local +Z toward the chamber center. */
  yaw: number;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  seatY: number;
  height: number;
  collisionRadius: number;
}

export function chairLayout(): ChairInfo[] {
  const chairs: ChairInfo[] = [];
  for (let k = 0; k < CHAIRS.count; k++) {
    const angle = CHAIRS.firstAngle + (k * TAU) / CHAIRS.count;
    const variant = CHAIRS.variants[k % CHAIRS.variants.length];
    const position = new THREE.Vector3(Math.cos(angle) * CHAIRS.radius, PLATFORM.height, Math.sin(angle) * CHAIRS.radius);
    const forward = new THREE.Vector3(-Math.cos(angle), 0, -Math.sin(angle));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const prof = PROFILES[variant];
    const maxRx = Math.max(...prof.keys.map((kk) => kk.rx));
    chairs.push({
      index: k,
      variant,
      angle,
      position,
      yaw: Math.atan2(forward.x, forward.z),
      forward,
      right,
      seatY: PLATFORM.height + SEAT_HEIGHT,
      height: prof.top,
      collisionRadius: variant === 'throne' ? WING_OFFSET + 0.22 : maxRx + 0.05,
    });
  }
  return chairs;
}

/** Point on the chair's local axis (0, y, z) in world space. */
export function chairLocalToWorld(chair: ChairInfo, localZ: number, localY: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(chair.position).addScaledVector(chair.forward, localZ).setY(chair.position.y + localY);
}

export function buildChairs(chairs: ChairInfo[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'chairs';
  const shellMat = new THREE.MeshStandardMaterial({ color: '#f4f5f2', roughness: 0.32, metalness: 0, envMapIntensity: 1.5 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: '#ebe7df', roughness: 0.82, envMapIntensity: 1.3 });
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);

  for (const variant of ['egg', 'petal', 'throne'] as ChairVariant[]) {
    const list = chairs.filter((c) => c.variant === variant);
    if (list.length === 0) continue;
    const shellParts = [buildShell(PROFILES[variant]), pedestal(variant)];
    if (variant === 'throne') shellParts.push(wings());
    const shell = new THREE.InstancedMesh(mergeGeometries(shellParts), shellMat, list.length);
    const soft = new THREE.InstancedMesh(cushion(variant), cushionMat, list.length);
    list.forEach((c, i) => {
      quat.setFromAxisAngle(up, c.yaw);
      matrix.compose(c.position, quat, one);
      shell.setMatrixAt(i, matrix);
      soft.setMatrixAt(i, matrix);
    });
    for (const m of [shell, soft]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.computeBoundingSphere();
      group.add(m);
    }
  }
  return group;
}
