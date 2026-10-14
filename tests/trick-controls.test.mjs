import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../dist/src/skate/input.js';
import { Mode } from '../dist/src/skate/sim.js';
import { makeSkater, run } from './helpers.mjs';

function controllers(t, axes = [0, 0, 0, 0]) {
  const previous = globalThis.addEventListener;
  globalThis.addEventListener = () => {};
  t.after(() => {
    if (previous) globalThis.addEventListener = previous;
    else delete globalThis.addEventListener;
  });
  const buttons = () => Array.from({ length: 6 }, () => ({ pressed: false }));
  const left = { handedness: 'left', gamepad: { axes, buttons: buttons() } };
  const right = { handedness: 'right', gamepad: { axes: [0, 0, 1, -1], buttons: buttons() } };
  const session = { inputSources: [right, left] };
  const xr = { isPresenting: true, getSession: () => session };
  const input = createInput({ xr });
  return { input, left, right, session, xr };
}

function flight(events) {
  const s = makeSkater({ events });
  s.pos.set(0, 5, 0);
  s.vel.set(0, 0, -4);
  s.mode = Mode.AIR;
  s.airTime = 0.1;
  return s;
}
const starts = (events) => events.filter((e) => e.type === 'flipStart').map((e) => e.data.name);

test('actual Quest axes and B button select all five tricks; all upward directions stay unassigned at 72/90/120 Hz', (t) => {
  const { input, left, right } = controllers(t);
  for (const hz of [72, 90, 120]) {
    for (const [x, y, expected] of [
      [-1, 0, 'Kickflip'], [1, 0, 'Heelflip'], [0, 1, 'Pop Shove-it'],
      [-0.5, 0.5, 'Varial Kickflip'], [0.5, 0.5, 'Varial Heelflip'],
      [0, -1, null], [-0.5, -0.5, null], [0.5, -0.5, null], [0, 0, null],
    ]) {
      const events = [], s = flight(events);
      left.gamepad.axes = [1, -1, x, y]; // unused touchpad axes must never pick a trick
      right.gamepad.buttons[5].pressed = true;
      run(s, () => input.poll(1 / hz), 0.25, 1 / hz);
      assert.deepEqual(starts(events), expected ? [expected] : [], `(${x}, ${y}) at ${hz} Hz`);
      if (expected?.startsWith('Varial')) assert.ok(s.flip && s.shuv, 'varial lost one of its two rotations');
    }
  }
});

test('XR trick direction ignores keyboard state, right stick and left face buttons, and clears on controller loss', (t) => {
  const { input, left, right, session } = controllers(t);
  input.keys.add('KeyD'); input.keys.add('KeyW'); input.keys.add('KeyF');
  left.gamepad.axes = [0, 0, -0.42, 0.85];
  left.gamepad.buttons[5].pressed = true;
  assert.equal(input.poll(1 / 72).flip, false, 'left Y or keyboard F acted as right B');
  right.gamepad.buttons[5].pressed = true;
  const command = input.poll(1 / 72);
  assert.deepEqual(command.trickStick, { x: -0.42, y: 0.85 });
  const events = [], s = flight(events);
  run(s, () => input.poll(1 / 72), 0.25);
  assert.deepEqual(starts(events), ['Varial Kickflip']);
  session.inputSources = [right];
  assert.deepEqual(input.poll(1 / 72).trickStick, { x: 0, y: 0 }, 'disconnected controller left a stale direction');
});

test('down-first and side-first movements choose the final diagonal symmetrically at different frame rates', (t) => {
  const { input, left, right } = controllers(t);
  for (const hz of [72, 90, 120]) {
    for (const side of [-1, 1]) {
      for (const fromDown of [true, false]) {
        const events = [], s = flight(events);
        right.gamepad.buttons[5].pressed = true;
        run(s, (time) => {
          const p = Math.max(0, Math.min(1, (time - 0.028) / 0.12));
          left.gamepad.axes = fromDown
            ? [0, 0, side * 0.8 * p, 1 - 0.2 * p]
            : [0, 0, side * (1 - 0.2 * p), 0.8 * p];
          return input.poll(1 / hz);
        }, 0.3, 1 / hz);
        assert.deepEqual(starts(events), [side < 0 ? 'Varial Kickflip' : 'Varial Heelflip'], `${hz} Hz, ${side}, fromDown=${fromDown}`);
      }
    }
  }
});

