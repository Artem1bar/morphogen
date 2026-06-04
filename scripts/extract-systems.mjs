// extract-systems.mjs — write generated system code from a workflow output file
// into src/systems/<id>.js. Defensive: strips stray code fences, validates the
// id against the expected set, and refuses to write empty/short code.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const systemsDir = join(here, '..', 'src', 'systems');

const EXPECTED = new Set([
  'domainwarp', 'reactiondiffusion', 'lenia', 'physarum', 'particlelife',
  'boids', 'differentialgrowth', 'attractors', 'lsystem',
  'wavefunctioncollapse', 'cyclic',
]);

const src = process.argv[2];
if (!src) {
  console.error('usage: node extract-systems.mjs <workflow-output.json>');
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(src, 'utf8'));
const arr = Array.isArray(parsed) ? parsed : parsed.result;
if (!Array.isArray(arr)) {
  console.error('Could not find a results array in the output file');
  process.exit(1);
}

function stripFences(code) {
  let c = code.trim();
  // Remove a leading ```js / ``` fence and trailing ``` if the model added one.
  c = c.replace(/^```[a-zA-Z]*\n/, '');
  c = c.replace(/\n```$/, '');
  return c;
}

let written = 0;
const seen = new Set();
for (const item of arr) {
  if (!item || typeof item.id !== 'string') {
    console.warn('skip: item without id');
    continue;
  }
  if (!EXPECTED.has(item.id)) {
    console.warn(`skip: unexpected id "${item.id}"`);
    continue;
  }
  if (seen.has(item.id)) {
    console.warn(`skip: duplicate id "${item.id}"`);
    continue;
  }
  const code = stripFences(String(item.code || ''));
  if (code.length < 200 || !/export default/.test(code)) {
    console.warn(`skip: "${item.id}" code looks invalid (len ${code.length})`);
    continue;
  }
  writeFileSync(join(systemsDir, `${item.id}.js`), code + '\n');
  seen.add(item.id);
  written++;
  console.log(`✓ ${item.id}.js  (${code.split('\n').length} lines)`);
}

const missing = [...EXPECTED].filter((id) => !seen.has(id));
console.log(`\nWrote ${written}/${EXPECTED.size} systems.`);
if (missing.length) console.log(`Missing: ${missing.join(', ')}`);
