import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLATFORM, TABLE } from '../config';
import { TAU } from '../utils/math';

export type Footprint = Array<[number, number]>;

/**
 * Annular slab between two gaps whose sides stay parallel to each gap's
 * center line, so every gap has the same walkable width from inside to out.
 */
function slabFootprint(inner: number, outer: number, gapA: number, gapB: number, halfGap: number, steps = 48): Footprint {
  const oa0 = gapA + Math.asin(halfGap / outer);
  const oa1 = gapB - Math.asin(halfGap / outer);
  const ia0 = gapA + Math.asin(halfGap / inner);
  const ia1 = gapB - Math.asin(halfGap / inner);
  const pts: Footprint = [];
  for (let i = 0; i <= steps; i++) {
    const a = oa0 + ((oa1 - oa0) * i) / steps;
    pts.push([outer * Math.cos(a), outer * Math.sin(a)]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = ia0 + ((ia1 - ia0) * i) / steps;
    pts.push([inner * Math.cos(a), inner * Math.sin(a)]);
  }
  return pts;
}

export function tableFootprints(inset = 0): Footprint[] {
  const out: Footprint[] = [];
  for (let s = 0; s < TABLE.segments; s++) {
    const gapA = TABLE.firstGapAngle + (s * TAU) / TABLE.segments;
    const gapB = TABLE.firstGapAngle + ((s + 1) * TAU) / TABLE.segments;
    out.push(slabFootprint(TABLE.innerRadius + inset, TABLE.outerRadius - inset, gapA, gapB, TABLE.gapWidth / 2 + inset));
  }
  return out;
}

/** Extrudes a footprint from y0 to y1 with rounded top and bottom edges. */
function extrudeFootprint(fp: Footprint, y0: number, y1: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(fp.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: y1 - y0 - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 4,
    curveSegments: 1,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0 + bevel, 0);
  return geo;
}

export function buildTable(stone: THREE.Texture): { group: THREE.Group; footprints: Footprint[] } {
  const group = new THREE.Group();
  group.name = 'table';
  const base = PLATFORM.height;
  const plinth: THREE.BufferGeometry[] = [];
  const body: THREE.BufferGeometry[] = [];
  for (const fp of tableFootprints(0.13)) plinth.push(extrudeFootprint(fp, base, base + 0.12, 0.015));
  for (const fp of tableFootprints(0.035)) body.push(extrudeFootprint(fp, base + 0.1, base + TABLE.height - 0.13, 0.03));
  for (const fp of tableFootprints(0)) body.push(extrudeFootprint(fp, base + TABLE.height - 0.15, base + TABLE.height, 0.04));

  stone.repeat.set(0.3, 0.3);
  const slabMat = new THREE.MeshStandardMaterial({ color: '#e3e5e1', map: stone, roughness: 0.58, metalness: 0 });
  const plinthMat = new THREE.MeshStandardMaterial({ color: '#9fa39d', roughness: 0.8 });

  const bodyMesh = new THREE.Mesh(mergeGeometries(body), slabMat);
  const plinthMesh = new THREE.Mesh(mergeGeometries(plinth), plinthMat);
  for (const m of [bodyMesh, plinthMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return { group, footprints: tableFootprints(0) };
}
