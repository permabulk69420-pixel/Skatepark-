// Headless end-to-end check of the flip tricks through the real game: a fake Quest session feeds input.js exactly as the headset does
// (left thumbstick on axes[2], axes[3]; right A = buttons[4], right B = buttons[5]), the real main loop runs, and every trick event is logged.
//   node tools/check-tricks.mjs [levelId]
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'breakwater';
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const results = await page.evaluate(async () => {
    const { sim, input, renderer } = window.__skate;
    const left = { handedness: 'left', gamepad: { axes: [0, 0, 0, 0], buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false })) } };
    const right = { handedness: 'right', gamepad: { axes: [0, 0, 0, 0], buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false })) } };
    const session = { inputSources: [left, right] };
    const poll = input.poll.bind(input);
    renderer.xr.getSession = () => session;
    input.poll = (dt) => { const was = renderer.xr.isPresenting; renderer.xr.isPresenting = true; try { return poll(dt); } finally { renderer.xr.isPresenting = was; } };
    const log = [];
    const onEvent = sim.onEvent;
    sim.onEvent = (type, data) => { if (/flip|bail|sketchy|land|manual/.test(type)) log.push({ type, name: data?.name, stick: data?.stick, t: +performance.now().toFixed(0) }); onEvent(type, data); };
    const frames = (n) => new Promise((res) => { let i = 0; const step = () => (++i >= n ? res() : requestAnimationFrame(step)); requestAnimationFrame(step); });
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const stick = (x, y) => { left.gamepad.axes[2] = x; left.gamepad.axes[3] = y; }; // WebXR: y is -1 pushed up, +1 pulled down
    const press = (btn, on) => { right.gamepad.buttons[btn].pressed = on; right.gamepad.buttons[btn].value = on ? 1 : 0; };
    const A = 4, B = 5;
    const out = [];
    // Thumb paths: [x, y, ms] steps after the button press (or before, with negative ms meaning hold before pressing B).
    const D = 0.72; // a full-throw diagonal on a round gate
    const scenarios = {
      'hold down-left, then tap B': { before: [[-D, D]], after: [] },
      'hold down-right, then tap B': { before: [[D, D]], after: [] },
      'tap B, then down-left': { before: [], after: [[-D, D, 0]] },
      'tap B, then down, roll to down-left over 80 ms': { before: [], after: [[0, 1, 0], [-0.38, 0.92, 27], [-D, D, 54], [-D, D, 80]] },
      'tap B, then left, roll to down-left over 80 ms': { before: [], after: [[-1, 0, 0], [-0.92, 0.38, 27], [-D, D, 54], [-D, D, 80]] },
      'hold down, tap B (pop shove-it)': { before: [[0, 1]], after: [] },
      'hold left, tap B (kickflip)': { before: [[-1, 0]], after: [] },
    };
    for (const [label, sc] of Object.entries(scenarios)) {
      sim.respawn(sim.spawn);
      stick(0, 0); press(A, false); press(B, false);
      await frames(20);
      sim.vel.set(-Math.sin(sim.heading) * 5, 0, -Math.cos(sim.heading) * 5);
      press(A, true); await wait(350); press(A, false);           // full ollie
      const t0 = performance.now();
      while (sim.mode !== 'air' && performance.now() - t0 < 1000) await frames(1);
      const start = log.length;
      await wait(40);
      for (const [x, y] of sc.before) { stick(x, y); await wait(60); }
      press(B, true);
      for (let i = 0; i < sc.after.length; i++) {
        const [x, y, ms] = sc.after[i];
        const prev = i ? sc.after[i - 1][2] : 0;
        await wait(ms - prev); stick(x, y);
      }
      await wait(120); press(B, false);
      await wait(250); stick(0, 0);
      const t1 = performance.now();
      while (sim.mode === 'air' && performance.now() - t1 < 3000) await frames(1);
      await wait(200);
      out.push({ label, events: log.slice(start).map((e) => `${e.type}${e.name ? ' ' + e.name : ''}${e.stick ? ` [${e.stick.x.toFixed(2)}, ${e.stick.y.toFixed(2)}]` : ''}`) });
    }
    return out;
  });
  for (const r of results) console.log(`${r.label}\n    ${r.events.join('\n    ') || '(nothing)'}`);
} finally {
  await browser.close();
  server.close();
}
