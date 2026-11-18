import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLATFORM, WORLD } from '../config';
import { Simplex } from '../utils/noise';
import { Rng } from '../utils/random';
import { smoothstep, TAU } from '../utils/math';
import { sunDirection } from './atmosphere';
import { terrainHeight } from './ground';
import type { TreeField } from './trees';

const noise = new Simplex(new Rng(307).next);

/** Distance from a point to the column of sky that lights the clearing. */
function lightWellDistance(p: THREE.Vector3): number {
  const along = p.dot(sunDirection);
  return Math.sqrt(Math.max(0, p.lengthSq() - along * along));
}

export function blobGeometry(detail: number, rough: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = noise.fbm3(v.x * 1.7 + seed, v.y * 1.7, v.z * 1.7, 3) * rough + noise.noise3(v.x * 4.5, v.y * 4.5 + seed, v.z * 4.5) * rough * 0.35;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const merged = mergeVerticesKeepNormals(geo);
  return merged;
}

/** Icosahedron output is non-indexed with split normals; weld for smooth blobs. */
function mergeVerticesKeepNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const map = new Map<string, number>();
  const unique: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = unique.length / 3;
      map.set(key, id);
      unique.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    index.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(unique, 3));
  out.setIndex(index);
  out.computeVertexNormals();
  return out;
}

function shadeByHeight(geo: THREE.BufferGeometry, low: THREE.Color, high: THREE.Color): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const n = noise.noise3(pos.getX(i) * 3, y * 3, pos.getZ(i) * 3);
    c.copy(low).lerp(high, smoothstep(-0.9, 0.8, y + n * 0.25));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

interface Clump {
  center: THREE.Vector3;
  scale: THREE.Vector3;
}

export interface FoliageTextures {
  leaf: THREE.Texture;
  fern: THREE.Texture;
  broadLeaf: THREE.Texture;
  grass: THREE.Texture;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);

function planClumps(field: TreeField, extra: THREE.Vector3[], keepClear: number[], rng: Rng): Clump[] {
  const clumps: Clump[] = [];
  const ok = (p: THREE.Vector3, s: number) => lightWellDistance(p) - s * 0.55 > 11.2 && p.y > 9;
  const add = (p: THREE.Vector3, s: number) => {
    if (!ok(p, s)) return;
    clumps.push({ center: p, scale: new THREE.Vector3(s * rng.range(0.9, 1.3), s * rng.range(0.55, 0.8), s * rng.range(0.9, 1.3)) });
  };
  for (const crown of [...field.crowns, ...extra]) {
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const p = crown.clone().add(new THREE.Vector3(rng.range(-2.5, 2.5), rng.range(-1, 2), rng.range(-2.5, 2.5)));
      add(p, rng.range(3, 5.5));
    }
  }
  for (let i = 0; i < 200; i++) {
    const a = rng.range(0, TAU);
    const r = 12 + Math.pow(rng.next(), 0.8) * 50;
    const y = 17 + rng.range(0, 12) + smoothstep(20, 60, r) * 6;
    add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), rng.range(3.5, 7.5));
  }
  // A low wall of undergrowth past the walkable ring, so the distance reads as jungle.
  for (let i = 0; i < 160; i++) {
    const a = rng.range(0, TAU);
    const r = WORLD.walkRadius + 5 + Math.pow(rng.next(), 0.7) * 45;
    if (r < 46 && keepClear.some((k) => Math.abs(Math.atan2(Math.sin(a - k), Math.cos(a - k))) < 0.26)) continue;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = rng.range(3, 6.5);
    const center = new THREE.Vector3(x, terrainHeight(x, z) + s * rng.range(0.15, 0.4), z);
    clumps.push({ center, scale: new THREE.Vector3(s * rng.range(0.9, 1.4), s * rng.range(0.6, 0.9), s * rng.range(0.9, 1.4)) });
  }
  return clumps;
}