test('one B press creates one trick, including when held through landing; a new press can select the opposite trick', () => {
  const events = [], s = flight(events);
  run(s, { flip: true, trickStick: { x: -1, y: 0 } }, 0.65);
  s.land({ hasNormal: true, normal: s.groundNormal });
  assert.equal(s.mode, Mode.GROUND);
  s.mode = Mode.AIR; s.pos.y = 5; s.airTime = 0.1;
  run(s, { flip: true, trickStick: { x: 1, y: 0 } }, 0.25);
  assert.deepEqual(starts(events), ['Kickflip']);
  run(s, {}, 0.02);
  run(s, { flip: true, trickStick: { x: 1, y: 0 } }, 0.15);
  assert.deepEqual(starts(events), ['Kickflip', 'Heelflip']);
});

test('B before the direction, direction before B, and a short released diagonal all select the same trick', () => {
  for (const order of ['button-first', 'direction-first', 'released-flick']) {
    const events = [], s = flight(events), stick = { x: -0.6, y: 0.6 };
    if (order === 'button-first') run(s, { flip: true }, 0.08);
    if (order === 'direction-first') run(s, { trickStick: stick }, 0.08);
    run(s, { flip: true, trickStick: stick }, order === 'released-flick' ? 0.04 : 0.15);
    if (order === 'released-flick') run(s, {}, 0.15);
    assert.deepEqual(starts(events), ['Varial Kickflip'], order);
  }
});

test('an upward attempt is consumed and cannot turn into a kickflip while B stays held', (t) => {
  const { input, left, right } = controllers(t);
  const events = [], s = flight(events);
  right.gamepad.buttons[5].pressed = true;
  left.gamepad.axes = [0, 0, -0.65, -0.12];
  run(s, () => input.poll(1 / 72), 0.028);
  left.gamepad.axes = [0, 0, -0.45, -0.75];
  run(s, () => input.poll(1 / 72), 0.028);
  left.gamepad.axes = [0, 0, 0, -1];
  run(s, () => input.poll(1 / 72), 0.2);
  left.gamepad.axes = [0, 0, -1, 0];
  run(s, () => input.poll(1 / 72), 0.2);
  assert.deepEqual(starts(events), []);
});

test('two-axis controllers, keyboard diagonals, and desktop overrides use the same coordinates', (t) => {
  const { input, xr, left } = controllers(t, [-0.5, 0.5]);
  assert.deepEqual(input.poll(1 / 72).trickStick, { x: -0.5, y: 0.5 });
  left.gamepad.axes = [NaN, Infinity];
  assert.deepEqual(input.poll(1 / 72).trickStick, { x: 0, y: 0 });
  xr.isPresenting = false;
  input.keys.add('KeyA'); input.keys.add('KeyS'); input.keys.add('KeyF');
  assert.deepEqual(input.poll(1 / 72).trickStick, { x: -1, y: 1 });
  input.keys.clear();
  Object.assign(input.override, { steer: 0.5, drive: -0.5, flip: true });
  const events = [], s = flight(events);
  run(s, () => input.poll(1 / 72), 0.2);
  assert.deepEqual(starts(events), ['Varial Heelflip']);
  input.override.trickStick = { x: -0.5, y: 0.5 };
  input.poll(1 / 72); input.poll(1 / 72);
  assert.deepEqual(input.override.trickStick, { x: -0.5, y: 0.5 }, 'poll mutated the explicit override');
  delete input.override.trickStick;
  assert.deepEqual(input.poll(1 / 72).trickStick, { x: 0.5, y: 0.5 });
});

