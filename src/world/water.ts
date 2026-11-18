import * as THREE from 'three';
import { Rng } from '../utils/random';
import { smoothstep, TAU } from '../utils/math';
import { Simplex } from '../utils/noise';
import { blobGeometry } from './foliage';
import { terrainHeight } from './ground';

/** Polar angles of the three waterfalls around the clearing. */
export const WATERFALL_ANGLES = [3.6, 5.62, 1.42];
const WATERFALL_RADIUS = 31;

const noiseGlsl = /* glsl */ `
  float wfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wfNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wfHash(i), wfHash(i + vec2(1.0, 0.0)), u.x), mix(wfHash(i + vec2(0.0, 1.0)), wfHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const sheetVertex = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const sheetFragment = /* glsl */ `
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uSpeed;
  varying vec2 vUv;
  ${noiseGlsl}
  void main() {
    float t = uTime * uSpeed;
    float s1 = wfNoise(vec2(vUv.x * 26.0, vUv.y * 3.0 + t * 2.6));
    float s2 = wfNoise(vec2(vUv.x * 70.0, vUv.y * 7.0 + t * 4.1));
    float streak = s1 * 0.6 + s2 * 0.4;
    float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
    edge *= 0.75 + 0.25 * wfNoise(vec2(vUv.x * 8.0, vUv.y * 2.0 + t));
    float a = edge * (0.4 + 0.6 * smoothstep(0.3, 0.85, streak));
    a *= smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.97, vUv.y);
    vec3 col = mix(uColor, vec3(1.0), smoothstep(0.45, 0.95, streak));
    gl_FragColor = vec4(col, a * 0.92);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const foamFragment = /* glsl */ `
  #include <fog_pars_fragment>
  uniform float uTime;
  varying vec2 vUv;
  ${noiseGlsl}
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float ang = atan(c.y, c.x);
    float n = wfNoise(vec2(ang * 6.0, r * 8.0 - uTime * 1.6));
    float a = smoothstep(1.0, 0.25, r) * (0.35 + 0.65 * n) * smoothstep(0.0, 0.15, r);
    gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), a * 0.8);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const mistVertex = /* glsl */ `
  #include <fog_pars_vertex>
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float life = fract(uTime * 0.07 + aSeed);
    p.y += life * 5.0;
    p.x += sin(uTime * 0.3 + aSeed * 20.0) * 0.8;
    p.z += cos(uTime * 0.25 + aSeed * 13.0) * 0.8;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uScale * (0.7 + aSeed) / max(1.0, -mvPosition.z);
    vAlpha = smoothstep(0.0, 0.2, life) * smoothstep(1.0, 0.5, life);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const mistFragment = /* glsl */ `
  #include <fog_pars_fragment>
  uniform sampler2D uMap;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha * 0.22;
    gl_FragColor = vec4(vec3(0.92, 0.96, 0.97), a);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface Waterfalls {
  group: THREE.Group;
  /** Crowns on top of each cliff, for canopy foliage. */
  crowns: THREE.Vector3[];
  update(time: number): void;
  setPixelRatio(ratio: number): void;
}

export function buildWaterfalls(dot: THREE.Texture): Waterfalls {
  const rng = new Rng(827);
  const noise = new Simplex(rng.next);
  const group = new THREE.Group();
  group.name = 'waterfalls';
  const crowns: THREE.Vector3[] = [];
  const time = { value: 0 };

  const sheetMat = new THREE.ShaderMaterial({
    vertexShader: sheetVertex,
    fragmentShader: sheetFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uColor: { value: new THREE.Color('#b9d6d4') }, uSpeed: { value: 1 }, uTime: { value: 0 } },
    ]),
  });
  sheetMat.uniforms.uTime = time;
  const foamMat = new THREE.ShaderMaterial({
    vertexShader: sheetVertex,
    fragmentShader: foamFragment,
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
  });
  foamMat.uniforms.uTime = time;
  const mistMat = new THREE.ShaderMaterial({
    vertexShader: mistVertex,
    fragmentShader: mistFragment,
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uScale: { value: 900 }, uTime: { value: 0 } }]),
  });
  mistMat.uniforms.uTime = time;
  mistMat.uniforms.uMap.value = dot;

  const rock = blobGeometry(2, 0.26, 4.2);
  const rpos = rock.getAttribute('position') as THREE.BufferAttribute;
  const rnorm = rock.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(rpos.count * 3);
  const stone = new THREE.Color('#7d837b');
  const wet = new THREE.Color('#4b524c');
  const moss = new THREE.Color('#58772f');
  const c = new THREE.Color();
  for (let i = 0; i < rpos.count; i++) {
    const n = noise.noise3(rpos.getX(i) * 2.5, rpos.getY(i) * 2.5, rpos.getZ(i) * 2.5);
    c.copy(stone).lerp(wet, smoothstep(0.2, -0.6, rpos.getY(i)) * 0.6).lerp(moss, smoothstep(0.1, 0.65, rnorm.getY(i) + n * 0.35));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  rock.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const boulders: THREE.Matrix4[] = [];

  const poolMat = new THREE.MeshStandardMaterial({ color: '#1c3936', roughness: 0.06, metalness: 0.2 });
  const mistPositions: number[] = [];
  const mistSeeds: number[] = [];

  for (const angle of WATERFALL_ANGLES) {
    const width = rng.range(3.2, 4.6);
    const height = rng.range(13, 16.5);
    const base = new THREE.Vector3(Math.cos(angle) * WATERFALL_RADIUS, 0, Math.sin(angle) * WATERFALL_RADIUS);
    base.y = terrainHeight(base.x, base.z) - 0.2;
    const frame = new THREE.Group();
    frame.position.copy(base);
    frame.rotation.y = Math.atan2(-base.x, -base.z);
    group.add(frame);
    frame.updateMatrixWorld();

    const rockAt = (x: number, y: number, z: number, s: number, sy = s) => {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z).applyMatrix4(frame.matrixWorld),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TAU)),
        new THREE.Vector3(s * rng.range(0.85, 1.15), sy, s * rng.range(0.85, 1.15)),
      );
      boulders.push(m);
    };
    for (const side of [-1, 1]) {
      for (let y = 1; y < height + 2; y += rng.range(3, 4.2)) {
        rockAt(side * (width / 2 + rng.range(2.2, 3.2)), y, rng.range(-1.6, -0.4), rng.range(3, 4.3), rng.range(2.4, 3.4));
      }
      rockAt(side * (width / 2 + 6.5), rng.range(2, 6), rng.range(-3, -1), rng.range(4, 5.5), rng.range(3.5, 5));
    }
    for (let y = 1.5; y < height; y += 3.6) rockAt(rng.range(-0.8, 0.8), y, -3.1, rng.range(3, 3.8), rng.range(2.4, 3.2));
    rockAt(0, height + 1.4, -1.6, rng.range(3.4, 4.2), 2.2);
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI);
      rockAt(Math.cos(a) * rng.range(4.5, 6), 0.1, 1.6 + Math.sin(a) * rng.range(1.5, 4.5), rng.range(0.6, 1.4), rng.range(0.45, 0.8));
    }
    crowns.push(
      new THREE.Vector3(-width / 2 - 3, height + 3.5, -1.5).applyMatrix4(frame.matrixWorld),
      new THREE.Vector3(width / 2 + 3, height + 3.5, -1.5).applyMatrix4(frame.matrixWorld),
      new THREE.Vector3(0, height + 5, -4).applyMatrix4(frame.matrixWorld),
    );

    const sheetGeo = new THREE.PlaneGeometry(width, height, 1, 24);
    const sp = sheetGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const t = (sp.getY(i) + height / 2) / height;
      sp.setZ(i, Math.pow(t, 6) * 0.9 - 0.25);
      sp.setX(i, sp.getX(i) * (1 + (1 - t) * 0.25));
    }
    sheetGeo.translate(0, height / 2 + 0.2, 0);
    const sheet = new THREE.Mesh(sheetGeo, sheetMat);
    sheet.renderOrder = 3;
    frame.add(sheet);

    const pool = new THREE.Mesh(new THREE.CircleGeometry(4.8, 48), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.35, 1.8);
    pool.receiveShadow = true;
    frame.add(pool);

    const foam = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.2, width * 2.2), foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, 0.42, 0.5);
    foam.renderOrder = 4;
    frame.add(foam);

    for (let i = 0; i < 46; i++) {
      const p = new THREE.Vector3(rng.range(-width, width), rng.range(0, 1.5), rng.range(-0.5, 3)).applyMatrix4(frame.matrixWorld);
      mistPositions.push(p.x, p.y, p.z);
      mistSeeds.push(rng.next());
    }
  }

  const rocks = new THREE.InstancedMesh(rock, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), boulders.length);
  boulders.forEach((m, i) => rocks.setMatrixAt(i, m));
  rocks.receiveShadow = true;
  rocks.castShadow = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.Float32BufferAttribute(mistPositions, 3));
  mistGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(mistSeeds, 1));
  const mist = new THREE.Points(mistGeo, mistMat);
  mist.frustumCulled = false;
  mist.renderOrder = 4;
  group.add(mist);

  return {
    group,
    crowns,
    update(t: number) {
      time.value = t;
    },
    setPixelRatio(ratio: number) {
      mistMat.uniforms.uScale.value = 900 * ratio;
    },
  };
}