export function buildCanopy(field: TreeField, extraCrowns: THREE.Vector3[], tex: FoliageTextures, keepClear: number[]): THREE.Group {
  const rng = new Rng(419);
  const group = new THREE.Group();
  group.name = 'canopy';
  const clumps = planClumps(field, extraCrowns, keepClear, rng);

  const blob = blobGeometry(2, 0.3, 3.1);
  shadeByHeight(blob, new THREE.Color('#5e7458'), new THREE.Color('#ffffff'));
  const blobMat = dissolveBelowRaisedCamera(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }));
  const blobs = new THREE.InstancedMesh(blob, blobMat, clumps.length);
  clumps.forEach((c, i) => {
    tmpQ.setFromAxisAngle(Y, rng.range(0, TAU));
    tmpM.compose(c.center, tmpQ, c.scale);
    blobs.setMatrixAt(i, tmpM);
    blobs.setColorAt(i, tmpC.setHSL(rng.range(0.25, 0.31), rng.range(0.32, 0.5), rng.range(0.13, 0.2)));
  });
  blobs.receiveShadow = true;
  blobs.computeBoundingSphere();
  group.add(blobs);

  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, 0.5, 0);
  const cardMat = dissolveBelowRaisedCamera(
    new THREE.MeshStandardMaterial({
      map: tex.leaf,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.75,
    }),
  );
  const perClump = 34;
  const cards = new THREE.InstancedMesh(card, cardMat, clumps.length * perClump);
  let k = 0;
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  for (const c of clumps) {
    for (let i = 0; i < perClump; i++) {
      dir.set(rng.range(-1, 1), rng.range(-1, 0.55), rng.range(-1, 1)).normalize();
      tmpP.set(dir.x * c.scale.x, dir.y * c.scale.y, dir.z * c.scale.z).multiplyScalar(0.82).add(c.center);
      up.copy(dir).add(new THREE.Vector3(rng.range(-0.6, 0.6), rng.range(-0.3, 0.3), rng.range(-0.6, 0.6))).normalize();
      side.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).cross(up).normalize();
      const normal = new THREE.Vector3().crossVectors(side, up).normalize();
      basis.makeBasis(side, up, normal);
      tmpQ.setFromRotationMatrix(basis);
      const s = rng.range(1.1, 2.1);
      tmpS.set(s, s, s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      cards.setMatrixAt(k, tmpM);
      cards.setColorAt(k, tmpC.setHSL(rng.range(0.23, 0.3), rng.range(0.35, 0.55), rng.range(0.3, 0.52)));
      k++;
    }
  }
  cards.count = k;
  cards.receiveShadow = true;
  cards.computeBoundingSphere();
  group.add(cards);
  return group;
}

function fernGeometry(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const g = new THREE.PlaneGeometry(0.42, 1.5, 1, 8);
    g.translate(0, 0.75, 0);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const t = y / 1.5;
      pos.setZ(v, t * t * 0.7 + Math.abs(pos.getX(v)) * 0.25);
      pos.setY(v, y * (1 - t * 0.18));
    }
    g.computeVertexNormals();
    g.rotateX(-0.55 - (i % 3) * 0.12);
    g.rotateY((i / count) * TAU + (i % 2) * 0.3);
    fronds.push(g);
  }
  return mergeGeometries(fronds);
}

function broadPlantGeometry(): THREE.BufferGeometry {
  const leaves: THREE.BufferGeometry[] = [];
  const count = 5;
  for (let i = 0; i < count; i++) {
    const g = new THREE.PlaneGeometry(0.95, 1.2, 4, 6);
    g.translate(0, 0.6, 0);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const t = pos.getY(v) / 1.2;
      pos.setZ(v, x * x * 0.55 + t * t * 0.45);
    }
    g.computeVertexNormals();
    g.rotateX(-0.75 - (i % 2) * 0.2);
    g.translate(0, 0.35 + (i % 3) * 0.12, 0);
    g.rotateY((i / count) * TAU + i * 0.4);
    leaves.push(g);
  }
  return mergeGeometries(leaves);
}

function grassGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(0.6, 0.5);
  a.translate(0, 0.25, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const c = a.clone().rotateY(Math.PI / 4);
  return mergeGeometries([a, b, c]);
}

export interface Scatter {
  x: number;
  z: number;
}

/**
 * Understory: ferns, broad leaves and grass ringing the platform and the
 * tree bases, plus mossy rocks. Keeps the platform itself clear.
 */
/** Screen-door dissolve: discards fragments where the GLSL float expression `keep` drops below a dither pattern. */
function dissolve(material: THREE.MeshStandardMaterial, keep: string): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      /* glsl */ `#include <alphatest_fragment>
      if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > ${keep}) discard;`,
    );
  };
  material.customProgramCacheKey = () => keep;
  return material;
}

/** Plants right in front of the lens fade, so a trailing camera never stares into a frond. */
const dissolveNearCamera = (material: THREE.MeshStandardMaterial) => dissolve(material, 'smoothstep(0.55, 2.1, length(vViewPosition))');

