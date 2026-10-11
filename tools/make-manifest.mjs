// Writes dist/manifest.json: a short content hash for every script and model the game loads, plus one build id for the whole
// set. index.html reads it on every visit and loads each file as `?v=<hash>`, so Quest can never run a stale file (a changed
// file has a new URL) and nothing is re-downloaded when it has not changed. Run `npm run manifest` after changing anything
// in dist/; `npm test` fails if the committed manifest is out of date.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['src', 'vendor', 'assets', 'models'];
const WANTED = /\.(js|mjs|glb)$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (WANTED.test(entry.name)) out.push(full);
  }
  return out;
}

export function buildManifest(distDir) {
  const files = {};
  for (const root of ROOTS) {
    const dir = path.join(distDir, root);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir).sort()) {
      const rel = path.relative(distDir, file).split(path.sep).join('/');
      files[rel] = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
    }
  }
  const build = crypto.createHash('sha1').update(JSON.stringify(files)).digest('hex').slice(0, 7);
  return { build, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  const manifest = buildManifest(distDir);
  fs.writeFileSync(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`dist/manifest.json: build ${manifest.build}, ${Object.keys(manifest.files).length} files`);
}
