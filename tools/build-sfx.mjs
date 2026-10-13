// Cuts the game's sound effects out of the CC0 recordings in source/sfx (Freesound previews, listed in source/sfx/CREDITS.md) and
// writes them to dist/assets/sfx as small mono Ogg Vorbis files:   node tools/build-sfx.mjs
// One-shots start exactly on their transient (so a pop is heard the frame you pop) and are peak-normalised; loops are a steady
// stretch whose end is crossfaded into its start, so they repeat without a seam, and are loudness-normalised. Needs ffmpeg.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(repo, 'source/sfx'), out = path.join(repo, 'dist/assets/sfx');
const SR = 44100;

// from, to: seconds in the recording. onset: start on the first transient after `from`. loop: crossfade length (s) for a loop.
export const CLIPS = {
  pop: { file: '515229', from: 0, to: 0.24, onset: true, fadeOut: 0.09 },
  pop2: { file: '515226', from: 0.1, to: 0.42, onset: true, fadeOut: 0.12 },
  land: { file: '515229', from: 0.42, to: 1.0, onset: true, fadeOut: 0.2 },
  landHard: { file: '740121', from: 0.12, to: 0.95, onset: true, fadeOut: 0.3 },
  landHard2: { file: '568434', from: 0, to: 0.8, onset: true, fadeOut: 0.3 },
  railHit: { file: '655371', from: 0.3, to: 0.95, onset: true, fadeOut: 0.3 },
  grindMetal: { file: '262085', from: 2.55, to: 3.95, loop: 0.25 },
  grindConcrete: { file: '478166', from: 2.62, to: 3.6, loop: 0.2 },
  roll: { file: '398883', from: 8.0, to: 14.0, loop: 0.5 },
  rollWood: { file: '346380', from: 0.5, to: 5.0, loop: 0.5 },
  bailBody: { file: '417994', from: 0.15, to: 1.5, onset: true, fadeOut: 0.4 },
  bailBoard: { file: '717547', from: 0, to: 1.6, onset: true, fadeOut: 0.3 }
};

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'quiet', '-i', path.join(src, `${file}.mp3`), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function encode(samples, name) {
  const tmp = path.join(out, `${name}.raw`);
  fs.writeFileSync(tmp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', tmp, '-c:a', 'libvorbis', '-q:a', '5', path.join(out, `${name}.ogg`)]);
  fs.unlinkSync(tmp);
}

const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

function cut(def) {
  const x = decode(def.file);
  let a = Math.round(def.from * SR), b = Math.min(x.length, Math.round(def.to * SR));
  if (def.onset) {
    // The first sample that reaches a third of the stretch's peak, less 4 ms of run-up.
    const p = peak(x.subarray(a, b));
    let i = a;
    while (i < b && Math.abs(x[i]) < p / 3) i++;
    a = Math.max(a, i - Math.round(0.004 * SR));
  }
  if (def.loop) {
    // Loop: take an extra crossfade's worth past the end and fold it over the start (equal-power), so sample n-1 runs into 0.
    const f = Math.round(def.loop * SR);
    const len = b - a - f;
    const y = new Float32Array(len);
    for (let i = 0; i < len; i++) y[i] = x[a + i];
    for (let i = 0; i < f; i++) {
      const t = i / f;
      y[i] = x[a + i] * Math.sin(t * Math.PI / 2) + x[a + len + i] * Math.cos(t * Math.PI / 2);
    }
    const g = 0.12 / rms(y);                      // about −18 dBFS RMS
    for (let i = 0; i < len; i++) y[i] = Math.max(-1, Math.min(1, y[i] * g));
    return y;
  }
  const y = x.slice(a, b);
  const fi = Math.round(0.002 * SR), fo = Math.round((def.fadeOut || 0.05) * SR);
  for (let i = 0; i < fi && i < y.length; i++) y[i] *= i / fi;
  for (let i = 0; i < fo && i < y.length; i++) y[y.length - 1 - i] *= i / fo;
  const g = 0.89 / peak(y);                       // −1 dBFS peak
  for (let i = 0; i < y.length; i++) y[i] *= g;
  return y;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(out, { recursive: true });
  for (const [name, def] of Object.entries(CLIPS)) {
    const y = cut(def);
    encode(y, name);
    console.log(`${name.padEnd(14)} ${(y.length / SR).toFixed(2)} s  ${def.loop ? 'loop' : 'one-shot'}  ${(fs.statSync(path.join(out, `${name}.ogg`)).size / 1024).toFixed(0)} KB`);
  }
}
