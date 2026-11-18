import type { Vector3 } from 'three';

/**
 * Colliders are 2D footprints on the XZ plane extruded from the ground up to
 * `top`. Anything with a top below the player's feet plus step height can be
 * stood on instead of blocking.
 */
interface CircleCollider {
  type: 'circle';
  x: number;
  z: number;
  r: number;
  top: number;
}

interface PolygonCollider {
  type: 'poly';
  xs: Float64Array;
  zs: Float64Array;
  top: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type Collider = CircleCollider | PolygonCollider;

export interface Point2 {
  x: number;
  z: number;
}

const closest = { x: 0, z: 0, dist: 0, inside: false };

function polygonClosest(c: PolygonCollider, px: number, pz: number) {
  const { xs, zs } = c;
  const n = xs.length;
  let inside = false;
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = xs[j];
    const az = zs[j];
    const ex = xs[i];
    const ez = zs[i];
    if (ez > pz !== az > pz && px < ((ax - ex) * (pz - ez)) / (az - ez) + ex) inside = !inside;
    const dx = ex - ax;
    const dz = ez - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const d2 = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
    if (d2 < best) {
      best = d2;
      bx = qx;
      bz = qz;
    }
  }
  closest.x = bx;
  closest.z = bz;
  closest.dist = Math.sqrt(best);
  closest.inside = inside;
  return closest;
}

export class CollisionWorld {
  private readonly colliders: Collider[] = [];
  boundaryRadius = Infinity;
  /** Terrain height (including the platform) without any colliders. */
  groundFn: (x: number, z: number) => number = () => 0;

  addCircle(x: number, z: number, r: number, top = Infinity): void {
    this.colliders.push({ type: 'circle', x, z, r, top });
  }

  addPolygon(points: ReadonlyArray<readonly [number, number]>, top = Infinity): void {
    const xs = new Float64Array(points.length);
    const zs = new Float64Array(points.length);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    points.forEach(([x, z], i) => {
      xs[i] = x;
      zs[i] = z;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });
    this.colliders.push({ type: 'poly', xs, zs, top, minX, maxX, minZ, maxZ });
  }

  /** Pushes a circle of `radius` at `p` out of every collider it cannot step onto. */
  resolve(p: Point2, radius: number, feetY: number, step: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const c of this.colliders) {
        if (c.top <= feetY + step) continue;
        if (c.type === 'circle') {
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          const min = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min) {
            const d = Math.sqrt(d2) || 1e-6;
            const k = (min - d) / d;
            p.x += dx * k;
            p.z += dz * k;
            moved = true;
          }
        } else {
          if (p.x < c.minX - radius || p.x > c.maxX + radius || p.z < c.minZ - radius || p.z > c.maxZ + radius) continue;
          const q = polygonClosest(c, p.x, p.z);
          if (q.inside) {
            const dx = q.x - p.x;
            const dz = q.z - p.z;
            const d = Math.hypot(dx, dz) || 1e-6;
            p.x = q.x + (dx / d) * radius;
            p.z = q.z + (dz / d) * radius;
            moved = true;
          } else if (q.dist < radius) {
            const d = q.dist || 1e-6;
            p.x = q.x + ((p.x - q.x) / d) * radius;
            p.z = q.z + ((p.z - q.z) / d) * radius;
            moved = true;
          }
        }
      }
      const r = Math.hypot(p.x, p.z);
      const limit = this.boundaryRadius - radius;
      if (r > limit) {
        p.x *= limit / r;
        p.z *= limit / r;
        moved = true;
      }
      hit ||= moved;
      if (!moved) break;
    }
    return hit;
  }

  /** Highest surface under (x, z) that a player whose feet are at `feetY` can stand on. */
  groundAt(x: number, z: number, feetY: number, step: number): number {
    let h = this.groundFn(x, z);
    for (const c of this.colliders) {
      if (c.top > feetY + step || c.top <= h) continue;
      if (c.type === 'circle') {
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) h = c.top;
      } else if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && polygonClosest(c, x, z).inside) {
        h = c.top;
      }
    }
    return h;
  }

  /** True if a sphere of `pad` at the point would touch terrain or a collider. */
  blocked(x: number, y: number, z: number, pad: number): boolean {
    if (y < this.groundFn(x, z) + pad) return true;
    for (const c of this.colliders) {
      if (y > c.top + pad) continue;
      if (c.type === 'circle') {
        const r = c.r + pad;
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < r * r) return true;
      } else {
        if (x < c.minX - pad || x > c.maxX + pad || z < c.minZ - pad || z > c.maxZ + pad) continue;
        const q = polygonClosest(c, x, z);
        if (q.inside || q.dist < pad) return true;
      }
    }
    return false;
  }

  /** Fraction along a→b that is free of obstacles, for pulling the camera in. */
  sweep(a: Vector3, b: Vector3, pad: number): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return 1;
    const steps = Math.ceil(len / 0.1);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.blocked(a.x + dx * t, a.y + dy * t, a.z + dz * t, pad)) return (i - 1) / steps;
    }
    return 1;
  }
}
