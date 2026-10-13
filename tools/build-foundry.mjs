// Builds the Foundry park:  node tools/build-foundry.mjs [out.glb]   (the same as: node tools/build-level.mjs foundry [out.glb])
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(here, 'build-level.mjs'), 'foundry', ...process.argv.slice(2)], { stdio: 'inherit' });
