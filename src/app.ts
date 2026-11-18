import * as THREE from 'three';
import { CameraRig } from './camera';
import { PLAYER } from './config';
import { Input, type Action } from './input';
import { Avatar } from './player/avatar';
import { Player } from './player/player';
import type { Hud } from './ui/hud';
import { Mannequins } from './world/mannequins';
import { softDotTexture } from './world/textures';
import { buildWorld } from './world/world';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export async function start(hud: Hud): Promise<void> {
  if (!webglAvailable()) {
    throw new Error('This browser could not start WebGL 2. Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
  }
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const maxRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75);
  const pinnedRatio = Number(new URLSearchParams(location.search).get('ratio')) || 0;
  let ratio = pinnedRatio || Math.min(maxRatio, 1.5);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Everything that casts shadows is static, so the map renders only on demand.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 600);

  const world = await buildWorld(scene, renderer, { shadowMapSize: coarse ? 1024 : 2048 }, (f, label) => hud.setProgress(f * 0.92, label));
  world.setPixelRatio(ratio);

  const avatar = new Avatar(softDotTexture());
  avatar.root.traverse((o) => (o.castShadow = false));
  scene.add(avatar.root, avatar.blobShadow);
  const mannequins = new Mannequins(world.chairs);
  scene.add(mannequins.mesh);

  const player = new Player(world.collision, world.chairs);
  player.spawn(PLAYER.spawnAngle, PLAYER.spawnRadius);
  const rig = new CameraRig(camera, world.collision);
  rig.yaw = player.yaw;
  rig.overview = true;

  const input = new Input(canvas, hud.stick, hud.stickKnob);
  hud.bindButtons((a) => input.trigger(a));
  input.onPointerLockChange = (locked) => hud.setPointerLocked(locked);

  hud.setProgress(0.95, 'Compiling shaders');
  await renderer.compileAsync(scene, camera);
  renderer.shadowMap.needsUpdate = true;

  let jumpQueued = false;
  let seatedFor = 0;

  const sitOrStand = () => {
    if (rig.overview) return;
    if (player.mode === 'free') {
      const chair = player.nearbyChair();
      if (!chair) {
        hud.toast('Walk up to a chair to sit');
        return;
      }
      player.sitDown(chair);
      rig.resetSeatLook();
      mannequins.setVacant(chair.index);
      seatedFor = 0;
    } else if (player.mode === 'seated' && player.seat) {
      const yaw = player.seat.yaw;
      if (player.standUp()) rig.adoptSeatLook(yaw);
    }
  };

  const actions: Record<Action, () => void> = {
    jump: () => {
      if (player.mode === 'seated') sitOrStand();
      else jumpQueued = true;
    },
    sit: sitOrStand,
    view: () => {
      rig.view = rig.view === 'third' ? 'first' : 'third';
      hud.setView(rig.view === 'first');
      hud.toast(rig.view === 'first' ? 'First-person view' : 'Third-person view');
    },
    mannequins: () => {
      mannequins.visible = !mannequins.visible;
      renderer.shadowMap.needsUpdate = true;
      hud.setSeats(mannequins.visible);
      hud.toast(mannequins.visible ? 'Mannequins take their seats' : 'The seats are empty again');
    },
    overview: () => {
      rig.overview = !rig.overview;
      hud.toast(rig.overview ? 'Overview: press O to return' : 'Back on the ground');
    },
    hints: () => {
      hud.toggleHints();
    },
  };
  input.onAction = (a) => actions[a]();

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const head = new THREE.Vector3();
  const timer = new THREE.Timer();
  timer.connect(document);
  let frameTimeSum = 0;
  let frameCount = 0;
  let calmFor = 0;
  let simTime = 0;
  let frozen = false;

  const step = (dt: number) => {
    simTime += dt;
    const look = input.consumeLook();
    rig.look(look.x, look.y, look.zoom);

    const controllable = input.enabled && !rig.overview;
    const axis = controllable ? input.moveAxis() : { x: 0, y: 0 };
    if (player.mode === 'seated') {
      seatedFor += dt;
      if (seatedFor > 0.4 && Math.hypot(axis.x, axis.y) > 0.3) sitOrStand();
    }
    player.update(dt, { x: axis.x, y: axis.y, run: controllable && input.running(), jump: controllable && jumpQueued }, rig.yaw, rig.view === 'first');
    jumpQueued = false;
    if (player.mode === 'free' && player.seat === null) mannequins.setVacant(-1);

    avatar.root.position.copy(player.position);
    avatar.root.rotation.y = player.yaw;
    avatar.update(dt, { speed: player.moveSpeed, grounded: player.grounded || player.mode !== 'free', sit: player.sit }, player.groundY);

    rig.update(dt, player);

    head.copy(player.position).y += player.sit > 0.5 ? 1.25 : PLAYER.eyeHeight;
    const near = camera.position.distanceTo(head) < 0.6;
    const seatedShot = rig.currentShot === 'seated';
    avatar.root.visible = seatedShot || !near;
    avatar.setHeadVisible(!(seatedShot && near));
    hud.setCrosshair(rig.currentShot === 'first');

    let prompt: string | null = null;
    if (controllable) {
      if (player.mode === 'free' && player.nearbyChair()) prompt = 'Sit down';
      else if (player.mode === 'seated') prompt = 'Stand up';
    }
    hud.setPrompt(prompt);
    world.update(simTime);
  };

  const frame = (now: number) => {
    timer.update(now);
    const dt = Math.min(0.05, timer.getDelta());
    if (!frozen) step(dt);
    renderer.render(scene, camera);

    if (input.enabled && !pinnedRatio) {
      frameTimeSum += dt;
      frameCount++;
      if (frameTimeSum > 2) {
        const avg = frameTimeSum / frameCount;
        if (avg > 0.0205 && ratio > 0.75) {
          ratio = Math.max(0.75, ratio - 0.15);
          calmFor = 0;
          renderer.setPixelRatio(ratio);
          world.setPixelRatio(ratio);
          resize();
        } else if (avg < 0.0175) {
          calmFor += frameTimeSum;
          if (calmFor > 8 && ratio < maxRatio) {
            ratio = Math.min(maxRatio, ratio + 0.1);
            calmFor = 0;
            renderer.setPixelRatio(ratio);
            world.setPixelRatio(ratio);
            resize();
          }
        }
        frameTimeSum = 0;
        frameCount = 0;
      }
    }
  };
  renderer.setAnimationLoop(frame);

  hud.setProgress(1, 'Ready');
  hud.ready(() => {
    input.enabled = true;
    rig.overview = false;
    input.requestPointerLock();
  });

  if (import.meta.env.DEV) {
    // Lets headless screenshot runs step the simulation at a fixed rate.
    const advance = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60);
    };
    const freeze = (on: boolean) => {
      frozen = on;
    };
    Object.assign(window, {
      council: { player, rig, input, world, mannequins, renderer, scene, camera, actions, advance, freeze, enter: () => document.getElementById('enter')?.click() },
    });
  }
}
