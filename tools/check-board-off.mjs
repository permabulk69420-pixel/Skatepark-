// Headless check of taking the board off your feet and catching it (board-off.js): fakes two controllers, grabs the board in mid-air
// with the right hand (an Indy), presses detach (C), swings the board out to the side (a Christ Air), tries to catch it out there (a
// miss), brings it back under the feet and catches it (clean), and reports each step. Optional: a folder to save screenshots in.
//   node tools/check-board-off.mjs [levelId] [screenshotDir]
import { serveDist, openPage } from './browser.mjs';
import fs from 'node:fs';

const levelId = process.argv[2] || 'foundry';
const shots = process.argv[3];
if (shots) fs.mkdirSync(shots, { recursive: true });
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`, { width: 900, height: 700 });
const steps = [];
const note = (label, data) => { steps.push({ label, ...data }); console.log(label.padEnd(34), JSON.stringify(data)); };
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  await page.evaluate(async () => {
    const { hands } = window.__skate;
    window.__pads = {};
    for (const [index, handedness] of ['left', 'right'].entries()) {
      const buttons = Array.from({ length: 6 }, () => ({ value: 0, pressed: false }));
      window.__pads[handedness] = buttons;
      hands.states[index].controller.dispatchEvent({ type: 'connected', data: { handedness, gamepad: { buttons, axes: [0, 0, 0, 0] } } });
    }
    await new Promise((resolve) => { const t = setInterval(() => { if (hands.states.every((s) => s.handAnchor)) { clearInterval(t); resolve(); } }, 100); });
    const THREE = await import('three');
    window.__frames = (n) => new Promise((res) => { let i = 0; const step = () => (++i >= n ? res() : requestAnimationFrame(step)); requestAnimationFrame(step); });
    // Put a controller grip at a world point (and keep it there: three would hide a controller outside an XR session).
    window.__place = (s, world) => {
      const { rig } = window.__skate;
      rig.updateMatrixWorld(true);
      const local = rig.worldToLocal(world.clone());
      s.grip.matrix.makeTranslation(local.x, local.y, local.z);
      s.grip.matrix.decompose(s.grip.position, s.grip.quaternion, s.grip.scale);
      s.grip.matrixAutoUpdate = false; s.grip.visible = true;
      s.controller.matrix.copy(s.grip.matrix); s.controller.matrixAutoUpdate = false;
    };
    window.__V = THREE.Vector3;
    // Freeze the skater in mid-air above the park, so the board holds still while the hand works.
    const { sim } = window.__skate;
    sim.respawn(sim.spawn);
    sim.mode = 'air'; sim.pos.y += 2.0; sim.vel.set(0, 0, 0); sim.update = () => {};
    await window.__frames(4);
  });
  const status = () => page.evaluate(() => {
    const { sim, grab, boardView } = window.__skate;
    return { boardOff: sim.boardOff, held: grab.off, trick: sim.offTrick?.name ?? null, far: +(sim.offTrick?.far ?? 0).toFixed(2), boardFromFeet: +boardView.root.position.distanceTo(sim.pos).toFixed(2), grabs: grab.names() };
  });
  const pressDetach = async () => { await page.keyboard.down('KeyC'); await page.evaluate(() => window.__frames(3)); await page.keyboard.up('KeyC'); await page.evaluate(() => window.__frames(3)); };
  const events = [];
  await page.exposeFunction('__event', (t, d) => events.push(t + (d?.quality ? `:${d.quality}` : '')));
  await page.evaluate(() => { const g = window.__skate.grab; void g; const sim = window.__skate.sim; const orig = sim.onEvent; sim.onEvent = (t, d) => { window.__event(t, d); orig(t, d); }; });

  // 1. grab the right side of the board (an Indy for a regular rider)
  const start = await page.evaluate(async () => {
    const { hands, boardView, grab } = window.__skate;
    const right = hands.states.find((s) => s.handedness === 'right'), left = hands.states.find((s) => s.handedness === 'left');
    boardView.root.updateMatrixWorld(true);
    const p = boardView.root.position.clone(), q = boardView.root.quaternion;
    const at = new window.__V(0.3, 0.3, 0.02).applyQuaternion(q).add(p);
    window.__place(right, at);
    window.__place(left, p.clone().add(new window.__V(0, 1.4, 0)));
    window.__pads.right[1].value = 1; window.__pads.right[1].pressed = true;
    const t = performance.now(); while (!grab.holding() && performance.now() - t < 8000) await window.__frames(1);
    await window.__frames(30);
    window.__handStart = at.clone();
    return { holding: grab.holding() };
  });
  note('grab', { ...start, ...(await status()) });

  // 2. take it off your feet
  await pressDetach();
  note('detach (C)', await status());

  // 3. swing it out to the side and up: a Christ Air
  const moved = await page.evaluate(async () => {
    const { hands, boardView, rig } = window.__skate;
    const right = hands.states.find((s) => s.handedness === 'right');
    const before = boardView.root.position.clone();
    const out = new window.__V(0.55, 0.35, 0).applyQuaternion(rig.quaternion);
    window.__place(right, window.__handStart.clone().add(out));
    await window.__frames(20);
    return { boardMoved: +boardView.root.position.distanceTo(before).toFixed(2), handMoved: +out.length().toFixed(2) };
  });
  note('swing it out', { ...moved, ...(await status()) });
  if (shots) {
    await page.evaluate(async () => {
      const { boardView, renderer, rig } = window.__skate;
      const THREE = await import('three');
      const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.02, 200);
      const p = boardView.root.position;
      const back = new THREE.Vector3(-0.2, 0.4, 2.3).applyQuaternion(rig.quaternion);
      cam.position.copy(p).add(back);
      cam.lookAt(p.x, p.y - 0.2, p.z);
      window.__origRender = renderer.render.bind(renderer);
      renderer.render = (sc) => window.__origRender(sc, cam);
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${shots}/christ-air.png` });
    await page.evaluate(() => { window.__skate.renderer.render = window.__origRender; });
  }

  // 4. try to catch it out there: too far, nothing happens
  await pressDetach();
  note('catch at arm\'s length', await status());

  // 5. bring it back under your feet and catch it
  await page.evaluate(async () => {
    const { hands } = window.__skate;
    const right = hands.states.find((s) => s.handedness === 'right');
    window.__place(right, window.__handStart.clone());
    await window.__frames(20);
  });
  note('bring it back', await status());
  await pressDetach();
  await page.evaluate(() => window.__frames(20));
  note('catch under your feet', await status());
  note('events', { events });

  const ok = steps[0].holding && steps[1].boardOff && steps[2].boardMoved > 0.4 && steps[2].trick === 'Christ Air'
    && steps[3].boardOff && steps[5].boardOff === false && events.some((e) => e.startsWith('catch:'));
  console.log(ok ? 'BOARD OFF CHECK OK' : 'BOARD OFF CHECK FAILED');
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); server.close(); }
