// The soundtrack: the three tracks in dist/assets/music play one after another, forever. Decoded and played through Web Audio
// (not an <audio> tag) so the Quest browser does not pop up its media player. Browsers only allow sound after a tap or click, so
// nothing plays until start() is called from one (main.js does it on the first click, key press or VR session start).
export const MUSIC = Object.freeze({
  volume: 0.4,   // 0..1, the whole soundtrack
  tracks: Object.freeze(['heatwave', 'rebellion', 'punk-rock'])
});

export function createMusic({ urls, volume = MUSIC.volume, first = 0 }) {
  let ctx = null, gain = null, track = first % Math.max(1, urls.length), current = null;
  const decoded = new Map();

  function decode(url) {
    if (!decoded.has(url)) decoded.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)));
    return decoded.get(url);
  }

  function play() {
    const mine = {};
    current = mine;
    const url = urls[track];
    decode(url).then((buffer) => {
      if (current !== mine) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => { if (current === mine) { track = (track + 1) % urls.length; play(); } };
      mine.source = source;
      source.start();
      if (urls.length > 1) decode(urls[(track + 1) % urls.length]).catch(() => {}); // warm up the next one
    }).catch((error) => { decoded.delete(url); console.warn('music', error); });
  }

  // Call from a click, key press or the start of a VR session. Safe to call again: it only resumes a suspended context.
  function start() {
    if (!urls.length) return;
    if (ctx) { ctx.resume?.(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    play();
  }

  return { start, setVolume(v) { volume = v; if (gain) gain.gain.value = v; }, get started() { return !!ctx; }, get track() { return track; } };
}
