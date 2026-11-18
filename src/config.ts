/**
 * Layout of the chamber, in meters. The origin is the center of the platform,
 * +Y is up. Polar angles are measured from +X toward +Z, so a point at angle a
 * and radius r sits at (r cos a, y, r sin a).
 */

export const PLATFORM = {
  radius: 12,
  height: 0.2,
  /** Where the thin outer ring band begins. */
  bandRadius: 11.2,
};

export const INLAY = {
  bandInner: 3.62,
  bandOuter: 4.08,
  lineRadius: 2.5,
  lineWidth: 0.07,
};

export const TABLE = {
  innerRadius: 4.6,
  outerRadius: 7.15,
  height: 0.72,
  segments: 4,
  /** Parallel-sided gaps between slabs, wide enough to walk through. */
  gapWidth: 1.7,
  /** Gap centers sit on the diagonals, so the slabs face the four cardinal directions. */
  firstGapAngle: Math.PI / 4,
};

export type ChairVariant = 'egg' | 'petal' | 'throne';

export const CHAIRS = {
  count: 12,
  radius: 7.95,
  firstAngle: 0,
  /** Variant per seat index; seat k sits at angle k * 30°. */
  variants: [
    'egg', 'throne', 'egg', 'petal', 'egg', 'throne',
    'egg', 'petal', 'egg', 'throne', 'egg', 'petal',
  ] as ChairVariant[],
};

export const WORLD = {
  /** The player cannot leave this circle; the jungle beyond is scenery. */
  walkRadius: 21.5,
  seed: 7,
};

export const PLAYER = {
  radius: 0.3,
  eyeHeight: 1.62,
  walkSpeed: 3.0,
  runSpeed: 6.4,
  jumpSpeed: 6.0,
  gravity: 19,
  stepHeight: 0.32,
  /** How far beyond a chair's footprint the player can be and still sit down. */
  sitReach: 0.95,
  /** Spawn on the diagonal, lined up with a table gap, facing the center. */
  spawnAngle: Math.PI / 4,
  spawnRadius: 14.6,
};

export const SUN = {
  /** Direction pointing from the scene toward the sun. */
  direction: [0.13, 0.9, 0.41] as [number, number, number],
  distance: 62,
};
