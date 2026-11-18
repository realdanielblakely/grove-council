import * as THREE from 'three';
import { INLAY, PLATFORM } from '../config';

export function buildPlatform(floor: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = 'platform';
  const R = PLATFORM.radius;
  const H = PLATFORM.height;

  const top = new THREE.Mesh(
    new THREE.CircleGeometry(R, 192),
    new THREE.MeshStandardMaterial({ map: floor, roughness: 0.84, metalness: 0 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = H;
  top.receiveShadow = true;
  group.add(top);

  const lip = [
    new THREE.Vector2(R - 0.001, H),
    new THREE.Vector2(R + 0.025, H - 0.006),
    new THREE.Vector2(R + 0.05, H - 0.03),
    new THREE.Vector2(R + 0.065, H - 0.08),
    new THREE.Vector2(R + 0.08, 0.02),
    new THREE.Vector2(R + 0.2, -0.06),
  ];
  const edge = new THREE.Mesh(
    new THREE.LatheGeometry(lip, 192),
    new THREE.MeshStandardMaterial({ color: '#8d928a', roughness: 0.9 }),
  );
  edge.receiveShadow = true;
  group.add(edge);

  const gold = new THREE.MeshStandardMaterial({
    color: '#d3a23f',
    metalness: 0.85,
    roughness: 0.3,
    emissive: '#4a2f06',
    emissiveIntensity: 0.55,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const band = new THREE.Mesh(new THREE.RingGeometry(INLAY.bandInner, INLAY.bandOuter, 256, 1), gold);
  const line = new THREE.Mesh(
    new THREE.RingGeometry(INLAY.lineRadius - INLAY.lineWidth / 2, INLAY.lineRadius + INLAY.lineWidth / 2, 256, 1),
    gold,
  );
  for (const m of [band, line]) {
    m.rotation.x = -Math.PI / 2;
    m.position.y = H + 0.002;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

/** Terrain height used by physics: the raised platform with a short bevel. */
export function platformHeightAt(r: number): number {
  const R = PLATFORM.radius;
  if (r <= R) return PLATFORM.height;
  if (r >= R + 0.12) return 0;
  return PLATFORM.height * (1 - (r - R) / 0.12);
}
