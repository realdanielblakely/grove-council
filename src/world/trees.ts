import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLATFORM } from '../config';
import { Simplex } from '../utils/noise';
import { Rng } from '../utils/random';
import { smoothstep, TAU } from '../utils/math';
import { terrainHeight } from './ground';

export interface TreeSpec {
  x: number;
  z: number;
  /** Trunk radius just above the buttresses. */
  r0: number;
  height: number;
  lobes: number[];
  twist: number;
  detail: number;
  seed: number;
}

export interface TreeField {
  specs: TreeSpec[];
  /** Ends of the upper limbs, where the canopy foliage gathers. */
  crowns: THREE.Vector3[];
  /** Points along trunks and limbs where vines can hang from. */
  hangPoints: THREE.Vector3[];
}

const noise = new Simplex(new Rng(211).next);

/** Parallel-transport frames that start with N = +X and B = +Z at the base. */
function transportFrames(curve: THREE.Curve<THREE.Vector3>, segments: number) {
  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) tangents.push(curve.getTangentAt(i / segments).normalize());
  const t0 = tangents[0];
  const n0 = new THREE.Vector3(1, 0, 0).addScaledVector(t0, -t0.x);
  if (n0.lengthSq() < 1e-6) n0.set(0, 0, 1).addScaledVector(t0, -t0.z);
  n0.normalize();
  normals.push(n0);
  binormals.push(new THREE.Vector3().crossVectors(n0, t0).normalize());
  const q = new THREE.Quaternion();
  for (let i = 1; i <= segments; i++) {
    q.setFromUnitVectors(tangents[i - 1], tangents[i]);
    const n = normals[i - 1].clone().applyQuaternion(q).normalize();
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(n, tangents[i]).normalize());
  }
  return { tangents, normals, binormals };
}

interface TubeOptions {
  curve: THREE.Curve<THREE.Vector3>;
  rings: number;
  radial: number;
  radius: (t: number, theta: number) => number;
  /** World-space length of one texture repeat along the tube. */
  texelLength: number;
  uRepeat: number;
  moss: (t: number, normalY: number, p: THREE.Vector3) => number;
}

const barkTint = new THREE.Color('#c9b9a6');
const mossTint = new THREE.Color('#88a856');

