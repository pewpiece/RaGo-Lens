/**
 * Level indicator from the accelerometer (values in g or m/s^2; only the ratios matter, so units and the sign convention of
 * the platform do not).
 *  - phone held upright: the roll angle left/right, like a horizon line;
 *  - phone held flat (shooting down at a table): how far it is from horizontal, as a bubble offset.
 */
export interface LevelReading {
  mode: 'upright' | 'flat';
  /** Upright: roll in degrees (0 = straight). Flat: tilt away from horizontal in degrees. */
  angle: number;
  /** Bubble position, -1..1 (flat mode; 0,0 = centred). */
  bubbleX: number;
  bubbleY: number;
  /** Within about 1.5 degrees. */
  level: boolean;
}

export const LEVEL_TOLERANCE_DEG = 1.5;

export function levelFromAccel(ax: number, ay: number, az: number): LevelReading {
  const g = Math.hypot(ax, ay, az);
  if (g < 1e-6) return { mode: 'upright', angle: 0, bubbleX: 0, bubbleY: 0, level: true };
  const flat = Math.abs(az) / g > 0.9;
  if (flat) {
    const tilt = (Math.acos(Math.min(1, Math.abs(az) / g)) * 180) / Math.PI;
    return {
      mode: 'flat',
      angle: tilt,
      bubbleX: Math.max(-1, Math.min(1, (ax / g) * 6)),
      bubbleY: Math.max(-1, Math.min(1, (ay / g) * 6)),
      level: tilt <= LEVEL_TOLERANCE_DEG,
    };
  }
  const roll = (Math.asin(Math.max(-1, Math.min(1, ax / g))) * 180) / Math.PI;
  return {
    mode: 'upright',
    angle: roll,
    bubbleX: 0,
    bubbleY: 0,
    level: Math.abs(roll) <= LEVEL_TOLERANCE_DEG,
  };
}

/** Standard deviation of the acceleration magnitude over the last samples: a steady hand is small, shake is large. */
export class ShakeMeter {
  private readonly buf: number[] = [];
  constructor(
    private readonly size = 8,
    /** In the same unit as the samples (g): above this it counts as shaky. */
    private readonly threshold = 0.05,
  ) {}

  push(ax: number, ay: number, az: number): void {
    this.buf.push(Math.hypot(ax, ay, az));
    if (this.buf.length > this.size) this.buf.shift();
  }

  get level(): number {
    if (this.buf.length < 3) return 0;
    const m = this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
    return Math.sqrt(this.buf.reduce((a, b) => a + (b - m) ** 2, 0) / this.buf.length);
  }

  get shaky(): boolean {
    return this.level > this.threshold;
  }
}

/** Ambient light below this (lux) is too dim for a clean cut-out. */
export const LOW_LIGHT_LUX = 40;
