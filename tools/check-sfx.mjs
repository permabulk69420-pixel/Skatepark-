// Plays a level's board sounds in headless Chromium and reports what sounded:  node tools/check-sfx.mjs [levelId]
// Loads and decodes every clip, then rides: roll away from the entrance, ollie, (on Foundry) the loop on its ply, a rail grind,
// and a bail, printing the loop mix (gain, rate) and the one-shots played at each step.
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'foundry';
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  await page.mouse.click(400, 300);                       // a user gesture, so audio may start
  await page.waitForFunction(() => window.__skate.sfx?.ready, null, { timeout: 30000 });
  const report = await page.evaluate(async () => {
    const { sim, sfx, renderer } = window.__skate;
    renderer.setAnimationLoop(null);
    sim.requireGrind = false;
    const out = [];
    const dt = 1 / 72;
    const ride = (label, input, seconds, until) => {
      for (let i = 0; i < seconds * 72; i++) { sim.update(typeof input === 'function' ? input(i * dt) : input, dt); sfx.update(sim, dt); if (until?.(sim)) break; }
      return new Promise((r) => setTimeout(() => { out.push({ label, mode: sim.mode, speed: +sim.speed.toFixed(1), mix: sfx.mix, played: { ...sfx.played } }); r(); }, 300));
    };
    sim.respawn(sim.spawn);
    await ride('rolling on the deck', { drive: 1 }, 1.5);
    await ride('ollie (hold then release)', (t) => ({ jump: t < 0.3 }), 1.4);
    await ride('into the loop', { drive: 1 }, 6, (s) => s.mode === 'loop' && s.groundNormal.y < 0);
    await ride('out of the loop', { drive: 0 }, 3);
    // a rail: drop onto the first rail path, travelling along it
    const path = sim.paths.find((p) => p.name.includes("FlatBar")) || sim.paths.find((p) => p.kind === "rail");
    if (!path) return [...out, { error: "no rail", kinds: sim.paths.map((p) => p.kind + ":" + p.name) }];
    const THREE = await import('three');
    const seg = path.segments[0], dir = new THREE.Vector3(seg.dirH.x, 0, seg.dirH.y);
    sim.respawn({ pos: seg.a.clone().addScaledVector(dir, 0.1).add(new THREE.Vector3(0, path.topOffset + 0.15, 0)), heading: Math.atan2(-dir.x, -dir.z) });
    sim.mode = 'air'; sim.vel.copy(dir).multiplyScalar(4.5);
    await ride(`grinding ${path.name}`, {}, 0.6, (s) => s.mode === 'grind' && s.grind.time > 0.3);
    sim.respawn(sim.spawn); sim.vel.set(8, 0, 0); sim.mode = 'ground';
    sim.bail('test');
    await ride('bail', {}, 0.2);
    return out;
  });
  for (const r of report) console.log(JSON.stringify(r));
} finally { await browser.close(); server.close(); }
