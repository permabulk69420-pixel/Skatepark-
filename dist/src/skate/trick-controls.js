import { TUNING as T } from './config.js';

// Controller coordinates throughout this module: left = -x, right = +x,
// up = -y, down = +y. Each of the eight directions has the same width.
const DIAGONAL_RATIO = Math.SQRT2 - 1; // tan(22.5 degrees)
export const TRICKS = Object.freeze({
  left: Object.freeze({ name: 'Kickflip', flip: true, shuv: null }),
  right: Object.freeze({ name: 'Heelflip', flip: false, shuv: null }),
  down: Object.freeze({ name: 'Pop Shove-it', flip: null, shuv: true }),
  'down-left': Object.freeze({ name: 'Varial Kickflip', flip: true, shuv: true }),
  'down-right': Object.freeze({ name: 'Varial Heelflip', flip: false, shuv: false }),
});

export function stickDirection(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < T.trickStick) return 'center';
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ay <= ax * DIAGONAL_RATIO) return x < 0 ? 'left' : 'right';
  if (ax <= ay * DIAGONAL_RATIO) return y < 0 ? 'up' : 'down';
  return `${y < 0 ? 'up' : 'down'}-${x < 0 ? 'left' : 'right'}`;
}

// One sample per input frame, independent of physics substeps. A B press arms
// one attempt. Collect the thumb movement, then latch one explicit direction.
// Holding B cannot repeat a trick; up consumes the attempt without a trick.
export class TrickControls {
  constructor() {
    this.held = false;
    this.reset();
  }

  reset() {
    this.phase = 'idle';
    this.window = 0;
    this.elapsed = 0;
    this.quiet = 0;
    this.direction = 'center';
    this.anchorX = 0;
    this.anchorY = 0;
  }

  get pending() { return this.phase !== 'idle'; }

  sample(button, x, y, dt, enabled, canStart) {
    const pressed = button && !this.held;
    this.held = button;
    if (!enabled) { this.reset(); return null; }
    if (pressed) {
      this.reset();
      this.phase = 'armed';
      this.window = T.trickButtonWindow;
    }
    if (!this.pending) return null;
    if (!pressed) this.window -= dt;
    if (this.phase !== 'selecting' && this.window < 0) { this.reset(); return null; }

    const direction = stickDirection(x, y);
    if (this.phase === 'armed' && direction !== 'center') {
      this.phase = 'selecting';
      this.direction = direction;
      this.anchorX = x;
      this.anchorY = y;
      return null; // this sample starts the gesture; the preceding frame was not a hold
    }
    if (this.phase === 'selecting') {
      this.elapsed += dt;
      if (direction !== 'center') {
        if (direction !== this.direction || Math.abs(x - this.anchorX) > T.trickMoveTolerance || Math.abs(y - this.anchorY) > T.trickMoveTolerance) {
          this.quiet = 0;
          this.anchorX = x;
          this.anchorY = y;
        } else this.quiet += dt;
        this.direction = direction;
      }
      // Returning to centre ends a flick. Keep its last direction, not the
      // centre reading. A moving thumb gets a bounded window to finish.
      if (this.elapsed >= T.trickChooseDelay && (direction === 'center' || this.quiet >= T.trickHoldTime || this.elapsed >= T.trickChooseLimit)) {
        if (!TRICKS[this.direction]) { this.reset(); return null; }
        this.phase = 'ready';
      }
    }
    if (this.phase !== 'ready' || !canStart) return null;
    const trick = TRICKS[this.direction];
    this.reset();
    return trick;
  }
}
