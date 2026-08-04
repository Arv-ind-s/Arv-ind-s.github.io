/*
  Wiring between the document and the network behind it.

  The DOM is authoritative: every node has exactly one twin row in .keys, and
  all of them are real buttons/links that work with the network absent. The
  network adds three things — it emphasises the layer you're reading, it echoes
  hover in both directions, and its nodes select content when clicked.
*/
import { initNetwork, focusLayer, setSelected, onHover, onClick, onFrame, projectColumn, LAYER_SIZES } from './network-scene.js';

const LAYER_LABEL = ['Input', 'Hidden₁ — Weights', 'Hidden₂ — Activations', 'Output'];
const live = initNetwork(document.getElementById('fig'));

const figNote = document.getElementById('figNote');
const figHint = document.getElementById('figHint');
const axes = [...document.querySelectorAll('.axis')];
const navs = [...document.querySelectorAll('[data-nav]')];

/* twins[layer][idx] -> element */
const twins = [0, 1, 2, 3].map((l) =>
  [...document.querySelectorAll(`.keys[data-keys="${l}"] .key`)].sort((a, b) => a.dataset.idx - b.dataset.idx)
);
const selectedIdx = [0, 0, 0, 0];
let activeLayer = 0;

function select(layer, idx) {
  selectedIdx[layer] = idx;
  twins[layer].forEach((el, i) => el.classList.toggle('on', i === idx));
  document.querySelectorAll(`[data-detail^="${layer}-"]`).forEach((d) => {
    d.classList.toggle('on', d.dataset.detail === `${layer}-${idx}`);
  });
  if (live) setSelected(layer, idx);
}

twins.forEach((group, layer) => {
  group.forEach((el, idx) => {
    // anchors (the output layer) must still navigate
    if (el.tagName !== 'A') el.addEventListener('click', () => select(layer, idx));
  });
});
[0, 1, 2, 3].forEach((l) => select(l, 0));

/* ---------- network -> document ---------- */
if (live) {
  onHover((layer, idx) => {
    document.querySelectorAll('.key.hot').forEach((el) => el.classList.remove('hot'));
    if (layer === null) { figHint.textContent = 'drag to rotate'; return; }
    const el = twins[layer][idx];
    if (el) {
      el.classList.add('hot');
      figHint.textContent = `unit ${layer}.${idx} — ${LAYER_LABEL[layer]}`;
    }
  });

  onClick((layer, idx) => {
    const el = twins[layer][idx];
    if (!el) return;
    if (el.tagName === 'A') { el.click(); return; }
    select(layer, idx);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  /* axis labels ride the projected column positions every frame */
  onFrame(() => {
    axes.forEach((el, i) => {
      const p = projectColumn(i);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.classList.toggle('on', i === activeLayer);
    });
  });
}

/* ---------- which layer is being read ---------- */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    e.target.classList.toggle('on', e.isIntersecting);
    if (!e.isIntersecting) return;
    activeLayer = +e.target.dataset.layer;
    if (live) focusLayer(activeLayer);
    navs.forEach((a) => a.classList.toggle('cur', +a.dataset.nav === activeLayer));
    const n = LAYER_SIZES[activeLayer];
    figNote.textContent = `L${activeLayer} · ${LAYER_LABEL[activeLayer]} · ${n} units`;
  });
}, { rootMargin: '-45% 0px -45% 0px' });
document.querySelectorAll('.cap-sec').forEach((s) => io.observe(s));

/* the opening shows the whole network, un-emphasised */
if (live) {
  new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting) return;
      activeLayer = -1;                     // no axis label highlighted at rest
      focusLayer(-1);
      navs.forEach((a) => a.classList.remove('cur'));
      figNote.textContent = 'Fig. 1 — forward pass · 4 layers · 15 units';
    });
  }, { threshold: 0.4 }).observe(document.querySelector('.opening'));
}
