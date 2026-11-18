import * as THREE from 'three';
import { PLATFORM, WORLD } from '../config';
import { Simplex } from '../utils/noise';
import { Rng } from '../utils/random';
import { smoothstep, TAU } from '../utils/math';
import { platformHeightAt } from './platform';

const terrainNoise = new Simplex(new Rng(101).next);

/** Jungle floor height: flat where the player walks, rising into slopes beyond. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const rise = smoothstep(WORLD.walkRadius + 1, 70, r);
  const lumps = terrainNoise.fbm2(x * 0.035, z * 0.035, 3) * 2.2 * smoothstep(WORLD.walkRadius, 40, r);
  const ripples = terrainNoise.noise2(x * 0.4, z * 0.4) * 0.04 * smoothstep(PLATFORM.radius + 0.5, 16, r);
  return rise * rise * 14 + lumps + ripples;
}

export function groundHeightAt(x: number, z: number): number {
  return Math.max(platformHeightAt(Math.hypot(x, z)), terrainHeight(x, z));
}

export function buildGround(map: THREE.Texture, normalMap: THREE.Texture): THREE.Mesh {
  const radii: number[] = [];
  for (let r = PLATFORM.radius - 0.3; r < 150; ) {
    radii.push(r);
    r += r < 30 ? 0.45 : r < 60 ? 1.2 : 4;
  }
  const seg = 200;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const soil = new THREE.Color('#a19a7a');
  const dry = new THREE.Color('#b9ae92');
  const moss = new THREE.Color('#7a9b4a');
  const deep = new THREE.Color('#58763c');
  const c = new THREE.Color();
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = terrainHeight(x, z);
      positions.push(x, y, z);
      uvs.push(x / 4, z / 4);
      const mossy = smoothstep(-0.3, 0.35, terrainNoise.fbm2(x * 0.11 + 3, z * 0.11 - 5, 4)) * smoothstep(12.2, 15, r);
      const bare = smoothstep(14, 12.3, r);
      c.copy(soil).lerp(dry, bare * 0.6).lerp(moss, mossy * 0.9).lerp(deep, smoothstep(26, 55, r) * 0.7);
      colors.push(c.r, c.g, c.b);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < radii.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j;
      const b = a + 1;
      const d = a + row;
      const e = d + 1;
      indices.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    vertexColors: true,
    roughness: 0.96,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
