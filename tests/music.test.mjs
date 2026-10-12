import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusic, MUSIC } from '../dist/src/skate/music.js';

// A stand-in for Web Audio and fetch: sources record start(), and we end them by hand.
function fake() {
  const started = [];
  class AudioContext {
    constructor() { this.destination = {}; this.resumed = 0; fake.ctx = this; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBufferSource() { const s = { buffer: null, connect() {}, start() { started.push(s); } }; return s; }
    decodeAudioData(b) { return Promise.resolve({ name: b.name }); }
    resume() { this.resumed += 1; }
  }
  globalThis.AudioContext = AudioContext;
  globalThis.fetch = (url) => Promise.resolve({ arrayBuffer: () => Promise.resolve({ name: url }) });
  return started;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('plays nothing until start, then loops the whole playlist forever', async () => {
  const started = fake();
  const music = createMusic({ urls: ['a', 'b', 'c'] });
  await tick();
  assert.equal(started.length, 0);
  music.start();
  await tick(); await tick();
  assert.equal(started.length, 1);
  assert.equal(started[0].buffer.name, 'a');
  for (const expected of ['b', 'c', 'a', 'b']) {
    started.at(-1).onended();
    await tick(); await tick();
    assert.equal(started.at(-1).buffer.name, expected);
  }
});

test('starting again only resumes the audio, it does not restart the song', async () => {
  const started = fake();
  const music = createMusic({ urls: ['a', 'b'] });
  music.start(); await tick(); await tick();
  music.start(); music.start(); await tick();
  assert.equal(started.length, 1);
  assert.equal(fake.ctx.resumed, 2);
});

test('the soundtrack is the three bundled tracks', () => {
  assert.deepEqual([...MUSIC.tracks], ['heatwave', 'rebellion', 'punk-rock']);
});
