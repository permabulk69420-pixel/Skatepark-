import { HANDS } from './config.js';

// Turns the heights of the two hands into a push on the balance meter. Height is the physical height above the floor in play
// space, so it is the same whatever the board is doing. The difference between the hands is compared with what it was while
// you were not balancing (a slow average), so however you hold your arms at rest is "no push".
export class HandBalance {
  constructor() {
    this.rest = null;      // right − left height at rest
    this.lean = 0;
  }

  // leftY / rightY in metres, or null when a hand is not tracked. Returns −1..1 (right hand up = +).
  update(dt, leftY, rightY, balancing) {
    if (typeof leftY !== 'number' || typeof rightY !== 'number') { this.lean += (0 - this.lean) * (1 - Math.exp(-HANDS.response * dt)); return this.lean; }
    const diff = rightY - leftY;
    if (this.rest === null) this.rest = diff;
    if (!balancing) this.rest += (diff - this.rest) * (1 - Math.exp(-dt / HANDS.restTime));
    let push = diff - this.rest;
    push = Math.abs(push) > HANDS.deadzone ? (Math.abs(push) - HANDS.deadzone) * Math.sign(push) : 0;
    const target = Math.max(-1, Math.min(1, push / (HANDS.range - HANDS.deadzone)));
    this.lean += (target - this.lean) * (1 - Math.exp(-HANDS.response * dt));
    return this.lean;
  }
}
