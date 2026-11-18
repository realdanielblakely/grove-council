export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Approximately normal, mean 0, standard deviation 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
}
