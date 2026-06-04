export const meta = {
  name: 'morphogen-review-systems',
  description: 'Adversarially review each generated system for correctness/perf/determinism bugs, patch it, then independently verify the patch.',
  phases: [
    { title: 'Review', detail: 'a skeptical reviewer hunts real bugs and proposes a corrected file' },
    { title: 'Verify', detail: 'an independent agent confirms each finding is real and the patch is contract-safe' },
  ],
};

// `args` is an array of { id, code } passed in by the orchestrator (the main
// loop reads the on-disk system files and hands them over). This keeps the
// review decoupled from the filesystem and reviewing exactly what shipped.
const systems = Array.isArray(args) ? args : [];

const CONTRACT = [
  'MORPHOGEN SYSTEM INTERFACE CONTRACT (the code under review must obey this):',
  'A system file default-exports create() -> { meta:{id,name,blurb,category}, params:[ParamSpec], init(c), step(c), onPointer?(c,type), dispose?() }.',
  'ParamSpec = { key, label, type(range|int|toggle|select|color), default, min?,max?,step?, options?, hint?, structural? }.',
  'SystemContext c = { ctx (dpr transform applied -> draw in LOGICAL px), width, height, pixelWidth, pixelHeight, dpr,',
  '  rng (seeded: next/range/int/chance/pick/gaussian/unitVector), noise (seeded: noise2D/noise3D/fbm2D/fbm3D),',
  '  seed, time, dt, frame, params (read live), pointer{x,y,px,py,down}, clear(alpha), background }.',
  'May import ONLY from ../engine/color.js (sampleCss,sample,ramp,PALETTES,PALETTE_NAMES),',
  '  ../engine/mathx.js (clamp,lerp,remap,wrap,TAU,vec,... ), ../engine/prng.js (Rng), ../engine/noise.js (Noise).',
].join('\n');

const RUBRIC = [
  'Hunt ONLY for real defects. Be specific and adversarial. Priorities:',
  ' - CONTRACT: missing/!default export; wrong imports; wrong param shapes; not reading params live; size params not structural.',
  ' - CORRECTNESS: putImageData onto c.ctx instead of an offscreen canvas (mis-scales under dpr); off-by-one / out-of-bounds buffer',
  '   indexing; bad toroidal wrap; NaN from divide-by-zero or log(0); uninitialized buffers; swapped buffers not actually swapped.',
  ' - DETERMINISM: any Math.random() or Date-based entropy (must use c.rng).',
  ' - PERFORMANCE: allocations inside the per-frame hot loop; O(n^2) neighbor scans without a spatial grid at large n; sim buffer',
  '   sized to device pixels instead of a fixed cap (will tank fps on big screens).',
  ' - ROBUSTNESS: throws when c.width/c.height is 0; assumes a square canvas; unbounded growth (no cap on nodes/points).',
  'Do NOT invent style nits or speculative issues. If the file is correct, say so.',
].join('\n');

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          area: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'area', 'issue', 'fix'],
      },
    },
    changed: { type: 'boolean', description: 'true if patchedCode differs from the input' },
    patchedCode: { type: 'string', description: 'the COMPLETE corrected file (no fences). If nothing needs fixing, return the input unchanged.' },
  },
  required: ['id', 'findings', 'changed', 'patchedCode'],
};

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    safe: { type: 'boolean', description: 'true if finalCode is contract-compliant and an improvement (or equal) — safe to ship.' },
    realFindings: { type: 'integer', description: 'how many of the proposed findings are genuine bugs (not false positives).' },
    notes: { type: 'string' },
    finalCode: { type: 'string', description: 'the code to ship (no fences): the patch if good, else the original. Must be complete and runnable.' },
  },
  required: ['id', 'safe', 'realFindings', 'notes', 'finalCode'],
};

function reviewPrompt(sys) {
  return [
    'You are a skeptical senior reviewer auditing one Morphogen system: "' + sys.id + '".',
    CONTRACT, '', RUBRIC, '',
    'Return findings AND a complete corrected file in patchedCode (unchanged if already correct).',
    'Set changed=false only if patchedCode is byte-identical to the input.',
    '', '================ FILE UNDER REVIEW (src/systems/' + sys.id + '.js) ================',
    sys.code,
  ].join('\n');
}

function verifyPrompt(sys, review) {
  return [
    'Independently verify a proposed patch for the Morphogen system "' + sys.id + '".',
    'You did not write the patch. Confirm each finding is a REAL bug (reject false positives), and confirm the patch is',
    'contract-compliant and does not introduce regressions. Then choose finalCode: the patch if it is a genuine improvement',
    'and correct, otherwise the ORIGINAL. finalCode must be complete and runnable (no fences).',
    CONTRACT, '',
    '================ ORIGINAL ================', sys.code, '',
    '================ PROPOSED FINDINGS ================',
    JSON.stringify(review.findings, null, 2), '',
    '================ PROPOSED PATCH ================', review.patchedCode,
  ].join('\n');
}

// The Workflow runtime executes this body as an async function, so the
// top-level `return`s below are the workflow's results. We keep that body
// inside an explicit `run()` so the file is ALSO a valid ES module (parses
// under `node --check`); the workflow globals (agent, pipeline, log, args)
// are injected by the runtime.
export default async function run() {
  if (!systems.length) {
    log('No systems passed in args; nothing to review.');
    return [];
  }

  log('Adversarially reviewing ' + systems.length + ' systems (review -> verify)…');

  const results = await pipeline(
    systems,
    (sys) => agent(reviewPrompt(sys), { label: 'review:' + sys.id, phase: 'Review', schema: REVIEW_SCHEMA, agentType: 'code-reviewer' })
      .then((r) => ({ ...r, _sys: sys })),
    (review, sys) =>
      review
        ? agent(verifyPrompt(sys, review), { label: 'verify:' + sys.id, phase: 'Verify', schema: VERIFY_SCHEMA })
            .then((v) => ({
              id: sys.id,
              findings: review.findings || [],
              changed: review.changed && v.safe,
              safe: v.safe,
              realFindings: v.realFindings,
              notes: v.notes,
              finalCode: v.finalCode,
            }))
        : null,
  );

  const ok = results.filter(Boolean);
  const totalFindings = ok.reduce((n, r) => n + (r.findings ? r.findings.length : 0), 0);
  const realFindings = ok.reduce((n, r) => n + (r.realFindings || 0), 0);
  log('Reviewed ' + ok.length + ' systems; ' + realFindings + '/' + totalFindings + ' findings confirmed real.');

  return ok;
}
