import test from 'node:test';
import { createInput } from '../dist/src/skate/input.js';
import { Mode } from '../dist/src/skate/sim.js';
import { makeSkater } from './helpers.mjs';
test('repro', () => {
  globalThis.addEventListener = () => {};
  const btn = () => Array.from({ length: 6 }, () => ({ pressed: false }));
  const left = { handedness: 'left', gamepad: { axes: [0, 0, 0, 0], buttons: btn() } };
  const right = { handedness: 'right', gamepad: { axes: [0, 0, 0, 0], buttons: btn() } };
  const input = createInput({ xr: { isPresenting: true, getSession: () => ({ inputSources: [left, right] }) } });
  for (const [x, y] of [[-0.7, 0.7], [-0.6, 0.8], [-0.8, 0.6], [-0.5, 0.85]]) {
    const events = []; const s = makeSkater({ events });
    s.vel.set(0, 0, -5);
    const dt = 1 / 72; let t = 0, log = [];
    const step = (secs, f) => { for (let e = t + secs; t < e; t += dt) { f?.(t); const c = input.poll(dt); s.update(c, dt);
      log.push(`${t.toFixed(2)} ${s.mode} press=${s.trickControls.pressAge.toFixed?.(2)} g=${s.trickControls.gesture ? JSON.stringify([s.trickControls.gesture.cx, s.trickControls.gesture.cy, s.trickControls.gesture.x,s.trickControls.gesture.y].map(v=>+v.toFixed(2))) : '-'} ready=${s.trickControls.ready?.name}`); } };
    step(0.5);
    left.gamepad.axes = [0, 0, x, y];
    step(0.6);                                   // hold diagonal on the ground
    right.gamepad.buttons[4].pressed = true; step(0.25); right.gamepad.buttons[4].pressed = false; // ollie
    step(0.1);
    right.gamepad.buttons[5].pressed = true; step(0.1); right.gamepad.buttons[5].pressed = false;
    step(0.6);
    console.log(x, y, events.filter(e => /flip/.test(e.type)).map(e => e.type + ':' + e.data?.name));
    if (x === -0.7) console.log(log.filter((_, i) => i % 3 === 0).slice(70, 100).join('\n'));
  }
});
