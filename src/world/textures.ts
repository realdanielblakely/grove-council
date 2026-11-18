import * as THREE from 'three';
import { Rng } from '../utils/random';
import { Simplex, TileNoise } from '../utils/noise';
import { clamp, smoothstep, TAU } from '../utils/math';

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function colorTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function dataTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Tangent-space normal map from a wrapping height field (OpenGL convention, canvas y down). */
function normalCanvas(height: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = canvas2d(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (height[y * w + xp] - height[y * w + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      const nx = -dx;
      const ny = dy;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (nx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function leafPath(ctx: CanvasRenderingContext2D, len: number, halfWidth: number, bulge = 0.25): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(halfWidth * 1.15, -len * bulge, halfWidth * 0.85, -len * 0.78, 0, -len);
  ctx.bezierCurveTo(-halfWidth * 0.85, -len * 0.78, -halfWidth * 1.15, -len * bulge, 0, 0);
  ctx.closePath();
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

export interface FloorTextureInput {
  radius: number;
  bandRadius: number;
  inlay: { bandInner: number; bandOuter: number; lineRadius: number; lineWidth: number };
  tablePolygons: Array<Array<[number, number]>>;
  chairSpots: Array<{ x: number; z: number; r: number }>;
}

/** Stone floor of the platform, mapped so canvas (px, py) ↔ world (x, z). */
export function floorTexture(input: FloorTextureInput, size = 2048): THREE.CanvasTexture {
  const R = input.radius;
  const [c, ctx] = canvas2d(size, size);
  const ppm = size / (2 * R);
  const toPx = (v: number) => (v / R + 1) * 0.5 * size;
  const rng = new Rng(11);
  const simplex = new Simplex(rng.next);

  const base = 384;
  const [bc, bctx] = canvas2d(base, base);
  const img = bctx.createImageData(base, base);
  for (let py = 0; py < base; py++) {
    for (let px = 0; px < base; px++) {
      const x = (px / base) * 2 * R - R;
      const z = (py / base) * 2 * R - R;
      const r = Math.hypot(x, z);
      const n1 = simplex.fbm2(x * 0.16, z * 0.16, 4);
      const n2 = simplex.fbm2(x * 0.9 + 40, z * 0.9 - 13, 3);
      const l = 0.78 + n1 * 0.05 + n2 * 0.025;
      let red = 0.985 * l;
      let green = 0.995 * l;
      let blue = 0.965 * l;
      const edge = smoothstep(9.6, 12.05, r) * clamp(0.55 + 0.6 * simplex.fbm2(x * 0.5 + 7, z * 0.5 + 3, 4), 0, 1);
      const moss = clamp(0.5 + simplex.fbm2(x * 1.3, z * 1.3, 3), 0, 1);
      red = red * (1 - edge * 0.55) + edge * 0.55 * (0.36 + 0.06 * moss);
      green = green * (1 - edge * 0.55) + edge * 0.55 * (0.42 + 0.06 * moss);
      blue = blue * (1 - edge * 0.55) + edge * 0.55 * 0.27;
      const i = (py * base + px) * 4;
      img.data[i] = clamp(red, 0, 1) * 255;
      img.data[i + 1] = clamp(green, 0, 1) * 255;
      img.data[i + 2] = clamp(blue, 0, 1) * 255;
      img.data[i + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bc, 0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const sector = (r0: number, r1: number, a0: number, a1: number) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r1 * ppm, a0, a1);
    ctx.arc(cx, cy, r0 * ppm, a1, a0, true);
    ctx.closePath();
  };

  // Concentric tile courses; the rings under the table are never seen.
  const courses: Array<[number, number]> = [
    [0, 1.25], [1.25, 2.46], [2.54, 3.62], [4.08, 4.6], [4.6, 7.15],
    [7.15, 8.6], [8.6, 9.95], [9.95, 11.2], [11.2, 12],
  ];
  courses.forEach(([r0, r1], ci) => {
    const mid = (r0 + r1) / 2;
    const count = r0 === 0 ? 1 : Math.max(6, Math.round((TAU * mid) / 1.25 / 2) * 2);
    const offset = ci % 2 === 0 ? 0 : Math.PI / count;
    for (let k = 0; k < count; k++) {
      const a0 = offset + (k / count) * TAU;
      const a1 = offset + ((k + 1) / count) * TAU;
      const shade = rng.range(-1, 1);
      ctx.fillStyle = shade > 0 ? `rgba(255,255,250,${0.045 * shade})` : `rgba(30,34,28,${-0.05 * shade})`;
      if (r0 === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r1 * ppm, 0, TAU);
        ctx.fill();
      } else {
        sector(r0, r1, a0, a1);
        ctx.fill();
      }
      if (count > 1 && r1 < 11.25) {
        const ca = Math.cos(a0);
        const sa = Math.sin(a0);
        ctx.strokeStyle = 'rgba(78,80,74,0.5)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx + ca * r0 * ppm, cy + sa * r0 * ppm);
        ctx.lineTo(cx + ca * r1 * ppm, cy + sa * r1 * ppm);
        ctx.stroke();
      }
    }
  });
  const ring = (r: number, width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r * ppm, 0, TAU);
    ctx.stroke();
  };
  for (const [r0] of courses) {
    if (r0 <= 0) continue;
    ring(r0, 2.4, 'rgba(78,80,74,0.5)');
    ring(r0 + 0.025, 1.2, 'rgba(255,255,250,0.16)');
  }

  // Thin outer ring band.
  sector(input.bandRadius, R, 0, TAU);
  ctx.fillStyle = 'rgba(70,82,66,0.1)';
  ctx.fill();
  ring(input.bandRadius, 0.075 * ppm, 'rgba(58,60,55,0.82)');
  ring(input.bandRadius + 0.16, 0.025 * ppm, 'rgba(58,60,55,0.5)');
  ring(R - 0.035, 0.05 * ppm, 'rgba(46,50,42,0.7)');

  // Recessed seat for the gold inlay.
  const { inlay } = input;
  ring(inlay.bandInner - 0.015, 0.05 * ppm, 'rgba(40,36,26,0.7)');
  ring(inlay.bandOuter + 0.015, 0.05 * ppm, 'rgba(40,36,26,0.7)');
  ring(inlay.lineRadius, (inlay.lineWidth + 0.04) * ppm, 'rgba(40,36,26,0.55)');

  // Soft contact shadows where the slabs and pedestals meet the floor.
  ctx.save();
  ctx.shadowColor = 'rgba(18,22,16,0.65)';
  ctx.shadowBlur = 0.34 * ppm;
  ctx.fillStyle = 'rgba(40,44,38,1)';
  for (const poly of input.tablePolygons) {
    ctx.beginPath();
    poly.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(toPx(x), toPx(z)) : ctx.lineTo(toPx(x), toPx(z))));
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0.3 * ppm;
  ctx.shadowColor = 'rgba(18,22,16,0.55)';
  for (const s of input.chairSpots) {
    ctx.beginPath();
    ctx.arc(toPx(s.x), toPx(s.z), s.r * ppm, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Fine grain.
  const [gc, gctx] = canvas2d(128, 128);
  const gimg = gctx.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = rng.next();
    const dark = v < 0.5;
    gimg.data[i * 4] = dark ? 40 : 255;
    gimg.data[i * 4 + 1] = dark ? 42 : 255;
    gimg.data[i * 4 + 2] = dark ? 38 : 250;
    gimg.data[i * 4 + 3] = Math.abs(v - 0.5) * 2 * 30;
  }
  gctx.putImageData(gimg, 0, 0);
  const pattern = ctx.createPattern(gc, 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = colorTexture(c);
  tex.anisotropy = 12;
  return tex;
}

/** Fibrous, lichen-flecked bark that tiles in both directions. */
export function barkTextures(size = 512): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const rng = new Rng(23);
  const tn = new TileNoise(rng.next);
  const tn2 = new TileNoise(rng.next);
  const height = new Float32Array(size * size);
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const warp = tn2.fbm(u, v, 4, 4, 3) * 0.08;
      const fibers = 1 - Math.abs(tn.fbm(u + warp, v, 18, 3, 4));
      const fine = tn.fbm(u, v, 64, 8, 2);
      const blot = tn2.fbm(u, v, 6, 6, 4);
      const h = fibers * 0.7 + fine * 0.15 + blot * 0.25;
      height[y * size + x] = h;
      const lichen = smoothstep(0.15, 0.55, tn2.fbm(u + 0.37, v + 0.11, 5, 5, 4));
      const shade = clamp(0.25 + h * 0.75, 0, 1);
      let r = 0.17 + shade * 0.3;
      let g = 0.15 + shade * 0.26;
      let b = 0.12 + shade * 0.2;
      r = r * (1 - lichen * 0.55) + lichen * 0.55 * (0.4 + shade * 0.15);
      g = g * (1 - lichen * 0.55) + lichen * 0.55 * (0.45 + shade * 0.17);
      b = b * (1 - lichen * 0.55) + lichen * 0.55 * (0.33 + shade * 0.1);
      const i = (y * size + x) * 4;
      img.data[i] = r * 255;
      img.data[i + 1] = g * 255;
      img.data[i + 2] = b * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    map: colorTexture(c, true),
    normalMap: dataTexture(normalCanvas(height, size, size, 9), true),
  };
}

/** Leaf litter and dark soil, tiling roughly every 4 m. */
export function groundTextures(size = 512): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const rng = new Rng(31);
  const tn = new TileNoise(rng.next);
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = tn.fbm(x / size, y / size, 8, 8, 5);
      const i = (y * size + x) * 4;
      const l = 0.5 + n * 0.5;
      img.data[i] = (0.19 + l * 0.1) * 255;
      img.data[i + 1] = (0.18 + l * 0.11) * 255;
      img.data[i + 2] = (0.11 + l * 0.05) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const wrapped = (x: number, y: number, draw: () => void) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox < -60 || x + ox > size + 60 || y + oy < -60 || y + oy > size + 60) continue;
        ctx.save();
        ctx.translate(x + ox, y + oy);
        draw();
        ctx.restore();
      }
    }
  };

  for (let i = 0; i < 520; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(10, 26);
    const w = len * rng.range(0.22, 0.4);
    const rot = rng.range(0, TAU);
    const hue = rng.next() < 0.3 ? rng.range(62, 96) : rng.range(28, 52);
    const light = rng.range(0.18, 0.38);
    wrapped(x, y, () => {
      ctx.rotate(rot);
      leafPath(ctx, len, w);
      ctx.fillStyle = hsl(hue, rng.range(0.35, 0.6), light, 0.92);
      ctx.fill();
      ctx.strokeStyle = hsl(hue, 0.4, light * 0.6, 0.6);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });
  }
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(14, 40);
    const rot = rng.range(0, TAU);
    wrapped(x, y, () => {
      ctx.rotate(rot);
      ctx.strokeStyle = hsl(28, 0.3, rng.range(0.12, 0.24), 0.9);
      ctx.lineWidth = rng.range(1, 2.2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.5, rng.range(-4, 4), len, rng.range(-3, 3));
      ctx.stroke();
    });
  }

  const data = ctx.getImageData(0, 0, size, size).data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    height[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / (3 * 255);
  }
  return {
    map: colorTexture(c, true),
    normalMap: dataTexture(normalCanvas(height, size, size, 3), true),
  };
}

