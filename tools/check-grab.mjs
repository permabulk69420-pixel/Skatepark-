// Headless check of the board grabs: fakes two connected controllers, puts the skater in the air, moves a hand to the nose / tail / side
// of the board and squeezes, then reports what was grabbed and where the hand ended up. Optional second argument: a folder to save screenshots in.
//   node tools/check-grab.mjs [levelId] [screenshotDir]
import { serveDist, openPage } from './browser.mjs';
import fs from 'node:fs';

const levelId = process.argv[2] || 'breakwater';
const shots = process.argv[3];
if (shots) fs.mkdirSync(shots, { recursive: true });
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
let failed = false;
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  await page.evaluate(async () => {
    const { hands } = window.__skate;
    // two fake controllers, each with a gamepad whose squeeze we can set
    window.__pads = {};
    for (const [index, handedness] of ['left', 'right'].entries()) {
      const buttons = Array.from({ length: 6 }, () => ({ value: 0, pressed: false }));
      window.__pads[handedness] = buttons;
      hands.states[index].controller.dispatchEvent({ type: 'connected', data: { handedness, gamepad: { buttons, axes: [0, 0, 0, 0] } } });
    }
    await new Promise((resolve) => { const t = setInterval(() => { if (hands.states.every((s) => s.handAnchor)) { clearInterval(t); resolve(); } }, 100); });
  });
  const results = [];
  for (const [label, hand, offset] of [
    ['tail', 'right', [0, 0.28, 0.5]],
    ['nose', 'left', [0, 0.28, -0.5]],
    ['side', 'right', [0.3, 0.3, 0.02]],
    ['side-left-hand', 'left', [-0.3, 0.3, 0.02]]
  ]) {
    const r = await page.evaluate(async ({ label, hand, offset }) => {
      const { sim, rig, hands, grab, boardView, camera, renderer } = window.__skate;
      const frames = (n) => new Promise((res) => { let i = 0; const step = () => (++i >= n ? res() : requestAnimationFrame(step)); requestAnimationFrame(step); });
      const until = async (cond, ms = 12000) => { const t = performance.now(); while (!cond() && performance.now() - t < ms) await frames(1); };
      const THREE = await import('three');
      const state = hands.states.find((s) => s.handedness === hand);
      const other = hands.states.find((s) => s !== state);
      const place = (s, world) => { // put a controller grip at a world point
        rig.updateMatrixWorld(true);
        const local = rig.worldToLocal(world.clone());
        s.grip.matrix.makeTranslation(local.x, local.y, local.z);
        s.grip.matrix.decompose(s.grip.position, s.grip.quaternion, s.grip.scale);
        s.grip.matrixAutoUpdate = false; s.grip.visible = true; // three hides a controller that is not in an XR session
        s.controller.matrix.copy(s.grip.matrix); s.controller.matrixAutoUpdate = false;
      };
      // freeze the skater in mid-air above the park so the board holds still while we test
      sim.respawn(sim.spawn);
      sim.mode = 'air'; sim.pos.y += 2.0; sim.vel.set(0, 0, 0); sim.update = () => {};
      await frames(4);
      boardView.root.updateMatrixWorld(true);
      const boardPos = boardView.root.position.clone();
      const q = boardView.root.quaternion;
      const at = new THREE.Vector3(...offset).applyQuaternion(q).add(boardPos).add(new THREE.Vector3(0, 0.145, 0));
      place(state, at);
      place(other, boardPos.clone().add(new THREE.Vector3(0, 1.4, 0))); // other hand well out of reach
      const box = window.__pads[hand];
      box[1].value = 0; await frames(4);
      box[1].value = 1; box[1].pressed = true;
      await until(() => grab.holding());
      await frames(30);
      const info = { label, holding: grab.holding(), names: grab.names() };
      if (info.holding) {
        const marker = boardView.root.children.find((c) => /^Grab /.test(c.name));
        const m = new THREE.Vector3(); marker?.getWorldPosition(m);
        const s = new THREE.Vector3(); state.gripSocket.getWorldPosition(s);
        info.markerToGripSocket = +m.distanceTo(s).toFixed(3);
        info.boardLift = +(boardView.root.position.y - boardPos.y).toFixed(3);
      }
      window.__lastShot = info.holding;
      return info;
    }, { label, hand, offset });
    if (shots && r.holding) {
      // look at the board and the hand from a spare camera (the game's own camera is driven by the rider every frame)
      for (const [name, dir] of [['a', [0.8, 0.5, 0.8]], ['b', [-0.8, 0.5, -0.8]]]) {
        await page.evaluate(async ({ dir }) => {
          const { boardView, renderer, scene } = window.__skate;
          const THREE = await import('three');
          const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.02, 100);
          const p = boardView.root.position;
          cam.position.set(p.x + dir[0], p.y + dir[1], p.z + dir[2]);
          cam.lookAt(p.x, p.y + 0.25, p.z);
          if (!window.__origRender) window.__origRender = renderer.render.bind(renderer);
          renderer.render = (sc) => window.__origRender(sc, cam);
        }, { dir });
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${shots}/${label}-${name}.png` });
        await page.evaluate(() => { window.__skate.renderer.render = window.__origRender; });
      }
    }
    // release and check the hand goes back
    const released = await page.evaluate(async ({ hand }) => {
      const { grab } = window.__skate;
      window.__pads[hand][1].value = 0; window.__pads[hand][1].pressed = false;
      const t = performance.now(); while (grab.holding() && performance.now() - t < 8000) await new Promise((res) => requestAnimationFrame(res));
      return !grab.holding();
    }, { hand });
    results.push({ ...r, released });
  }
  console.log(JSON.stringify(results, null, 1));
  const expect = { tail: 'Tail grab', nose: 'Nose grab' };
  for (const r of results) {
    const ok = r.holding && r.released && (!expect[r.label] || r.names.includes(expect[r.label])) && r.markerToGripSocket < 0.2;
    if (!ok) { failed = true; console.error('FAIL', r.label); }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? 'GRAB CHECK FAILED' : 'GRAB CHECK OK');
process.exit(failed ? 1 : 0);
