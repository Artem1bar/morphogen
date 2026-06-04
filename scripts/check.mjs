// check.mjs — syntax-check every source file with `node --check` and report a
// clean summary. Exits non-zero if anything fails to parse.
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = [
  ...walk(join(root, 'src')),
  ...walk(join(root, 'scripts')),
  ...walk(join(root, 'test')),
  join(root, 'build.js'),
].filter((f) => {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
});

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`✗ ${f.replace(root, '.')}`);
    console.error(String(e.stderr || e.message).split('\n').slice(0, 4).join('\n'));
  }
}

if (failed === 0) {
  console.log(`✓ ${files.length} files parse cleanly`);
} else {
  console.error(`\n${failed} file(s) failed to parse`);
  process.exit(1);
}
