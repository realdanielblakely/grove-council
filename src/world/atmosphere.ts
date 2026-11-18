import * as THREE from 'three';
import { PLATFORM, SUN } from '../config';
import { Rng } from '../utils/random';

export const FOG_COLOR = new THREE.Color('#507466');

export const sunDirection = new THREE.Vector3(...SUN.direction).normalize();

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, smoothstep(0.02, 0.7, h));
    col = mix(uGround, col, smoothstep(-0.3, 0.03, h));
    float s = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(s, 90.0) * 1.6 + pow(s, 8.0) * 0.22);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const envFragment = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 ground = vec3(0.07, 0.065, 0.045);
    vec3 horizon = vec3(0.2, 0.3, 0.25);
    vec3 canopy = vec3(0.09, 0.16, 0.09);
    vec3 sky = vec3(1.5, 1.62, 1.5);
    vec3 col = mix(ground, horizon, smoothstep(-0.35, 0.0, h));
    col = mix(col, canopy, smoothstep(0.12, 0.42, h));
    col = mix(col, sky, smoothstep(0.74, 0.96, h));
    col += vec3(5.0, 4.3, 3.1) * pow(max(dot(d, uSunDir), 0.0), 300.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: envFragment,
      uniforms: { uSunDir: { value: sunDirection } },
    }),
  );
  envScene.add(sphere);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  sphere.geometry.dispose();
  (sphere.material as THREE.Material).dispose();
  return rt.texture;
}

const shaftVertex = /* glsl */ `
  varying float vAlong;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vAlong = uv.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const shaftFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying float vAlong;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 v = normalize(cameraPosition - vPosW);
    float facing = abs(dot(normalize(vNormalW), v));
    float a = pow(facing, 2.5);
    a *= smoothstep(0.0, 0.3, vAlong) * smoothstep(1.0, 0.55, vAlong);
    a *= 0.7 + 0.3 * sin(uTime * 0.5 + vPosW.x * 0.35 + vPosW.z * 0.25);
    float near = smoothstep(0.5, 4.0, length(cameraPosition - vPosW));
    a *= uIntensity * near;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const dustVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float t = uTime * 0.1 + aSeed * 40.0;
    p.x += sin(t * 1.3 + aSeed * 11.0) * 0.7;
    p.y += sin(t * 0.8 + aSeed * 5.0) * 0.5;
    p.z += cos(t * 1.1 + aSeed * 7.0) * 0.7;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uScale * (0.5 + aSeed) / max(0.5, -mv.z);
    vAlpha = (0.55 + 0.45 * sin(t * 4.0 + aSeed * 23.0)) * smoothstep(0.5, 3.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const dustFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export interface Atmosphere {
  sun: THREE.SpotLight;
  update(time: number): void;
  setPixelRatio(ratio: number): void;
}

export function buildAtmosphere(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  gobo: THREE.Texture,
  dot: THREE.Texture,
  quality: { shadowMapSize: number },
): Atmosphere {
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.02);
  scene.background = FOG_COLOR.clone();
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 0.62;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        uZenith: { value: new THREE.Color('#e4f1e8') },
        uHorizon: { value: FOG_COLOR.clone() },
        uGround: { value: new THREE.Color('#2b3a30') },
        uSunDir: { value: sunDirection },
        uSunColor: { value: new THREE.Color('#fff1d0') },
      },
    }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.name = 'sky';
  scene.add(sky);

  const hemi = new THREE.HemisphereLight('#d2e8dc', '#3a3424', 0.35);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight('#9fc3cf', 0.3);
  fill.position.set(-sunDirection.x, 0.6, -sunDirection.z).multiplyScalar(30);
  scene.add(fill);

  const sun = new THREE.SpotLight('#ffe6bd', 3.4, 0, 0.36, 0.62, 0);
  sun.position.copy(sunDirection).multiplyScalar(SUN.distance);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.camera.near = 18;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  sun.map = gobo;
  scene.add(sun, sun.target);

  const rng = new Rng(5);
  const shaftMat = new THREE.ShaderMaterial({
    vertexShader: shaftVertex,
    fragmentShader: shaftFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.085 },
      uColor: { value: new THREE.Color('#ffe9c2') },
    },
  });
  const shafts = new THREE.Group();
  shafts.name = 'light-shafts';
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 9;
    const bottom = new THREE.Vector3(Math.cos(a) * r, PLATFORM.height, Math.sin(a) * r);
    const len = 26 / sunDirection.y;
    const radius = rng.range(0.5, 1.7);
    const geo = new THREE.CylinderGeometry(radius * 0.8, radius, len, 20, 1, true);
    const mesh = new THREE.Mesh(geo, shaftMat);
    mesh.position.copy(bottom).addScaledVector(sunDirection, len / 2);
    mesh.quaternion.setFromUnitVectors(up, sunDirection);
    mesh.renderOrder = 5;
    shafts.add(mesh);
  }
  scene.add(shafts);

  const count = 520;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 14;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = rng.range(0.4, 9);
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = rng.next();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 60 },
      uMap: { value: dot },
      uColor: { value: new THREE.Color('#fff0cc').multiplyScalar(0.55) },
    },
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 6;
  scene.add(dust);

  return {
    sun,
    update(time: number) {
      shaftMat.uniforms.uTime.value = time;
      dustMat.uniforms.uTime.value = time;
    },
    setPixelRatio(ratio: number) {
      dustMat.uniforms.uScale.value = 60 * ratio;
    },
  };
}
