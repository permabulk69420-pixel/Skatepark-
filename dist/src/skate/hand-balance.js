import { HANDS } from './config.js';

// Turns the two hands into a push on the balance meter: the tilt of the line between them, like holding a balance pole. Right
// hand up is a push right, left hand up a push left.
//
// Tilt is an angle, so it feels the same whether the hands are held close together or wide apart. It is measured against a
// "neutral" learned only while the rider is rolling relaxed on the ground (the caller says when, with `learn`): arms swinging
// through a crouch, pop or flight must not become the neutral, or the meter would start a grind already shoved to one side.
// The neutral is frozen for the length of a balance, and the push eases in so landing arm-swing does not kick the meter.
export class HandBalance {
  constructor() {
    this.rest = null;      // neutral tilt in radians
    this.lean = 0;
    this.engage = 0;       // 0..1, how far the push has eased in since the balance started
  }

  // left / right are hand positions in play space ({ x, y, z }) or null when a hand is not tracked. Returns −1..1 (right hand up = +).
  update(dt, left, right, { balancing = false, learn = true } = {}) {
    if (!left || !right) {
      this.engage = 0;
      this.lean += (0 - this.lean) * (1 - Math.exp(-HANDS.response * dt));
      return this.lean;
    }
    const spread = Math.max(HANDS.minSpread, Math.hypot(right.x - left.x, right.z - left.z));
    const tilt = Math.atan2(right.y - left.y, spread);
    if (this.rest === null) this.rest = tilt;
    if (!balancing && learn) this.rest += (tilt - this.rest) * (1 - Math.exp(-dt / HANDS.restTime));
    this.engage = balancing ? Math.min(1, this.engage + dt / HANDS.ease) : 0;
    let push = tilt - this.rest;
    push = Math.abs(push) > HANDS.deadzone ? (Math.abs(push) - HANDS.deadzone) * Math.sign(push) : 0;
    const target = Math.max(-1, Math.min(1, push / (HANDS.range - HANDS.deadzone))) * this.engage;
    this.lean += (target - this.lean) * (1 - Math.exp(-HANDS.response * dt));
    return this.lean;
  }
}
