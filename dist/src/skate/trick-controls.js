import { TUNING as T } from './config.js';

// Flip tricks: press B and push the left stick, in either order. The trick fires the instant both are there.
//
//      up-left    up    up-right        (the three upward directions do nothing)
//        left     ·     right           Kickflip / Heelflip
//   down-left   down   down-right       Varial Kickflip / Pop Shove-it / Varial Heelflip
//
// Eight equal 45° directions. Stick coordinates are the raw controller axes: left = -x, right = +x, up = -y, down = +y.

export const TRICKS = Object.freeze({
  left: Object.freeze({ name: 'Kickflip', flip: true, shuv: null }),
  right: Object.freeze({ name: 'Heelflip', flip: false, shuv: null }),
  down: Object.freeze({ name: 'Pop Shove-it', flip: null, shuv: true }),
  'down-left': Object.freeze({ name: 'Varial Kickflip', flip: true, shuv: true }),
  'down-right': Object.freeze({ name: 'Varial Heelflip', flip: false, shuv: false }),
});

export const stickAngle = (x, y) => Math.atan2(Math.abs(x), y) * 180 / Math.PI;   // 0 = straight down, 180 = straight up

export function stickDirection(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < T.trickStick) return 'center';
  const a = stickAngle(x, y), side = x < 0 ? 'left' : 'right';
  if (a < 22.5) return 'down';
  if (a < 67.5) return `down-${side}`;
  if (a < 112.5) return side;
  if (a < 157.5) return `up-${side}`;
  return 'up';
}

export class TrickControls {
  constructor() {
    this.held = false;       // B down last frame
    this.pressAge = Infinity; // time since B was pressed, while it is waiting for a direction
    this.last = null;         // the last stick direction pushed: { x, y, age since the stick came back to centre }
    this.ready = null;        // a trick picked on the ground, waiting for the board to leave it
    this.readyAge = 0;
  }

  reset() {
    this.pressAge = Infinity;
    this.ready = null;
    this.readyAge = 0;
  }

  get pending() { return this.pressAge <= T.trickWindow || this.ready !== null; }

  sample(button, x, y, dt, enabled, canStart) {
    const pressed = button && !this.held;
    this.held = button;

    const out = stickDirection(x, y) !== 'center';
    if (out) this.last = { x, y, age: 0 };
    else if (this.last) { this.last.age += dt; if (this.last.age > T.trickWindow) this.last = null; }

    if (!enabled) { this.reset(); return null; }
    if (pressed) { this.pressAge = 0; this.ready = null; }
    else if (this.pressAge !== Infinity) this.pressAge += dt;
    if (this.pressAge > T.trickWindow) this.pressAge = Infinity;

    // B is live and there is a direction: now if the stick is pushed, or the push you just let go of.
    if (!this.ready && this.pressAge !== Infinity && this.last) {
      const trick = TRICKS[stickDirection(this.last.x, this.last.y)];
      this.pressAge = Infinity;   // one press, one trick (an upward direction uses it up and does nothing)
      this.last = null;
      if (trick) { this.ready = trick; this.readyAge = 0; }
    }

    if (!this.ready) return null;
    this.readyAge += dt;
    if (this.readyAge > T.trickWindow) { this.ready = null; return null; }   // pressed on the ground and never left it
    if (!canStart) return null;
    const trick = this.ready;
    this.reset();
    return trick;
  }
}