/** A spray of broad tropical leaves with alpha, for canopy cards. */
export function leafClusterTexture(size = 512): THREE.CanvasTexture {
  const rng = new Rng(41);
  const [c, ctx] = canvas2d(size, size);
  const leaves = 15;
  for (let i = 0; i < leaves; i++) {
    const t = i / (leaves - 1);
    const angle = (t - 0.5) * 2.6 + rng.range(-0.12, 0.12);
    const len = size * rng.range(0.36, 0.5) * (1 - Math.abs(t - 0.5) * 0.35);
    const w = len * rng.range(0.2, 0.28);
    const hue = rng.range(88, 112);
    const light = rng.range(0.22, 0.36);
    ctx.save();
    ctx.translate(size / 2 + rng.range(-12, 12), size * 0.93);
    ctx.rotate(angle);
    leafPath(ctx, len, w, 0.3);
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, hsl(hue, 0.5, light * 0.65));
    grad.addColorStop(0.6, hsl(hue, 0.55, light));
    grad.addColorStop(1, hsl(hue - 8, 0.6, light * 1.25));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = hsl(hue, 0.45, light * 1.6, 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len * 0.96);
    ctx.stroke();
    ctx.restore();
  }
  return colorTexture(c);
}

/** A single fern frond along the texture's vertical axis, base at the bottom. */
export function fernTexture(w = 256, h = 1024): THREE.CanvasTexture {
  const rng = new Rng(53);
  const [c, ctx] = canvas2d(w, h);
  const cx = w / 2;
  ctx.strokeStyle = hsl(95, 0.35, 0.22);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, h);
  ctx.lineTo(cx, 12);
  ctx.stroke();
  for (let y = h - 40; y > 24; y -= 15) {
    const t = 1 - y / h;
    const len = (w * 0.47) * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.92 + 0.12) * (1 - t * 0.35);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx, y);
      ctx.rotate(side * (Math.PI / 2 - 0.5));
      leafPath(ctx, len, Math.max(3, len * 0.16), 0.35);
      ctx.fillStyle = hsl(rng.range(92, 108), 0.5, rng.range(0.24, 0.34));
      ctx.fill();
      ctx.restore();
    }
  }
  return colorTexture(c);
}