/** Canopy near a raised camera fades, so the view from above looks down into the clearing. */
const dissolveBelowRaisedCamera = (material: THREE.MeshStandardMaterial) =>
  dissolve(material, '(cameraPosition.y < 8.5 ? 1.0 : smoothstep(17.0, 23.0, length(vViewPosition) / smoothstep(8.0, 26.0, cameraPosition.y)))');

export function buildUnderstory(tex: FoliageTextures, trees: Scatter[], avoid: (x: number, z: number) => boolean): THREE.Group {
  const rng = new Rng(613);
  const group = new THREE.Group();
  group.name = 'understory';
  const place = (n: number, rMin: number, rMax: number, nearTrees: number) => {
    const out: Array<{ x: number; z: number }> = [];
    let guard = 0;
    while (out.length < n && guard++ < n * 30) {
      let x: number;
      let z: number;
      if (rng.next() < nearTrees && trees.length) {
        const t = rng.pick(trees);
        const a = rng.range(0, TAU);
        const r = rng.range(1.8, 5);
        x = t.x + Math.cos(a) * r;
        z = t.z + Math.sin(a) * r;
      } else {
        const a = rng.range(0, TAU);
        const r = rMin + Math.pow(rng.next(), 0.9) * (rMax - rMin);
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
      const r = Math.hypot(x, z);
      if (r < rMin || r > rMax || avoid(x, z)) continue;
      out.push({ x, z });
    }
    return out;
  };

  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, spots: Scatter[], scale: [number, number], tint: () => THREE.Color, sink = 0) => {
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((s, i) => {
      const sc = rng.range(scale[0], scale[1]);
      tmpQ.setFromAxisAngle(Y, rng.range(0, TAU));
      tmpS.set(sc, sc * rng.range(0.85, 1.15), sc);
      tmpP.set(s.x, terrainHeight(s.x, s.z) - sink, s.z);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(i, tmpM);
      mesh.setColorAt(i, tint());
    });
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  };

  const foliageMat = (map: THREE.Texture) =>
    dissolveNearCamera(new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 }));

  const green = (h0: number, h1: number, l0: number, l1: number) => () => tmpC.setHSL(rng.range(h0, h1), 0.45, rng.range(l0, l1));
  const fernMat = foliageMat(tex.fern);
  instanced(fernGeometry(), fernMat, place(380, PLATFORM.radius + 1.2, 32, 0.4), [0.75, 1.6], green(0.24, 0.3, 0.5, 0.75));
  instanced(fernGeometry(), fernMat, place(150, PLATFORM.radius + 0.45, PLATFORM.radius + 2.6, 0), [0.45, 0.85], green(0.23, 0.29, 0.55, 0.8));
  instanced(broadPlantGeometry(), foliageMat(tex.broadLeaf), place(190, PLATFORM.radius + 1.6, 32, 0.5), [0.8, 1.9], green(0.24, 0.29, 0.5, 0.72));
  instanced(grassGeometry(), foliageMat(tex.grass), place(1500, PLATFORM.radius + 0.2, 24, 0.25), [0.6, 1.4], green(0.22, 0.3, 0.5, 0.8));

  const rock = blobGeometry(2, 0.22, 9.7);
  rock.scale(1, 0.62, 1);
  const rpos = rock.getAttribute('position') as THREE.BufferAttribute;
  const rnorm = rock.getAttribute('normal') as THREE.BufferAttribute;
  const rcol = new Float32Array(rpos.count * 3);
  const stone = new THREE.Color('#8f948a');
  const moss = new THREE.Color('#5d7a35');
  for (let i = 0; i < rpos.count; i++) {
    tmpC.copy(stone).lerp(moss, smoothstep(0.15, 0.75, rnorm.getY(i) + noise.noise3(rpos.getX(i) * 2, rpos.getY(i) * 2, rpos.getZ(i) * 2) * 0.3));
    rcol[i * 3] = tmpC.r;
    rcol[i * 3 + 1] = tmpC.g;
    rcol[i * 3 + 2] = tmpC.b;
  }
  rock.setAttribute('color', new THREE.BufferAttribute(rcol, 3));
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const rocks = instanced(rock, rockMat, place(46, PLATFORM.radius + 1.2, 34, 0.5), [0.35, 1.2], () => tmpC.setScalar(rng.range(0.8, 1)), 0.15);
  rocks.castShadow = true;
  return group;
}
