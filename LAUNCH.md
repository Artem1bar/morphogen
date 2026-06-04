# Morphogen — launch playbook

> Owner notes for taking Morphogen public. Written by Claude, who built the thing.
> Live: https://morphogen-rho.vercel.app · Repo: https://github.com/Artem1bar/morphogen

---

## The story (the spine of everything)

It started as a dare with no constraints. Artem opened an empty folder, pointed
an AI agent (Claude) at it, and said *"spend 1 million tokens as you like."* No
spec — just a budget and permission.

I picked a studio of generative and artificial-life systems: the rare software
that's both genuinely deep (real algorithms — Gray–Scott reaction-diffusion,
Lenia, Reynolds' boids, slime-mould transport networks) and immediately,
viscerally pretty.

The bet was architectural: define ONE small interface — a system is just `meta`,
`params`, `init`, `step` — and if it's clean enough, a dozen different worlds can
be built independently and just plug in. So I hand-wrote the engine, fanned out a
fleet of parallel agents (each building one system against the locked contract,
each with a second agent reviewing and repairing its own work), ran an
adversarial review pass over all twelve, then opened every one in a real browser
and fixed what was actually wrong.

It wasn't clean the whole way. The grid systems shipped pixelated and I didn't
notice until Artem did — I'd verified "runs at 60fps" but never asked "does it
look good." And the single-file build the README bragged you could
"double-click to open offline" would have failed the instant anyone downloaded
it (blob-URL imports are blocked from a `file://` origin); I caught that before
it went public and rewrote the bundler to a classic-script module registry.

Everything is deterministic — every image rebuilds from a seed, which is why
every image is a URL. Zero dependencies, 58 tests, one engine, twelve worlds.
This is what fell out of a million tokens and the words "as you like."

**Why this story works:** specificity defeats "AI slop" skepticism. Don't sell
"an AI made art" (eye-roll). Sell "here's a genuinely-engineered thing an AI built
in one session — tests, determinism, the bugs the human had to catch." Lead with
the art; the build story is the second beat that makes people stay.

---

## Decisions (made, not options)

1. **Sequence: Twitter/X first, Show HN ~2 weeks later.** HN is a one-shot,
   high-variance channel — hit it when there's social proof (a corpus of
   beautiful shared creations) and the product has survived first contact. X
   builds that corpus and finds the early fans. Don't burn the HN shot on day 1.

2. **The bot is the content engine — build it.** Generative art *is* the
   marketing: a feed that posts a new reproducible creation a few times a day is
   a perpetual top-of-funnel, and every post is a remixable URL. This is the
   highest-leverage durable asset. See "The bot" below.

3. **Platform call: Bluesky bot first (maybe X too).** Bluesky's API is free and
   open and the generative-art/creative-coding crowd is there. X's posting API is
   paid (~$100/mo Basic) — only worth it if Artem already has access. Build the
   renderer once; post to both.

4. **Lead every channel with the story, tuned per audience.** X = thread with a
   clip per system. HN = "Show HN" + a short honest writeup (HN rewards candor
   about what broke). Reddit = one stunning loop + "every image is a URL."

---

## Pre-launch checklist (small, high-leverage)

- [x] OG card + `og:`/`twitter:` meta so links unfurl (shipped)
- [ ] **Curated opening seed** — first-time visitors should land on a hand-picked
      stunner, not the default. Pick ~3 gorgeous seeds per system; rotate one in
      as the boot state (or a `?showcase` that cycles them).
- [ ] **Social video loops** — 4–6s silent MP4 per system. Motion >> stills for
      generative art. Capture headless (see the bot renderer — same code path).
- [ ] **CONTRIBUTING.md: "add your own world."** The interface contract means a
      new system is one file. This is the community flywheel → forks → PRs → stars.
- [ ] Fix the minor panel-collapse layout quirk (canvas overshoots the viewport
      when the panel is collapsed on a short window). Low severity, but it's the
      one visible rough edge.
- [ ] Per-system OG images (optional) so a shared *flow-field* seed unfurls as a
      flow field. Static per-system covers it; per-*seed* would need an edge
      function (breaks the no-backend purity — skip for v1).

---

## Post drafts

### X / Bluesky — launch thread

**1/ (opener, with a 6s domain-warp or reaction-diffusion clip)**
> Morphogen — twelve generative & artificial-life worlds in one tiny engine.
>
> Flow fields, reaction–diffusion, Lenia, particle life, slime mold, strange
> attractors, boids…
>
> Tune anything. Every image is a URL you can share. Open source, zero deps.
> → morphogen-rho.vercel.app

**2/ (the story hook)**
> The backstory: I gave Claude a 1,000,000-token budget and the instruction
> "spend it as you like." No spec. This is what it chose to build — and how.

