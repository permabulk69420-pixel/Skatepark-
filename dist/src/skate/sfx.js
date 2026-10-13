// Board sounds, through Web Audio. One-shots on the skater's events (pop, landing, rail clank, bail, wall knock, push scuff) and
// three loops whose loudness and pitch follow what the board is doing: rolling (concrete, or ply on wooden ramps and the loop),
// grinding metal (rails, steel coping) and grinding concrete (ledges). The clips are cut from CC0 recordings by tools/build-sfx.mjs.
// Like the music, nothing plays until start() is called from a click, key press or VR session (browsers insist).
import { Mode } from './sim.js';

export const SFX = Object.freeze({
  volume: 0.85,              // 0..1, all the board sounds
  files: Object.freeze(['pop', 'pop2', 'land', 'landHard', 'landHard2', 'railHit', 'grindMetal', 'grindConcrete', 'roll', 'rollWood', 'bailBody', 'bailBoard']),
  roll: Object.freeze({ gain: 0.55, fullSpeed: 8, rateMin: 0.8, rateMax: 1.35 }),   // loudest at fullSpeed m/s; pitch rises with speed
  grind: Object.freeze({ gain: 0.75, rateMin: 0.85, rateMax: 1.25 }),
  pop: 0.9,
  land: 0.85,                // scaled by how hard the landing was; past 5.5 m/s into the ground it is the heavy clip
  push: 0.22,
  wood: /Mini|Loop|Wood|Ply|Timber/i      // collision meshes whose name matches this are ridden on the wooden roll
});

export function createSfx({ url, world }) {
  let ctx = null, master = null;
  const buffers = new Map();
  const played = {};                       // one-shots played so far, by name (for checks and tuning)
  const loops = {};
  let surfaceT = 0, wood = false;
  const hit = {};

  function start() {
    if (ctx) { ctx.resume?.(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = SFX.volume;
    master.connect(ctx.destination);
    Promise.all(SFX.files.map((name) => fetch(url(name)).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))
      .then((buffer) => buffers.set(name, buffer)).catch((error) => console.warn('sfx', name, error))))
      .then(() => { for (const name of ['roll', 'rollWood', 'grindMetal', 'grindConcrete']) loops[name] = makeLoop(name); });
  }

  function makeLoop(name) {
    const buffer = buffers.get(name);
    if (!buffer) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(master);
    // Start each loop at a random point, so two of them never line up the same way twice.
    source.start(0, Math.random() * buffer.duration);
    return { source, gain };
  }

  // gain 0..1, rate = playback speed (pitch); a little random detune keeps repeats from sounding identical.
  function play(name, gain = 1, rate = 1) {
    const buffer = buffers.get(name);
    if (!ctx || !buffer) return;
    played[name] = (played[name] || 0) + 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(g).connect(master);
    source.start();
  }

  // A push: the back foot scuffing the ground, made rather than recorded (a short burst of band-passed noise).
  function scuff(gain) {
    if (!ctx) return;
    const len = Math.round(ctx.sampleRate * 0.16);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.min(1, t * 4)) * (1 - t) ** 2; }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 700 + Math.random() * 300; band.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(band).connect(g).connect(master);
    source.start();
  }

  // Skater events (main.js forwards them).
  function event(type, data = {}) {
    if (!ctx) return;
    switch (type) {
      case 'pop': play(Math.random() < 0.5 ? 'pop' : 'pop2', SFX.pop * (0.8 + 0.2 * (data.charge ?? 1))); break;
      case 'land': {
        const impact = data.impact ?? 2;
        if (impact < 0.6) break;
        const hard = impact > 5.5;            // an ollie on the flat lands at about 4 m/s; stairs and big airs come in harder
        const gain = SFX.land * Math.min(1, 0.3 + impact / 7);
        play(hard ? (Math.random() < 0.5 ? 'landHard' : 'landHard2') : 'land', gain, hard ? 1 : 1.05);
        break;
      }
      case 'push': scuff(SFX.push); break;
      case 'grindStart': play(data.kind === 'ledge' ? 'land' : 'railHit', data.kind === 'ledge' ? 0.5 : 0.7, data.kind === 'ledge' ? 1.2 : 1); break;
      case 'wall': play('landHard2', Math.min(0.9, 0.2 + (data.impact ?? 1) * 0.15), 0.9); break;
      case 'bail': play('bailBody', 0.9); play('bailBoard', 0.8); break;
      default: break;
    }
  }

  const fade = (loop, value, rate, tc = 0.05) => {
    if (!loop) return;
    loop.gain.gain.setTargetAtTime(value, ctx.currentTime, tc);
    loop.source.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.08);
  };

  // Every frame: the loops follow the board.
  function update(sim, dt) {
    if (!ctx || !loops.roll) return;
    const R = SFX.roll, G = SFX.grind;
    const rolling = (sim.mode === Mode.GROUND || sim.mode === Mode.LOOP) ? Math.abs(sim.rollSpeed) : 0;
    // What the wheels are on: the loop is ply; otherwise ask the collision under the board now and then.
    surfaceT -= dt;
    if (sim.mode === Mode.LOOP) wood = true;
    else if (surfaceT <= 0 && sim.mode === Mode.GROUND) {
      surfaceT = 0.15;
      const g = world.ground(sim.pos.x, sim.pos.z, sim.pos.y + 0.3, hit, 1);
      wood = !!g && SFX.wood.test(g.object?.name || '');
    }
    const level = Math.min(1, rolling / R.fullSpeed) ** 0.7 * (sim.manual ? 0.6 : 1);
    const rate = R.rateMin + (R.rateMax - R.rateMin) * Math.min(1, rolling / 12);
    fade(loops.roll, wood ? 0 : R.gain * level, rate);
    fade(loops.rollWood, wood ? R.gain * 1.1 * level : 0, rate);
    const grinding = sim.mode === Mode.GRIND && sim.grind ? Math.abs(sim.grind.gs) : 0;
    const metal = sim.grind && sim.grind.path.kind !== 'ledge';
    const glevel = grinding > 0.2 ? G.gain * Math.min(1, 0.45 + grinding / 7) : 0;
    const grate = G.rateMin + (G.rateMax - G.rateMin) * Math.min(1, grinding / 9);
    fade(loops.grindMetal, metal ? glevel : 0, grate, 0.03);
    fade(loops.grindConcrete, metal ? 0 : glevel, grate, 0.03);
  }

  // What is sounding now: each loop's gain and playback rate, and how many of each one-shot have played.
  const mix = () => Object.fromEntries(Object.entries(loops).map(([k, l]) => [k, l ? [+l.gain.gain.value.toFixed(3), +l.source.playbackRate.value.toFixed(2)] : null]));
  return { start, event, update, get ready() { return !!loops.roll; }, get mix() { return mix(); }, played, setVolume(v) { if (master) master.gain.value = v; } };
}