/** A large heart-shaped understory leaf with pale veins. */
export function broadLeafTexture(size = 512): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(size, size);
  const cx = size / 2;
  const base = size * 0.96;
  const len = size * 0.9;
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.bezierCurveTo(cx + size * 0.62, base - len * 0.05, cx + size * 0.4, base - len * 0.8, cx, base - len);
  ctx.bezierCurveTo(cx - size * 0.4, base - len * 0.8, cx - size * 0.62, base - len * 0.05, cx, base);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, base, 0, base - len);
  grad.addColorStop(0, hsl(100, 0.45, 0.2));
  grad.addColorStop(1, hsl(92, 0.5, 0.33));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = hsl(85, 0.4, 0.45, 0.55);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.lineTo(cx, base - len);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  for (let i = 1; i < 9; i++) {
    const y = base - (len * i) / 9.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(cx + side * size * 0.16, y - size * 0.04, cx + side * size * 0.36, y - size * 0.16);
      ctx.stroke();
    }
  }
  ctx.restore();
  return colorTexture(c);
}

/** Tufts of grass blades with alpha. */
export function grassTexture(size = 256): THREE.CanvasTexture {
  const rng = new Rng(67);
  const [c, ctx] = canvas2d(size, size);
  for (let i = 0; i < 46; i++) {
    const x = rng.range(size * 0.15, size * 0.85);
    const hgt = rng.range(size * 0.45, size * 0.95);
    const bend = rng.range(-size * 0.25, size * 0.25);
    ctx.strokeStyle = hsl(rng.range(80, 105), 0.45, rng.range(0.2, 0.38));
    ctx.lineWidth = rng.range(2.5, 5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + bend * 0.2, size - hgt * 0.6, x + bend, size - hgt);
    ctx.stroke();
  }
  return colorTexture(c);
}

