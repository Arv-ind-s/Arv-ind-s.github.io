/*
  Wiring between the document and the sky behind it.

  The DOM is authoritative. Every catalogued object in the scene has exactly one
  row in the document, rows are real buttons and links, and the whole page works
  with the sky absent. The sky adds three things: it names the objects belonging
  to the section you are reading, it draws a leader line from a row to the object
  that row describes, and its objects can be clicked to reach the row.

  Nothing here reads layout during a frame. Anchor positions are measured on
  scroll and resize and cached; the per-frame callback only writes.
*/
import { initUniverse, setGroup, setActive, onHover, onSelect, onFrame, project, OBJECTS }
  from './universe.js';

const sky = initUniverse(document.getElementById('sky'));
const live = !!sky;

/*
  Whether the sky can be ANNOTATED is a question about available layout: below
  this width there is no clear band beside the copy to run a leader line into,
  and the same query hides the layer in CSS. It is watched rather than sampled,
  so resizing a window moves between the two states instead of stranding the
  page in whichever one it happened to load in.
*/
const roomy = matchMedia('(min-width: 901px)');

const rows = new Map();                // id -> row element
document.querySelectorAll('.row[data-id]').forEach((el) => rows.set(el.dataset.id, el));

const groupOf = (id) => OBJECTS.find((o) => o.id === id).group;
const first = {};                      // group -> id of its first object
OBJECTS.forEach((o) => { if (!(o.group in first)) first[o.group] = o.id; });

let group = null;                      // section being read
let pinned = {};                       // group -> the row that owns the leader line
let tethered = null;                   // id the line currently points at
let anchor = null;                     // cached {x, y} where the line leaves the row

/* --------------------------------------------------------- disclosure */

function setOpen(el, open) {
  const body = document.getElementById(el.getAttribute('aria-controls'));
  if (!body) return;
  body.classList.toggle('open', open);
  el.classList.toggle('open', open);
  el.setAttribute('aria-expanded', String(open));
}

rows.forEach((el, id) => {
  if (el.tagName === 'BUTTON') {
    el.addEventListener('click', () => {
      const open = el.getAttribute('aria-expanded') !== 'true';
      // one open at a time keeps the section scannable and the line unambiguous
      rows.forEach((other) => { if (other !== el && other.tagName === 'BUTTON') setOpen(other, false); });
      setOpen(el, open);
      pin(id, true);
      resettle(560);            // the rows below are in motion until then
    });
  }
  el.addEventListener('mouseenter', () => tether(id));
  el.addEventListener('focus', () => tether(id));
  el.addEventListener('mouseleave', () => restore());
  el.addEventListener('blur', () => tether(pinned[groupOf(id)]));
});

/* ------------------------------------------------------- the leader line */

const svg = document.getElementById('tethers');
const line = document.getElementById('tline');
const dot = document.getElementById('tdot');
const marks = document.getElementById('marks');
const markEls = new Map();

if (live) {
  OBJECTS.forEach((o) => {
    const row = rows.get(o.id);
    const el = document.createElement('div');
    el.className = 'mark' + (o.tone === 'gold' ? ' gold' : '');
    const name = document.createElement('b');
    name.textContent = row.dataset.mark || row.querySelector('.nm').textContent;
    el.appendChild(name);
    const tag = row.querySelector('.tag');
    if (tag && !row.dataset.mark) {
      const i = document.createElement('i');
      i.textContent = tag.textContent;
      el.appendChild(i);
    }
    marks.appendChild(el);
    markEls.set(o.id, el);
  });
}

/*
  Opening a disclosure moves every row below it, over the length of an
  animation. Rather than read layout on every frame forever, the anchor is
  re-measured only across the window in which it can actually be moving.
*/
let settleUntil = 0;
const resettle = (ms) => { settleUntil = performance.now() + ms; };

/* where the line leaves the copy column: the right edge of the row, mid-height */
function measure() {
  const el = tethered && rows.get(tethered);
  if (!el) { anchor = null; return; }
  const r = el.getBoundingClientRect();
  anchor = { x: r.right + 8, y: r.top + r.height / 2 };
}

function tether(id) {
  if (!live || !roomy.matches || !id || groupOf(id) !== group) {
    if (!id) { tethered = null; svg.classList.remove('on'); paint(); }
    return;
  }
  if (id !== tethered) {
    tethered = id;
    svg.classList.add('on');
    setActive(id, false);
    paint();
  }
  // Measured even when the target has not changed. Re-tethering the same row
  // after the list has reflowed — a disclosure opened above it, a keyboard
  // focus that did not scroll — must not keep the old anchor.
  measure();
}

