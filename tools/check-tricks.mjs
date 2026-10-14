// Plays flip tricks in the real game, in headless Chromium, through a fake Quest controller pair (the same WebXR gamepad
// objects input.js reads in the headset): roll, hold a stick direction, ollie with A, press B, and report what came out.
//   node tools/check-tricks.mjs [levelId]
import { serveDist, openPage } from './browser.mjs';
const [level = ''] = process.argv.slice(2);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html${level ? `?level=${level}` : ''}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 280000 });
  const rows = await page.evaluate(async () => {
    const { sim, renderer, input } = window.__skate; renderer.setAnimationLoop(null);
    const pad = (n) => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })) });
    const left = { handedness: 'left', gamepad: pad() }, right = { handedness: 'right', gamepad: pad() };
    const session = { inputSources: [left, right] };
    renderer.xr.getSession = () => session;
    Object.defineProperty(renderer.xr, 'isPresenting', { get: () => true, configurable: true });
    const dt = 1 / 72, out = [];
    const deg = (d, m = 1) => [-Math.sin(d * Math.PI / 180) * m, Math.cos(d * Math.PI / 180) * m];
    const plans = {
      'hold DL, ollie, B': { stick: (t) => deg(45), b: (t) => t > 1.05 && t < 1.12 },
      'hold DL, ollie, hold B': { stick: (t) => deg(45), b: (t) => t > 1.05 },
      'ollie, B, then DL': { stick: (t) => t > 1.12 ? deg(45, Math.min(1, (t - 1.12) / 0.05)) : [0, 0], b: (t) => t > 1.05 && t < 1.12 },
      'hold DR, ollie, B': { stick: (t) => deg(-45), b: (t) => t > 1.05 && t < 1.12 },
      'hold L, ollie, B': { stick: (t) => deg(90), b: (t) => t > 1.05 && t < 1.12 },
      'hold D, ollie, B': { stick: (t) => deg(0), b: (t) => t > 1.05 && t < 1.12 },
      'hold D 10° off, ollie, B': { stick: (t) => deg(10), b: (t) => t > 1.05 && t < 1.12 },
      'hold DL 20°, ollie, B': { stick: (t) => deg(20), b: (t) => t > 1.05 && t < 1.12 },
      'hold DL 25° half-push, B': { stick: (t) => deg(25, 0.6), b: (t) => t > 1.05 && t < 1.12 },
      'hold DR 20°, ollie, B': { stick: (t) => deg(-20), b: (t) => t > 1.05 && t < 1.12 },
    };
    for (const [name, plan] of Object.entries(plans)) {
      sim.respawn(sim.spawn); sim.mode = 'ground';
      const h = sim.heading; sim.vel.set(-Math.sin(h) * 5, 0, -Math.cos(h) * 5);
      const events = []; const orig = sim.onEvent; sim.onEvent = (t, d) => { events.push([t, d?.stick ? `${d.name} [read ${Math.round(Math.atan2(Math.abs(d.stick.x), d.stick.y) * 180 / Math.PI)}°]` : d?.name]); orig(t, d); };
      const trace = [];
      for (let i = 0; i < 72 * 2; i++) {
        const t = i / 72;
        const s = t > 0.6 ? plan.stick(t) : [0, 0];
        left.gamepad.axes = [0, 0, s[0], s[1]];
        right.gamepad.buttons[4].pressed = t > 0.8 && t < 1.0;          // A: crouch, release to ollie
        right.gamepad.buttons[5].pressed = plan.b(t);                    // B
        const command = input.poll(dt);
        sim.update(command, dt);
        if (t > 0.98 && t < 1.4) trace.push(`${t.toFixed(2)} ${sim.mode} stick(${command.trickStick.x.toFixed(2)},${command.trickStick.y.toFixed(2)}) B=${command.flip}`);
      }
      sim.onEvent = orig;
      out.push({ name, starts: events.filter((e) => e[0] === 'flipStart').map((e) => e[1]), lands: events.filter((e) => e[0] === 'flip' || e[0] === 'bail').map((e) => e.join(':')), trace: trace.filter((_, i) => i % 4 === 0).slice(0, 8) });
    }
    return out;
  });
  for (const r of rows) console.log(r.name.padEnd(24), '→', r.starts.join(',') || 'NOTHING', '| landed:', r.lands.join(',') || '-', '');
} finally { await browser.close(); server.close(); }