/**
 * Light cookie for the sun: open, softly broken light over the clearing and
 * scattered sun flecks under the surrounding canopy.
 */
export function goboTexture(size = 512): THREE.CanvasTexture {
  const rng = new Rng(79);
  const [sharp, ctx] = canvas2d(size, size);
  const cx = size / 2;
  ctx.fillStyle = '#fff1d6';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, TAU);
    const rr = Math.sqrt(rng.next()) * size * 0.7;
    const edge = smoothstep(size * 0.16, size * 0.42, rr);
    const x = cx + Math.cos(a) * rr;
    const y = cx + Math.sin(a) * rr;
    const r = rng.range(16, 44);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(24, 34, 16, ${0.22 + edge * 0.35})`);
    g.addColorStop(1, 'rgba(24, 34, 16, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  for (let i = 0; i < 3200; i++) {
    const a = rng.range(0, TAU);
    const rr = Math.sqrt(rng.next()) * size * 0.72;
    const edge = smoothstep(size * 0.16, size * 0.44, rr);
    if (rng.next() > 0.3 + edge * 0.7) continue;
    const len = rng.range(12, 34) * (0.7 + edge * 0.6);
    ctx.save();
    ctx.translate(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr);
    ctx.rotate(rng.range(0, TAU));
    leafPath(ctx, len, len * 0.3);
    ctx.fillStyle = `rgba(12, 20, 9, ${0.42 + edge * 0.5})`;
    ctx.fill();
    ctx.restore();
  }

  const vignette = ctx.createRadialGradient(cx, cx, size * 0.3, cx, cx, size * 0.5);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(6,12,6,0.75)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 180; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(size * 0.34, size * 0.5);
    ctx.fillStyle = `rgba(255, 236, 196, ${rng.range(0.35, 0.8)})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, rng.range(2, 7), 0, TAU);
    ctx.fill();
  }

  const [c, out] = canvas2d(size, size);
  out.filter = 'blur(3px)';
  out.drawImage(sharp, 0, 0);
  return colorTexture(c);
}

export function softDotTexture(size = 64): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return colorTexture(c);
}

/** Subtle mottling for the white stone slabs. */
export function stoneTexture(size = 256): THREE.CanvasTexture {
  const rng = new Rng(97);
  const tn = new TileNoise(rng.next);
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = tn.fbm(x / size, y / size, 4, 4, 5);
      const l = 0.93 + n * 0.06;
      const i = (y * size + x) * 4;
      img.data[i] = l * 255;
      img.data[i + 1] = l * 255;
      img.data[i + 2] = (l - 0.01) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return colorTexture(c, true);
}