/*
  What the line should point at when nothing is being hovered any more.

  A keyboard user's focus outranks the pinned row: a mouse left sitting over the
  canvas keeps reporting "hovering nothing", and without this that idle pointer
  drags the line off whatever row was just tabbed to.
*/
function restore() {
  const el = document.activeElement;
  const id = el && el.dataset ? el.dataset.id : null;
  tether(id && rows.has(id) && groupOf(id) === group ? id : pinned[group]);
}

function pin(id, pulse) {
  pinned[groupOf(id)] = id;
  tether(id);
  if (pulse) setActive(id, true);
}

function paint() {
  markEls.forEach((el, id) => {
    el.classList.toggle('lit', id === tethered);
  });
  rows.forEach((el, id) => el.classList.toggle('hot', id === tethered));
}

addEventListener('scroll', measure, { passive: true });
addEventListener('resize', measure, { passive: true });
roomy.addEventListener('change', () => { if (group) tether(pinned[group]); });

if (live) {
  onFrame(() => {
    if (!roomy.matches) return;
    if (performance.now() < settleUntil) measure();
    OBJECTS.forEach((o) => {
      const el = markEls.get(o.id);
      const p = project(o.id);
      const on = p && p.on && o.group === group;
      el.classList.toggle('on', !!on);
      if (on) el.style.transform = `translate(${p.x + 18}px, ${p.y}px) translateY(-50%)`;
    });

    const p = tethered && project(tethered);
    if (!p || !p.on || !anchor || !roomy.matches) { svg.classList.remove('on'); return; }
    svg.classList.add('on');
    line.setAttribute('x1', anchor.x); line.setAttribute('y1', anchor.y);
    line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
  });

  /* ----------------------------------------------------- sky -> document */
  onHover((id) => {
    if (id) tether(id);
    else restore();
  });

  onSelect((id) => {
    const el = rows.get(id);
    if (!el) return;
    if (el.tagName === 'A') { el.click(); return; }
    el.click();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

/* ------------------------------------------------ which section is read */

const navs = [...document.querySelectorAll('[data-nav]')];

function enter(name) {
  if (name === group) return;
  group = name;
  setGroup(name);
  navs.forEach((a) => a.classList.toggle('cur', a.dataset.nav === name));
  tethered = null;
  svg.classList.remove('on');
  if (!name) { paint(); return; }
  if (!pinned[name]) pinned[name] = first[name];
  tether(pinned[name]);
}

const plates = [...document.querySelectorAll('.plate[data-group]')];
const seen = new Set();

function settle() {
  if (!seen.size) return;
  const mid = innerHeight / 2;
  let best = null, bestD = Infinity;
  seen.forEach((el) => {
    const r = el.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < bestD) { bestD = d; best = el; }
  });
  enter(best.dataset.group);
}

const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target);
  });
  settle();
}, { rootMargin: '-42% 0px -42% 0px' });

plates.forEach((s) => io.observe(s));
new IntersectionObserver((es) => {
  es.forEach((e) => { if (e.isIntersecting) { seen.clear(); enter(null); } });
}, { threshold: 0.45 }).observe(document.querySelector('.hero'));

/* ------------------------------------------------- narrow-screen wash */

/*
  On a narrow screen the galaxy owns the first screen and then gets out of the
  way, because there the copy has to be read straight over it.

  This follows `roomy` — the same query the stylesheet uses — and NOT the scene's
  cheap/rich setting. Those answer different questions: cheap is about how much
  the device can afford to draw, this is about whether there is anywhere else for
  the text to go. A wide phone that renders the rich scene still needs the wash.

  One style write per frame, coalesced through rAF, and only while it changes.
*/
if (live) {
  const dimEl = document.querySelector('.dim');
  let queued = false, last = -1;
  const apply = () => {
    queued = false;
    const v = roomy.matches ? 0 : Math.min(1, scrollY / (innerHeight * 0.62)) * 0.88;
    if (Math.abs(v - last) < 0.004) return;
    last = v;
    dimEl.style.opacity = v.toFixed(3);
  };
  const kick = () => { if (queued) return; queued = true; requestAnimationFrame(apply); };
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick, { passive: true });
  roomy.addEventListener('change', kick);
  apply();
}

/* --------------------------------------------------------------- hint */

if (live) {
  const hint = document.getElementById('hint');
  setTimeout(() => hint.classList.add('show'), 1400);
  const drop = () => { hint.classList.add('gone'); document.getElementById('sky').removeEventListener('pointerdown', drop); };
  document.getElementById('sky').addEventListener('pointerdown', drop);
}