**3–8/** one reply per system, each a clip + one line + its shareable URL
(reaction–diffusion "coral grown from two chemicals", Lenia "lifeforms that
genuinely swim", physarum "slime mold solving a maze", etc.)

**9/ (the build)**
> One interface — meta/params/init/step — let a fleet of parallel agents each
> build a world that just plugs in. Adversarial review, browser-verified,
> deterministic, 58 tests. The bugs it shipped (and I caught) are in the README's
> honest version.

**10/ (CTA)**
> It's open source and runs offline as a single file. Add your own world in one
> file. Make something, copy the URL, show me. → github.com/Artem1bar/morphogen

### Show HN (run ~2 weeks in)

**Title:** `Show HN: I gave an AI a 1M-token budget and it built a generative-art studio`

**First comment:**
> I handed Claude an empty folder and "spend 1M tokens as you like." It chose to
> build Morphogen: 12 generative/artificial-life systems (reaction–diffusion,
> Lenia, boids, slime mold, strange attractors, WFC…) behind one engine.
>
> Technically interesting bits: one small system interface let a fleet of
> parallel agents each build a world independently; everything's deterministic so
> every render is a shareable URL; zero dependencies; it bundles into a single
> classic-script HTML that opens offline (the blob-URL build I tried first is
> blocked from file:// — fun bug). 58 tests on the deterministic core.
>
> It also shipped real flaws I had to catch — the grids were pixelated and I'd
> only checked framerate, not whether it looked good. Honest writeup + code in the
> repo. Happy to talk architecture or the agent-orchestration.

### Reddit (r/generative, r/creativecoding, r/proceduralgeneration)

> **Morphogen — 12 generative systems in one open-source engine, every image is a URL**
> Built (mostly by an AI agent on a token budget) as a single deterministic
> studio. Drag to interact, tune anything, share the seed. Would love a 13th
> system from anyone — it's one file. [link]

---

## The bot (the durable content engine)

**Goal:** a feed (@morphogen on Bluesky, optionally X) that posts a fresh,
reproducible Morphogen creation a few times a day, each with its remixable URL.

**Elegant zero-infra path — a GitHub Actions cron in this repo:**

1. A workflow runs on a schedule (e.g. every 6h).
2. It uses Playwright to load the live site at a randomly-chosen
   `#sys=…&seed=…` (curate a pool of system × seed × palette that look great),
   waits for the system to develop, and captures a PNG + a short MP4
   (record the canvas, or stitch frames).
3. It posts the media + a one-liner + the deep link via the platform API
   (Bluesky `@atproto/api` is free; X needs paid API creds in repo secrets).
4. Determinism means the posted URL recreates the exact frame — the post IS a
   playable link.

**Why this is the right shape:** it lives in the repo (no server to run/pay for),
the renderer is the same code that makes the social video loops above, and it
turns the project into a self-marketing machine. Build the Bluesky version first
(free), add X if Artem has API access.

**Build notes for whoever picks this up:**
- New dir `bot/`: `render.mjs` (Playwright capture), `post-bsky.mjs`, a curated
  `seeds.json`, and `.github/workflows/bot.yml` (cron).
- Keep API tokens in GitHub Actions secrets, never in the repo.
- Start manual-trigger (`workflow_dispatch`) to test, then enable the cron.
- Stretch: a reply bot — mention it a system name and it replies with a render.

---

## Immediate next action (my call)

Ship the **X/Bluesky launch thread this week** to start the flywheel, and build
the **Bluesky bot** as the content engine. Curate ~3 gorgeous seeds per system
first (they anchor the thread, the bot, and the curated opening). Hold Show HN
until there's a body of shared creations to point at.

---

## Mobile (needs a real device — do this as a focused session)

Most launch traffic will be mobile, so this matters. Layout is already
responsive (canvas on top, controls as a bottom sheet) and touch works (pointer
events + `touch-action: none`). **Shipped quick wins:** lower DPR cap on phones
(`canvas.js`), and a touch-device CSS block (bigger tap targets, no keyboard
legend). The real work below needs validation on actual hardware — it can't be
measured in a desktop headless browser.

**The big one — per-device performance scaling.** The grid systems are tuned for
desktop; on a phone CPU, Lenia (convolution), reaction–diffusion (multi-step),
and domain-warp (5 fBm/px) are likely sluggish. The clean fix:

1. Add a `quality` scalar to the engine's SystemContext — `1.0` on desktop, lower
   on phones (derive from `min(innerW, innerH)` and `matchMedia('(pointer:coarse)')`;
   target ~0.6). Build it once in `engine.js` next to `dpr`.
2. Have each grid system size its sim buffer from that scalar instead of a hard
   constant: `Math.round(BASE * c.quality)` for `SIM`/`GW`/`SIZE`/`TW`/`MAXDIM`/
   `DW`, and scale particle/agent counts (flowfield, boids, particlelife,
   physarum) the same way. Gate so desktop stays byte-for-byte as it is now
   (zero regression risk to the verified desktop build).
3. **Validate on a real phone** (or BrowserStack / a Vercel preview opened on a
   device): walk all 12, watch the fps meter, tune the scalar per system until
   the heavy three hold ~30fps. This is the step that can't be skipped or faked.

**Other mobile polish:**
- Fix the panel-collapse layout quirk (canvas overshoots the viewport) — it's
  more visible on mobile orientation changes.
- Re-test orientation changes (the ResizeObserver should re-init; confirm no
  black frame on rotate).
- Consider a "tap to reveal controls" so the canvas can go full-bleed on a phone
  (the art is the point; the panel eats ~42vh).
- Pinch-zoom: `touch-action: none` on the canvas handles drag, but verify a
  two-finger pinch over the canvas doesn't zoom the page mid-interaction.
- iOS Safari: confirm `100vh` doesn't jump with the URL bar (use `100dvh` /
  `-webkit-fill-available` if it does); `viewport-fit=cover` is already set.

**Why deferred:** mobile performance is the kind of thing you cannot honestly
sign off without a real device, and pushing unverified perf changes straight to a
live public site is the wrong move. Do it as a focused pass with a phone in hand.
