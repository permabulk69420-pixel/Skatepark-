// Finds every ramp-like surface in a level's collision (a connected patch of sloping ground), rides the real skater up it from
// the bottom, and flags what goes wrong: a bail on the way up, or the board stopping dead on the slope while still moving (the
// "invisible wall"), or not getting up a ramp it has the speed for.     node tools/check-ramps.mjs [levelId] [speed]
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'eastbank';
const speed = Number(process.argv[3] || 6.5);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const rows = await page.evaluate(async ({ speed }) => {
    const THREE = await import('three');
    const { sim, renderer } = window.__skate; renderer.setAnimationLoop(null);
    const world = sim.world, g = {};
    const b = sim.bounds;
    // 1. sloped cells on a 1 m grid
    const cells = new Map();
    for (let x = b.cx - b.x; x <= b.cx + b.x; x += 1) for (let z = b.cz - b.z; z <= b.cz + b.z; z += 1) {
      const hit = world.ground(x, z, 12, g);
      if (hit && hit.ny > 0.25 && hit.ny < 0.97) cells.set(`${Math.round(x)},${Math.round(z)}`, { x, z, y: hit.y, nx: hit.nx, nz: hit.nz, ny: hit.ny });
    }
    // 2. connected patches
    const seen = new Set(), patches = [];
    for (const [key, c] of cells) {
      if (seen.has(key)) continue;
      const stack = [c], patch = []; seen.add(key);
      while (stack.length) {
        const p = stack.pop(); patch.push(p);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const k = `${Math.round(p.x) + dx},${Math.round(p.z) + dz}`;
          if (cells.has(k) && !seen.has(k)) { seen.add(k); stack.push(cells.get(k)); }
        }
      }
      if (patch.length >= 8) patches.push(patch);
    }
    // 3. ride up each patch from its low side
    const rowsOut = [];
    for (const patch of patches) {
      const cx = patch.reduce((s, p) => s + p.x, 0) / patch.length, cz = patch.reduce((s, p) => s + p.z, 0) / patch.length;
      const nx = patch.reduce((s, p) => s + p.nx, 0), nz = patch.reduce((s, p) => s + p.nz, 0);
      const len = Math.hypot(nx, nz);
      if (len < 1e-3) continue;                                    // a bowl or a hip: the slopes cancel out
      const up = new THREE.Vector3(-nx / len, 0, -nz / len);       // the surface normal points downhill
      const lowY = Math.min(...patch.map((p) => p.y)), highY = Math.max(...patch.map((p) => p.y));
      if (highY - lowY < 0.3) continue;
      let start = null;
      for (const d of [9, 7, 5, 3]) {
        const x = cx - up.x * d, z = cz - up.z * d;
        const hit = world.ground(x, z, lowY + 1.5, g);
        if (hit && Math.abs(hit.y - lowY) < 0.5 && hit.ny > 0.97) { start = { x, z, y: hit.y }; break; }
      }
      if (!start) { rowsOut.push({ at: `(${cx.toFixed(0)}, ${cz.toFixed(0)})`, rise: +(highY - lowY).toFixed(2), result: 'no flat run-up found' }); continue; }
      const heading = Math.atan2(-up.x, -up.z);
      const trial = (hold) => {
        sim.respawn({ pos: new THREE.Vector3(start.x, start.y, start.z), heading });
        sim.mode = 'ground'; sim.vel.set(up.x * speed, 0, up.z * speed);
        let events = [], maxY = start.y, stuck = 0, last = sim.pos.clone(), bail = null;
        const orig = sim.onEvent; sim.onEvent = (t, d) => { if (t === 'bail') bail = d.reason; orig(t, d); };
        for (let i = 0; i < 72 * 4; i++) {
          sim.update({ drive: hold ? 1 : 0 }, 1 / 72);
          maxY = Math.max(maxY, sim.pos.y);
          if (i % 72 === 71) { if (sim.mode === 'ground' && sim.speed > 1.2 && sim.pos.distanceTo(last) < 0.05 && sim.pos.y > start.y + 0.15) stuck++; last = sim.pos.clone(); }
          if (sim.mode === 'bail') break;
        }
        sim.onEvent = orig;
        return { bail, stuck, reached: +(maxY - start.y).toFixed(2) };
      };
      const a = trial(false), c = trial(true);
      const canReach = 0.5 * speed * speed / 9.81 * 0.75;            // generous: friction and the curve cost some
      const problems = [];
      if (a.bail) problems.push(`bails (${a.bail})`);
      if (a.stuck || c.stuck) problems.push('STOPS DEAD ON THE SLOPE');
      if (!a.bail && !a.stuck && a.reached < Math.min(highY - lowY, canReach) - 0.25) problems.push(`only reaches ${a.reached} of ${(highY - lowY).toFixed(2)} m`);
      rowsOut.push({ at: `(${cx.toFixed(0)}, ${cz.toFixed(0)})`, rise: +(highY - lowY).toFixed(2), cells: patch.length, reached: a.reached, problems: problems.join('; ') || 'ok' });
    }
    return rowsOut;
  }, { speed });
  const bad = rows.filter((r) => r.problems !== 'ok' && r.result === undefined || r.result);
  console.log(`${rows.length} ramps ridden at ${speed} m/s, ${bad.length} with problems`);
  for (const r of rows.sort((a, b) => (a.problems === 'ok') - (b.problems === 'ok'))) console.log(`  ${r.at.padEnd(11)} rise ${String(r.rise).padStart(5)} m  reached ${String(r.reached ?? '-').padStart(5)}  ${r.problems ?? r.result}`);
} finally { await browser.close(); server.close(); }