/** A tube with an arbitrary radius function, smoothed normals and moss colors. */
function tube(o: TubeOptions): THREE.BufferGeometry {
  const { normals, binormals } = transportFrames(o.curve, o.rings);
  const length = o.curve.getLength();
  const cols = o.radial + 1;
  const positions = new Float32Array((o.rings + 1) * cols * 3);
  const uvs = new Float32Array((o.rings + 1) * cols * 2);
  const p = new THREE.Vector3();
  for (let i = 0; i <= o.rings; i++) {
    const t = i / o.rings;
    o.curve.getPointAt(t, p);
    const n = normals[i];
    const b = binormals[i];
    for (let j = 0; j <= o.radial; j++) {
      const theta = ((j % o.radial) / o.radial) * TAU;
      const r = o.radius(t, theta);
      const c = Math.cos(theta) * r;
      const s = Math.sin(theta) * r;
      const k = (i * cols + j) * 3;
      positions[k] = p.x + n.x * c + b.x * s;
      positions[k + 1] = p.y + n.y * c + b.y * s;
      positions[k + 2] = p.z + n.z * c + b.z * s;
      const kk = (i * cols + j) * 2;
      uvs[kk] = (j / o.radial) * o.uRepeat;
      uvs[kk + 1] = (t * length) / o.texelLength;
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < o.rings; i++) {
    for (let j = 0; j < o.radial; j++) {
      const a = i * cols + j;
      const b2 = a + 1;
      const c2 = a + cols;
      const d = c2 + 1;
      indices.push(a, c2, b2, b2, c2, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i <= o.rings; i++) {
    const a = i * cols;
    const b2 = a + o.radial;
    const nx = nrm.getX(a) + nrm.getX(b2);
    const ny = nrm.getY(a) + nrm.getY(b2);
    const nz = nrm.getZ(a) + nrm.getZ(b2);
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    nrm.setXYZ(a, nx * inv, ny * inv, nz * inv);
    nrm.setXYZ(b2, nx * inv, ny * inv, nz * inv);
  }
  const colors = new Float32Array((o.rings + 1) * cols * 3);
  const col = new THREE.Color();
  for (let i = 0; i <= o.rings; i++) {
    for (let j = 0; j <= o.radial; j++) {
      const v = i * cols + j;
      p.fromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute, v);
      const m = o.moss(i / o.rings, nrm.getY(v), p);
      col.copy(barkTint).lerp(mossTint, Math.min(1, Math.max(0, m)));
      colors[v * 3] = col.r;
      colors[v * 3 + 1] = col.g;
      colors[v * 3 + 2] = col.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function trunk(spec: TreeSpec, rng: Rng, field: TreeField): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Vector3(spec.x, terrainHeight(spec.x, spec.z) - 0.6, spec.z);
  const outward = new THREE.Vector2(spec.x, spec.z).normalize();
  const leanIn = rng.range(-0.5, 2.5);
  const phase = rng.range(0, TAU);
  const phase2 = rng.range(0, TAU);
  const wander = rng.range(1.3, 2.6) * spec.r0;
  const kink = rng.range(0.35, 0.75) * spec.r0;
  const pts: THREE.Vector3[] = [];
  const steps = 10;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const y = base.y + t * (spec.height + 0.6);
    const w = Math.sin(t * Math.PI) * wander;
    const kk = kink * smoothstep(0.05, 0.3, t);
    const lean = -leanIn * t * t;
    pts.push(
      new THREE.Vector3(
        base.x + outward.x * lean + Math.cos(phase + t * 3.4) * w + Math.sin(phase2 + t * 9.5) * kk,
        y,
        base.z + outward.y * lean + Math.sin(phase + t * 3.4) * w + Math.cos(phase2 * 1.3 + t * 8.1) * kk,
      ),
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const H = spec.height;
  const radius = (t: number, theta: number) => {
    const h = t * (H + 0.6) - 0.6;
    const taper = (1 - 0.5 * t) * (1 + 0.1 * Math.sin(h * 0.55 + spec.seed));
    const flare = 1 + 0.45 * Math.exp(-Math.max(0, h) / 1.1);
    let lobe = 0;
    for (const la of spec.lobes) {
      const d = Math.cos(theta - la - spec.twist * Math.max(0, h) * 0.08);
      if (d > 0) lobe += d ** 6;
    }
    const lobeAmp = 1.0 * Math.exp(-Math.max(0, h) / 2.3);
    const flute = 0.11 * Math.sin(5 * theta + h * spec.twist * 1.6);
    const gnarl =
      0.2 * noise.noise3(Math.cos(theta) * 1.4 + spec.seed, Math.sin(theta) * 1.4, h * 0.28) +
      0.07 * noise.noise3(Math.cos(theta) * 4 + spec.seed, Math.sin(theta) * 4, h * 1.3);
    return spec.r0 * taper * flare * (1 + lobe * lobeAmp) * (1 + flute + gnarl);
  };
  const moss = (t: number, ny: number, p: THREE.Vector3) => {
    const h = p.y - base.y;
    const patch = noise.noise3(p.x * 0.6, p.y * 0.35, p.z * 0.6);
    return smoothstep(0.1, 0.7, ny) * 0.9 + smoothstep(3.5, 0, h) * 0.55 + smoothstep(0.2, 0.7, patch) * 0.45 - t * 0.2;
  };
  parts.push(
    tube({
      curve,
      rings: Math.round(70 * spec.detail),
      radial: Math.max(10, Math.round(22 * spec.detail)),
      radius,
      texelLength: 3.2 * spec.r0,
      uRepeat: 3,
      moss,
    }),
  );

  const rootDirs = [...spec.lobes];
  const extra = rng.int(1, 3);
  for (let i = 0; i < extra; i++) rootDirs.push(rng.range(0, TAU));
  if (spec.detail >= 0.8) {
    for (const la of rootDirs) {
      const dir = new THREE.Vector3(Math.cos(la), 0, Math.sin(la));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const ground = (v: THREE.Vector3, lift: number) => v.setY(terrainHeight(v.x, v.z) + lift);
      const s1 = rng.range(-0.6, 0.6);
      const s2 = rng.range(-1, 1);
      const rootPoints = (len: number) => [
        ground(base.clone().addScaledVector(dir, spec.r0 * 0.4), 1.9 * spec.r0),
        ground(base.clone().addScaledVector(dir, spec.r0 * 1.55), 0.8 * spec.r0),
        ground(base.clone().addScaledVector(dir, spec.r0 * 1.6 + len * 0.3).addScaledVector(side, s1), 0.22),
        ground(base.clone().addScaledVector(dir, spec.r0 * 1.6 + len * 0.68).addScaledVector(side, s2), 0.08),
        ground(base.clone().addScaledVector(dir, spec.r0 * 1.6 + len).addScaledVector(side, s2 * 1.4), -0.35),
      ];
      let len = rng.range(2.5, 6.5) * (0.7 + spec.r0 * 0.4);
      let rpts = rootPoints(len);
      for (let tries = 0; tries < 12 && Math.min(...rpts.map((v) => Math.hypot(v.x, v.z))) < PLATFORM.radius + 0.9; tries++) {
        len *= 0.72;
        rpts = rootPoints(len);
      }
      if (Math.min(...rpts.map((v) => Math.hypot(v.x, v.z))) < PLATFORM.radius + 0.9) continue;
      const rcurve = new THREE.CatmullRomCurve3(rpts, false, 'centripetal');
      const r0 = spec.r0 * rng.range(0.34, 0.46);
      parts.push(
        tube({
          curve: rcurve,
          rings: 26,
          radial: 9,
          radius: (t, theta) => (r0 * Math.pow(1 - t, 1.25) + 0.035) * (1 + 0.15 * noise.noise2(theta * 1.5, t * 6 + la)) * (1 - 0.25 * Math.max(0, -Math.sin(theta))),
          texelLength: 1.6,
          uRepeat: 1,
          moss: (_t, ny) => smoothstep(0.0, 0.8, ny) * 0.95 + 0.25,
        }),
      );
    }
  }

  if (spec.detail >= 0.8) {
    const stranglers = rng.int(2, 3);
    for (let i = 0; i < stranglers; i++) {
      const phi0 = rng.range(0, TAU);
      const turns = rng.range(0.7, 1.5) * rng.sign();
      const top = rng.range(0.32, 0.62);
      const rr = rng.range(0.06, 0.12) * (0.6 + spec.r0 * 0.5);
      const hpts: THREE.Vector3[] = [];
      for (let k = 0; k <= 28; k++) {
        const t = (k / 28) * top;
        const phi = phi0 + turns * TAU * (k / 28);
        const c = curve.getPointAt(t);
        const r = radius(t, phi) + rr * 0.35;
        hpts.push(new THREE.Vector3(c.x + Math.cos(phi) * r, c.y, c.z + Math.sin(phi) * r));
      }
      parts.push(
        tube({
          curve: new THREE.CatmullRomCurve3(hpts, false, 'centripetal'),
          rings: 64,
          radial: 6,
          radius: (t) => rr * (1 - 0.55 * t) + 0.015,
          texelLength: 1.2,
          uRepeat: 1,
          moss: (_t, ny) => 0.3 + smoothstep(0.2, 0.9, ny) * 0.5,
        }),
      );
    }
  }

  const limbs = spec.detail >= 0.8 ? rng.int(2, 4) : rng.int(1, 2);
  for (let i = 0; i < limbs; i++) {
    const tb = rng.range(0.55, 0.88);
    const start = curve.getPointAt(tb);
    const a = rng.range(0, TAU);
    const len = rng.range(4.5, 9);
    const dir = new THREE.Vector3(Math.cos(a), rng.range(0.35, 0.8), Math.sin(a)).normalize();
    const mid = start.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, len * 0.12, 0));
    const end = start.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, rng.range(-1.5, 1.2), 0));
    const lcurve = new THREE.CatmullRomCurve3([start.clone().addScaledVector(dir, -0.3), mid, end], false, 'centripetal');
    const rb = radius(tb, 0) * 0.42;
    parts.push(
      tube({
        curve: lcurve,
        rings: 16,
        radial: 8,
        radius: (t) => rb * (1 - 0.75 * t) + 0.04,
        texelLength: 2,
        uRepeat: 1,
        moss: (_t, ny) => smoothstep(0.2, 0.9, ny) * 0.8,
      }),
    );
    field.crowns.push(end);
    field.hangPoints.push(mid, end);
  }
  field.crowns.push(curve.getPointAt(1));
  field.hangPoints.push(curve.getPointAt(0.8));
  return parts;
}

/**
 * `keepClear` holds polar angles that need a sight line (the waterfalls);
 * `entrance` is the approach path, which gets a wider opening up close.
 */
export function planTrees(seed: number, keepClear: number[], entrance: number): TreeField {
  const rng = new Rng(seed);
  const specs: TreeSpec[] = [];
  const offset = (a: number, k: number) => Math.abs(Math.atan2(Math.sin(a - k), Math.cos(a - k)));
  const blocked = (a: number, r: number) =>
    keepClear.some((k) => offset(a, k) < (r > 22 ? 0.2 : 0.11)) || (r < 30 && offset(a, entrance) < 0.27);
  const ring = (count: number, r0: number, r1: number, size: [number, number], height: [number, number], detail: number, phase: number) => {
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * TAU + rng.range(-0.18, 0.18) * (TAU / count);
      const r = rng.range(r0, r1);
      if (blocked(a, r)) continue;
      const lobeCount = rng.int(4, 6);
      const lobePhase = rng.range(0, TAU);
      const lobes: number[] = [];
      for (let k = 0; k < lobeCount; k++) lobes.push(lobePhase + (k / lobeCount) * TAU + rng.range(-0.35, 0.35));
      specs.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        r0: rng.range(size[0], size[1]),
        height: rng.range(height[0], height[1]),
        lobes,
        twist: rng.range(0.25, 0.7) * rng.sign(),
        detail,
        seed: rng.range(0, 100),
      });
    }
  };
  ring(11, 16.6, 19.4, [0.75, 1.1], [24, 30], 1, 0.2);
  ring(9, 23, 29, [1.0, 1.5], [26, 34], 0.85, 0.55);
  ring(22, 33, 56, [1.2, 2.0], [28, 38], 0.5, 0.1);
  return { specs, crowns: [], hangPoints: [] };
}

