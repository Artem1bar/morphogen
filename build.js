// build.js — inline the whole studio into a single openable dist/morphogen.html.
//
// The output must work by double-clicking (file://), where Chrome gives the page
// an opaque `null` origin. That rules out ES-module loaders: a `<script
// type="module">`, dynamic import(), or blob-URL import all hit cross-origin
// restrictions from file://. So instead we transpile the ES modules into a tiny
// synchronous module registry inside ONE classic <script> — no modules, no
// network, no blobs. A classic inline script behaves identically on file:// and
// http, so the single file opens offline with zero ceremony.
//
// The transform is deliberately narrow and matches only this codebase's
// disciplined import/export style (enumerated in scripts, verified by tests):
//   imports : `import D from '...'` | `import { a, b } from '...'` (multiline ok)
//   exports : `export default function NAME` | `export function/const/class NAME`
// All statements live at column 0; the regexes anchor to line-start (the `m`
// flag) so export/import text inside comments or strings is never rewritten.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const SRC = join(root, 'src');
const ENTRY = 'src/main.js';

// 1. Collect every source module keyed by its posix path relative to root.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const sources = {};
for (const abs of walk(SRC)) {
  const key = relative(root, abs).split(/[\\/]/).join('/');
  sources[key] = readFileSync(abs, 'utf8');
}

// Resolve a relative import specifier against the importing module's key.
const resolveKey = (fromKey, spec) =>
  posix.normalize(posix.join(posix.dirname(fromKey), spec));

// 2. Dependency graph (relative imports only) + validation.
const IMPORT_FROM = /^[ \t]*import\s+(?:[\s\S]*?)\s+from\s*['"]([^'"]+)['"];?/gm;
const deps = {};
const problems = [];
for (const [key, src] of Object.entries(sources)) {
  deps[key] = [];
  for (const m of src.matchAll(IMPORT_FROM)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const rk = resolveKey(key, spec);
    if (!(rk in sources)) problems.push(`  ${key} imports "${spec}" -> ${rk} (not found)`);
    else deps[key].push(rk);
  }
}
if (problems.length) {
  console.error('Unresolved imports — build aborted:\n' + problems.join('\n'));
  process.exit(1);
}

// 3. Topological sort (dependencies before dependents) with cycle detection.
const order = [];
const seen = {}; // 0 = visiting, 1 = done
(function topo() {
  function visit(key, stack) {
    if (seen[key] === 1) return;
    if (seen[key] === 0) {
      console.error(`Import cycle: ${[...stack, key].join(' -> ')}`);
      process.exit(1);
    }
    seen[key] = 0;
    for (const d of deps[key]) visit(d, [...stack, key]);
    seen[key] = 1;
    order.push(key);
  }
  for (const key of Object.keys(sources)) visit(key, []);
})();
if (!(ENTRY in sources)) {
  console.error(`Entry ${ENTRY} not found`);
  process.exit(1);
}

// 4. Transform one module's source into a registry factory body.
function transform(key, src) {
  const exportsList = []; // [exportedName, localName]
  let out = src;

  // Rewrite every import into a local binding pulled from the registry.
  out = out.replace(
    /^[ \t]*import\s+(?:(\w+)\s*,\s*)?(?:\{([\s\S]*?)\}|(\w+))?\s*from\s*['"]([^'"]+)['"];?/gm,
    (full, defA, named, defB, spec) => {
      const ref = `__reg[${JSON.stringify(resolveKey(key, spec))}]`;
      const lines = [];
      const def = defA || defB;
      if (def) lines.push(`const ${def} = ${ref}.default;`);
      if (named != null) {
        const binding = named
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.replace(/\s+as\s+/, ': '))
          .join(', ');
        if (binding) lines.push(`const { ${binding} } = ${ref};`);
      }
      return lines.join('\n');
    },
  );

  // Strip export keywords, recording what each module exposes.
  out = out.replace(/^[ \t]*export\s+default\s+function\s+(\w+)/gm, (m, n) => {
    exportsList.push(['default', n]);
    return `function ${n}`;
  });
  out = out.replace(/^[ \t]*export\s+function\s+(\w+)/gm, (m, n) => {
    exportsList.push([n, n]);
    return `function ${n}`;
  });
  out = out.replace(/^[ \t]*export\s+class\s+(\w+)/gm, (m, n) => {
    exportsList.push([n, n]);
    return `class ${n}`;
  });
  out = out.replace(/^[ \t]*export\s+const\s+(\w+)/gm, (m, n) => {
    exportsList.push([n, n]);
    return `const ${n}`;
  });

  const reg = exportsList
    .map(([k, v]) => `  __exports[${JSON.stringify(k)}] = ${v};`)
    .join('\n');

  return [
    `__reg[${JSON.stringify(key)}] = (function () {`,
    '  "use strict";',
    '  var __exports = {};',
    out,
    reg,
    '  return __exports;',
    '})();',
  ].join('\n');
}

const bundle = [
  '(function () {',
  '  "use strict";',
  '  var __reg = Object.create(null);',
  ...order.map((key) => transform(key, sources[key])),
  '})();',
].join('\n\n');

// 5. Inline CSS + the bundle into index.html (replace <link> and <script>).
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'styles.css'), 'utf8');

let out = html
  .replace(/\s*<link rel="stylesheet" href="styles\.css"\s*\/?>/, `\n  <style>\n${css}\n  </style>`)
  .replace(
    /\s*<script type="module" src="src\/main\.js"><\/script>/,
    `\n  <script>\n${bundle}\n  </script>`,
  );

const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
const outPath = join(dist, 'morphogen.html');
writeFileSync(outPath, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`✓ Built ${relative(root, outPath)} — ${kb} KB, ${order.length} modules bundled (classic script, file:// safe)`);
