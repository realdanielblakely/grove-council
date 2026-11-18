import * as THREE from 'three';
import { INLAY, PLATFORM, PLAYER, TABLE, WORLD } from '../config';
import { CollisionWorld } from '../physics/collision';
import { buildAtmosphere, type Atmosphere } from './atmosphere';
import { buildChairs, chairLayout, type ChairInfo } from './chairs';
import { buildCanopy, buildUnderstory } from './foliage';
import { buildGround, groundHeightAt } from './ground';
import { buildPlatform } from './platform';
import { buildTable, tableFootprints } from './table';
import * as tex from './textures';
import { buildTrees, buildVines, planTrees } from './trees';
import { buildWaterfalls, WATERFALL_ANGLES, type Waterfalls } from './water';

export interface Quality {
  shadowMapSize: number;
}

export interface World {
  collision: CollisionWorld;
  chairs: ChairInfo[];
  atmosphere: Atmosphere;
  update(time: number): void;
  setPixelRatio(ratio: number): void;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function buildWorld(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  quality: Quality,
  progress: (fraction: number, label: string) => void,
): Promise<World> {
  const steps = 7;
  let step = 0;
  const report = async (label: string) => {
    progress(step++ / steps, label);
    await nextFrame();
  };

  await report('Cutting the stone floor');
  const chairs = chairLayout();
  const floor = tex.floorTexture({
    radius: PLATFORM.radius,
    bandRadius: PLATFORM.bandRadius,
    inlay: INLAY,
    tablePolygons: tableFootprints(0),
    chairSpots: chairs.map((c) => ({ x: c.position.x, z: c.position.z, r: c.variant === 'throne' ? 0.55 : 0.42 })),
  });
  scene.add(buildPlatform(floor));
  const table = buildTable(tex.stoneTexture());
  scene.add(table.group);

  await report('Shaping the council seats');
  scene.add(buildChairs(chairs));

  await report('Laying the jungle floor');
  const groundTex = tex.groundTextures();
  scene.add(buildGround(groundTex.map, groundTex.normalMap));

  await report('Growing the trees');
  const field = planTrees(WORLD.seed, WATERFALL_ANGLES, PLAYER.spawnAngle);
  scene.add(buildTrees(field, tex.barkTextures()));
  scene.add(buildVines(field));

  await report('Filling the canopy');
  const dot = tex.softDotTexture();
  const waterfalls: Waterfalls = buildWaterfalls(dot);
  scene.add(waterfalls.group);
  const foliageTex = {
    leaf: tex.leafClusterTexture(),
    fern: tex.fernTexture(),
    broadLeaf: tex.broadLeafTexture(),
    grass: tex.grassTexture(),
  };
  scene.add(buildCanopy(field, waterfalls.crowns, foliageTex, WATERFALL_ANGLES));
  const entryX = Math.cos(PLAYER.spawnAngle);
  const entryZ = Math.sin(PLAYER.spawnAngle);
  const onEntrancePath = (x: number, z: number) => {
    const along = x * entryX + z * entryZ;
    return along > 0 && along < PLAYER.spawnRadius + 3 && Math.abs(x * entryZ - z * entryX) < 1.5;
  };
  scene.add(
    buildUnderstory(
      foliageTex,
      field.specs.filter((s) => Math.hypot(s.x, s.z) < 32),
      (x, z) => onEntrancePath(x, z) || field.specs.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < (s.r0 * 1.7) ** 2),
    ),
  );

  await report('Letting the light in');
  const atmosphere = buildAtmosphere(scene, renderer, tex.goboTexture(), dot, quality);

  await report('Settling the dust');
  const collision = new CollisionWorld();
  collision.groundFn = groundHeightAt;
  collision.boundaryRadius = WORLD.walkRadius;
  for (const fp of table.footprints) collision.addPolygon(fp, PLATFORM.height + TABLE.height);
  for (const c of chairs) {
    const center = c.position.clone().addScaledVector(c.forward, -0.08);
    collision.addCircle(center.x, center.z, c.collisionRadius, c.position.y + c.height);
  }
  for (const s of field.specs) {
    if (Math.hypot(s.x, s.z) > WORLD.walkRadius + 6) continue;
    collision.addCircle(s.x, s.z, s.r0 * 1.85);
  }
  progress(1, 'Ready');

  return {
    collision,
    chairs,
    atmosphere,
    update(time: number) {
      atmosphere.update(time);
      waterfalls.update(time);
    },
    setPixelRatio(ratio: number) {
      atmosphere.setPixelRatio(ratio);
      waterfalls.setPixelRatio(ratio);
    },
  };
}