test('a slow first frame cannot count as a settled direction before the next controller sample', () => {
  const events = [], s = flight(events);
  s.update({ flip: true, trickStick: { x: 0, y: 1 } }, 0.12);
  assert.deepEqual(starts(events), []);
  run(s, { flip: true, trickStick: { x: -0.7, y: 0.7 } }, 0.15);
  assert.deepEqual(starts(events), ['Varial Kickflip']);
});

// Tony Hawk style, the way it is played in the headset: tap (or hold) B, then push the stick a moment later.
// Thumb paths are angles away from straight down (+ = left), reaching the rim over ~50 ms like a real thumb.
test('B first, then the stick: every direction, realistic thumbs, reaction times up to 0.35 s, 72/90/120 Hz', (t) => {
  const { input, left, right } = controllers(t);
  const at = (deg, m = 1) => [-Math.sin(deg * Math.PI / 180) * m, Math.cos(deg * Math.PI / 180) * m];
  const lerp = (a, b, u) => a + (b - a) * Math.max(0, Math.min(1, u));
  const paths = {
    'straight push': (deg) => (s) => at(deg, Math.min(1, s / 0.05)),
    'sloppy (15° off)': (deg) => (s) => at(deg + (deg > 0 ? -15 : deg < 0 ? 15 : 0) * (Math.abs(deg) > 30 && Math.abs(deg) < 60 ? 1 : 0), Math.min(1, s / 0.05)),
    'down first, then rolls over': (deg) => (s) => s < 0.04 ? at(deg / 6, s / 0.04) : at(lerp(deg / 6, deg, (s - 0.04) / 0.1)),
    'side first, then rolls down': (deg) => (s) => s < 0.04 ? at(Math.sign(deg) * 85 || 0, s / 0.04) : at(lerp(Math.sign(deg) * 85 || 0, deg, (s - 0.04) / 0.1)),
    'quick flick': (deg) => (s) => s < 0.05 ? at(deg, s / 0.05) : s < 0.09 ? at(deg) : [0, 0],
  };
  const want = { 0: 'Pop Shove-it', 45: 'Varial Kickflip', '-45': 'Varial Heelflip', 90: 'Kickflip', '-90': 'Heelflip' };
  for (const hz of [72, 90, 120]) for (const delay of [0, 0.1, 0.2, 0.35]) for (const tapB of [true, false]) {
    for (const [name, path] of Object.entries(paths)) for (const deg of [0, 45, -45, 90, -90]) {
      if (name.includes('rolls') && Math.abs(deg) !== 45) continue;
      const events = [], s = flight(events);
      s.vel.y = 6;                                              // a proper ollie: enough air to finish the trick
      run(s, (time) => {
        right.gamepad.buttons[5].pressed = tapB ? time < 0.06 : true;
        const [x, y] = time < delay ? [0, 0] : path(deg)(time - delay);
        left.gamepad.axes = [0, 0, x, y];
        return input.poll(1 / hz);
      }, delay + 0.4, 1 / hz);
      assert.deepEqual(starts(events), [want[deg]], `${name} ${deg}° after ${delay} s, ${tapB ? 'tap' : 'hold'} B, ${hz} Hz`);
    }
  }
  right.gamepad.buttons[5].pressed = false;
});

test('stick held first, then B, fires straight away (and reads where the stick is now, not where it wandered)', () => {
  const events = [], s = flight(events);
  run(s, { trickStick: { x: 0, y: 1 } }, 0.3);                // was holding down…
  run(s, { trickStick: { x: -0.7, y: 0.7 } }, 0.5);           // …then settled on down-left
  run(s, { flip: true, trickStick: { x: -0.7, y: 0.7 } }, 1 / 72);
  assert.deepEqual(starts(events), ['Varial Kickflip']);
});

test('B with no stick does nothing, and a push after the window does nothing', () => {
  const events = [], s = flight(events);
  run(s, { flip: true }, 0.06);
  run(s, {}, 0.5);
  run(s, { trickStick: { x: -1, y: 0 } }, 0.2);
  assert.deepEqual(starts(events), []);
});
