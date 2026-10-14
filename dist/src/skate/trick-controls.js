import { TUNING as T } from './config.js';

// Tony Hawk style flip tricks: press B and push the stick. Either order works, as long as the two come within
// trickWindow of each other. The direction you pushed is the trick:
//
//              (up: nothing)
//     Kickflip  ←   ·   →  Heelflip
//   Varial Kickflip ↙ ↓ ↘ Varial Heelflip
//               Pop Shove-it
//
// Stick coordinates are the raw controller axes: left = -x, right = +x, up = -y, down = +y.

export const TRICKS = Object.freeze({
  left: Object.freeze({ name: 'Kickflip', flip: true, shuv: null }),
  right: Object.freeze({ name: 'Heelflip', flip: false, shuv: null }),
  down: Object.freeze({ name: 'Pop Shove-it', flip: null, shuv: true }),
  'down-left': Object.freeze({ name: 'Varial Kickflip', flip: true, shuv: true }),
  'down-right': Object.freeze({ name: 'Varial Heelflip', flip: false, shuv: false }),
});

// Which way a stick position points, as the angle away from straight down. Up and the upward diagonals do nothing, so the
// diagonals get the room: only a push close to straight down is a shove-it.
//   0° – 15°  down        15° – 65°  down diagonal      65° – 120°  left / right      beyond: up (unassigned)
export const stickAngle = (x, y) => Math.atan2(Math.abs(x), y) * 180 / Math.PI;   // 0 = straight down, 180 = straight up
export function stickDirection(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < T.trickStick) return 'center';
  const fromDown = stickAngle(x, y);
  const side = x < 0 ? 'left' : 'right';
  if (fromDown < 15) return 'down';
  if (fromDown < 65) return `down-${side}`;
  if (fromDown < 120) return side;
  if (fromDown < 157.5) return `up-${side}`;
  return 'up';
}

// One call per input frame. Three things are tracked, nothing else:
//   pressAge  how long ago B was pressed (Infinity when there is no live press)
//   gesture   the current push of the stick away from centre: how long it has been out, whether the thumb has stopped
//             moving, and the furthest it has reached on each axis. The furthest point on each axis is what makes diagonals reliable: a thumb that goes down
//             first and then rolls left has reached both, so it reads as down-left, not as whichever it passed first.
//   ready     a trick that has been picked and is waiting to start (you pressed B on the ground just before the ollie)
export class TrickControls {
  constructor() {
    this.held = false;
    this.pressAge = Infinity;
    this.gesture = null;
    this.ready = null;
    this.readyAge = 0;
  }

  // Forget any press and any picked trick (landing, bailing, taking the board off). The stick gesture is kept, so
  // a direction you are already holding still counts with the next press.
  reset() {
    this.pressAge = Infinity;
    this.ready = null;
    this.readyAge = 0;
  }

  // True while a press is waiting for its direction, or a trick is waiting to start. The stick belongs to the trick
  // meanwhile: no air spin, no manual, no backflip.
  get pending() { return this.live() || this.ready !== null; }

  // The press is still waiting for its direction: inside the window, or a push that started inside it is still settling.
  live() {
    if (this.pressAge === Infinity) return false;
    if (this.pressAge <= T.trickWindow) return true;
    const g = this.gesture;
    return !!g && this.pressAge - g.age <= T.trickWindow && this.pressAge <= T.trickWindow + T.trickSettleMax + 0.05;
  }

  sample(button, x, y, dt, enabled, canStart) {
    const pressed = button && !this.held;
    this.held = button;
    this.track(x, y, dt);
    if (!enabled) { this.reset(); return null; }

    if (pressed) { this.pressAge = 0; this.ready = null; }
    else if (this.pressAge !== Infinity) this.pressAge += dt;
    if (this.ready) this.readyAge += dt;

    // Pick the trick: B is live and the stick has been out long enough to have reached its direction (or has
    // already come back to centre, a quick flick).
    if (!this.ready && this.live() && this.gesture?.settled) {
      const g = this.gesture;
      // A push that has been held for a while (direction first, then B) reads where the stick is now; a fresh push
      // reads the furthest it reached on each axis.
      const long = !g.released && g.age > T.trickWindow;
      const rx = long ? g.cx : g.x, ry = long ? g.cy : g.y;
      const trick = TRICKS[stickDirection(rx, ry)];
      this.read = { x: rx, y: ry };          // what the trick was read from (shown in the HUD)
      this.pressAge = Infinity;            // one press, one trick (an upward push uses the press up and does nothing)
      if (g.released) this.gesture = null; // a remembered flick is used up
      if (trick) { this.ready = trick; this.readyAge = 0; }
    }
    if (!this.live()) this.pressAge = Infinity;

    if (!this.ready) return null;
    if (this.readyAge > T.trickWindow) { this.ready = null; return null; }   // never got off the ground in time
    if (!canStart) return null;
    const trick = this.ready;
    this.reset();
    return trick;
  }

  track(x, y, dt) {
    const ok = Number.isFinite(x) && Number.isFinite(y);
    const r = ok ? Math.hypot(x, y) : 0;
    let g = this.gesture;
    if (r < T.trickRelease) {
      // Back at centre. The push is remembered for a moment (as a flick), so B just after a flick still counts.
      if (g && !g.released) { g.released = true; g.settled = true; g.since = 0; }
      if (g) { g.since += dt; if (g.since > T.trickWindow) this.gesture = null; }
      return;
    }
    if (!g || g.released) {
      if (r < T.trickStick) { this.gesture = null; return; }   // not out far enough to start a push
      g = this.gesture = { age: 0, x: 0, y: 0, cx: 0, cy: 0, ax: x, ay: y, still: 0, settled: false, released: false, since: 0 };
    } else g.age += dt;
    if (r >= T.trickStick) {
      if (Math.abs(x) > Math.abs(g.x)) g.x = x;
      if (Math.abs(y) > Math.abs(g.y)) g.y = y;
      g.cx = x; g.cy = y;
    }
    // Still moving (rolling into a diagonal)? Then keep reading. Picked once the thumb has stopped, or after trickSettleMax.
    if (Math.abs(x - g.ax) > T.trickStillMove || Math.abs(y - g.ay) > T.trickStillMove) { g.ax = x; g.ay = y; g.still = 0; }
    else g.still += dt;
    if ((g.age >= T.trickSettle && g.still >= T.trickStill) || g.age >= T.trickSettleMax) g.settled = true;
  }
}