export function buildTrees(field: TreeField, bark: { map: THREE.Texture; normalMap: THREE.Texture }): THREE.Mesh {
  const rng = new Rng(509);
  const parts: THREE.BufferGeometry[] = [];
  for (const spec of field.specs) parts.push(...trunk(spec, rng, field));
  const geo = mergeGeometries(parts);
  const mat = new THREE.MeshStandardMaterial({
    map: bark.map,
    normalMap: bark.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    vertexColors: true,
    roughness: 0.93,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'trees';
  return mesh;
}

/** Lianas: drooping vines between trunks and hanging strands from limbs. */
export function buildVines(field: TreeField): THREE.Mesh {
  const rng = new Rng(733);
  const parts: THREE.BufferGeometry[] = [];
  const near = field.hangPoints.filter((p) => {
    const r = Math.hypot(p.x, p.z);
    return r > PLATFORM.radius + 1.5 && r < 30;
  });
  for (const top of near) {
    const strands = rng.int(1, 3);
    for (let s = 0; s < strands; s++) {
      const drop = rng.range(6, Math.max(7, top.y - 3));
      const sway = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1));
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        pts.push(top.clone().add(new THREE.Vector3(sway.x * Math.sin(t * 2.2) * 0.8, -drop * t, sway.z * Math.sin(t * 2.2) * 0.8)));
      }
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, rng.range(0.025, 0.055), 5, false));
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = rng.pick(near);
    const b = rng.pick(near);
    const d = a.distanceTo(b);
    if (d < 6 || d > 18) continue;
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= d * rng.range(0.25, 0.45);
    const pts = [a.clone(), a.clone().lerp(mid, 0.6).setY(mid.y + (a.y - mid.y) * 0.2), mid, b.clone().lerp(mid, 0.6).setY(mid.y + (b.y - mid.y) * 0.2), b.clone()];
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, rng.range(0.04, 0.08), 6, false));
  }
  const geo = mergeGeometries(parts);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#4a5a33', roughness: 0.9 }));
  mesh.castShadow = true;
  mesh.name = 'vines';
  return mesh;
}
