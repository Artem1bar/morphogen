// main.js — boot Morphogen: build the registry, wire the UI, start the engine.

import { Registry } from './engine/registry.js';
import { Engine } from './engine/engine.js';
import { Gallery } from './ui/gallery.js';

// --- System registry -------------------------------------------------------
// Each system is a default-exported factory. Registration order is the order
// shown in the gallery. New systems are added with a single import + register.
import flowfield from './systems/flowfield.js';
import reactiondiffusion from './systems/reactiondiffusion.js';
import particlelife from './systems/particlelife.js';
import attractors from './systems/attractors.js';
import lsystem from './systems/lsystem.js';
import lenia from './systems/lenia.js';
import differentialgrowth from './systems/differentialgrowth.js';
import boids from './systems/boids.js';
import physarum from './systems/physarum.js';
import wavefunctioncollapse from './systems/wavefunctioncollapse.js';
import domainwarp from './systems/domainwarp.js';
import cyclic from './systems/cyclic.js';

const registry = new Registry();
for (const factory of [
  flowfield,
  domainwarp,
  reactiondiffusion,
  lenia,
  physarum,
  particlelife,
  boids,
  differentialgrowth,
  attractors,
  lsystem,
  wavefunctioncollapse,
  cyclic,
]) {
  try {
    registry.register(factory);
  } catch (e) {
    console.error('Failed to register a system:', e);
  }
}

// --- DOM ------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const canvas = $('#stage');
const paramRoot = $('#params');
const galleryRoot = $('#gallery');

const engine = new Engine({ canvas, paramRoot, registry });
const gallery = new Gallery(galleryRoot, registry.list(), (id) =>
  engine.setSystem(id),
);

// --- Toolbar wiring -------------------------------------------------------
const els = {
  systemName: $('#system-name'),
  systemBlurb: $('#system-blurb'),
  seedInput: $('#seed-input'),
  fps: $('#fps'),
  playIcon: $('#btn-play .icon'),
  recordBtn: $('#btn-record'),
  toast: $('#toast'),
};

$('#btn-gallery').addEventListener('click', () => gallery.toggle());
$('#btn-randomize-seed').addEventListener('click', () => engine.randomizeSeed());
$('#btn-randomize-params').addEventListener('click', () => engine.randomizeParams());
$('#btn-restart').addEventListener('click', () => engine.restart());
$('#btn-export').addEventListener('click', () => engine.exportPng());
$('#btn-step').addEventListener('click', () => engine.stepOnce());

$('#btn-play').addEventListener('click', () => {
  const running = engine.togglePlay();
  els.playIcon.textContent = running ? '❚❚' : '▶';
});

$('#btn-record').addEventListener('click', () => {
  const on = engine.toggleRecording();
  els.recordBtn.classList.toggle('recording', !!on);
  els.recordBtn.title = on ? 'Stop recording' : 'Record WebM';
});

$('#btn-share').addEventListener('click', async () => {
  const url = engine.shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast('Shareable link copied to clipboard');
  } catch {
    toast('Copy failed — URL is in the address bar');
  }
});

els.seedInput.addEventListener('change', () => {
  const v = els.seedInput.value.trim();
  if (v) engine.setSeed(v);
});

$('#btn-panel-toggle').addEventListener('click', () => {
  document.body.classList.toggle('panel-collapsed');
});

// --- Engine → UI ----------------------------------------------------------
engine.on('state', (s) => {
  if (!s.meta) return;
  els.systemName.textContent = s.meta.name;
  els.systemBlurb.textContent = s.meta.blurb || '';
  els.seedInput.value = s.seed;
  gallery.setActive(s.systemId);
  document.title = `Morphogen · ${s.meta.name}`;
});

engine.on('fps', (fps) => {
  els.fps.textContent = `${Math.round(fps)} fps`;
});

// --- Keyboard shortcuts ---------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
    return;
  }
  switch (e.key) {
    case ' ':
      e.preventDefault();
      $('#btn-play').click();
      break;
    case 'r':
      engine.randomizeParams();
      break;
    case 's':
      engine.randomizeSeed();
      break;
    case 'g':
      gallery.toggle();
      break;
    case 'e':
      engine.exportPng();
      break;
    case 'n':
      engine.restart();
      break;
    case '.':
      engine.stepOnce();
      break;
    default:
      break;
  }
});

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

// --- Go -------------------------------------------------------------------
engine.boot();
els.playIcon.textContent = '❚❚';

// Expose for automation / debugging (used by the verification screenshots).
globalThis.__morphogen = { engine, registry, gallery };
