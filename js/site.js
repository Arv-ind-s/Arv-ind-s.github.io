/*
  Wiring between the document and the sky behind it.

  The page is a voyage: a run of full-screen chapters, each of which sends the
  camera to a destination in the galaxy. The DOM is authoritative — every entry
  is a real link or a plain block, and the whole page reads with the sky absent.
  The sky adds three things: it names the objects that belong to the chapter
  being read, it draws a leader line from an entry to its object, and its
  objects can be clicked to reach their entry.

  An object can belong to more than one chapter: each project's star appears in
  the index and again at its own destination. So entries are keyed by chapter
  AND object, never by object alone.

  Nothing here reads layout during a frame. Anchor positions are measured on
  scroll and resize and cached; the per-frame callback only writes.
*/
import { initUniverse, setGroup, setActive, onHover, onSelect, onFrame, project, onMedia, setAnchors, OBJECTS }
  from './universe.js';

const sky = initUniverse(document.getElementById('sky'));
/* a still scene is a backdrop, not something to annotate or track */
const live = !!sky && !sky.still;

/*
  <body class="flat"> paints a deep field in pure CSS: the ground everything
  falls back to when there is no scene. Once a real scene is drawing, it goes.
*/
if (sky) document.body.classList.remove('flat');

/*
  Whether the sky can be ANNOTATED is a question about available layout: below
  this width there is no clear side to run a leader line into, and the same
  query hides the layer in CSS. Watched, not sampled.
*/
const roomy = matchMedia('(min-width: 901px)');

/* ------------------------------------------------------------ chapters */

const chapters = [...document.querySelectorAll('.chapter[data-group]')];
const chapterOf = new Map(chapters.map((c) => [c.dataset.group, c]));

/* entries, keyed `${chapter}:${object}`; firstOf[chapter] is the entry each
   chapter opens tethered to — the first one on the page, in reading order */
const rows = new Map();
const firstOf = {};
chapters.forEach((c) => {
  c.querySelectorAll('.row[data-id]').forEach((el) => {
    const key = `${c.dataset.group}:${el.dataset.id}`;
    rows.set(key, el);
    if (!(c.dataset.group in firstOf)) firstOf[c.dataset.group] = el.dataset.id;
  });
});

const objOf = (id) => OBJECTS.find((o) => o.id === id);
const belongs = (id, g) => { const o = objOf(id); return !!(o && o.groups.includes(g)); };

let group = null;                      // the chapter being read
const pinned = {};                     // chapter -> the entry that owns the line
let tethered = null;                   // object the line currently points at
let anchor = null;                     // cached {x, y} where the line leaves its entry

rows.forEach((el, key) => {
  const id = key.split(':')[1];
  el.addEventListener('mouseenter', () => tether(id));
  el.addEventListener('focus', () => tether(id));
  el.addEventListener('mouseleave', () => restore());
  el.addEventListener('blur', () => restore());
});

/* ------------------------------------------------------- the leader line */

const svg = document.getElementById('tethers');
const line = document.getElementById('tline');
const dot = document.getElementById('tdot');
const marks = document.getElementById('marks');
const markEls = new Map();

if (live) {
  OBJECTS.forEach((o) => {
    // the object's name comes from its first entry on the page
    const row = document.querySelector(`.row[data-id="${o.id}"]`);
    if (!row) return;
    const el = document.createElement('div');
    el.className = 'mark' + (o.tone === 'gold' ? ' gold' : '');
    const name = document.createElement('b');
    name.textContent = row.dataset.mark || (row.querySelector('.nm, h2') || {}).textContent || o.id;
    el.appendChild(name);
    // the line under the name: an explicit data-sub, else the entry's tag —
    // unless the name already IS the tag (contact entries), where it would repeat
    const tag = row.querySelector('.tag');
    const sub = row.dataset.sub ?? (tag && !row.dataset.mark ? tag.textContent : '');
    if (sub) {
      const i = document.createElement('i');
      i.textContent = sub;
      el.appendChild(i);
    }
    marks.appendChild(el);
    markEls.set(o.id, el);
  });
}

/* Where the line leaves its entry: the edge that faces the star. Panels on the
   left send it from their right edge; panels on the right, from their left. */
function measure() {
  const el = tethered && rows.get(`${group}:${tethered}`);
  if (!el) { anchor = null; return; }
  const r = el.getBoundingClientRect();
  const right = (chapterOf.get(group) || {}).dataset?.side === 'right';
  anchor = { x: right ? r.left - 8 : r.right + 8, y: r.top + Math.min(r.height / 2, 28) };
}

function tether(id) {
  if (!live || !roomy.matches || !id || !belongs(id, group) || !rows.has(`${group}:${id}`)) {
    if (!id) { tethered = null; svg.classList.remove('on'); paint(); }
    return;
  }
  if (id !== tethered) {
    tethered = id;
    svg.classList.add('on');
    setActive(id, false);
    paint();
  }
  // measured even when unchanged: re-tethering the same entry after anything
  // has moved must not keep the old anchor
  measure();
}

/*
  What the line points at when nothing is hovered. Keyboard focus outranks the
  pinned entry: a mouse left idle over the canvas keeps reporting "hovering
  nothing", and without this it drags the line off whatever was just tabbed to.
*/
function restore() {
  const el = document.activeElement;
  const id = el && el.dataset ? el.dataset.id : null;
  tether(id && rows.has(`${group}:${id}`) ? id : pinned[group]);
}

function paint() {
  markEls.forEach((el, id) => el.classList.toggle('lit', id === tethered));
  rows.forEach((el, key) => el.classList.toggle('hot', key === `${group}:${tethered}`));
}

addEventListener('scroll', measure, { passive: true });
addEventListener('resize', measure, { passive: true });
onMedia(roomy, () => { if (group) tether(pinned[group]); });

if (live) {
  onFrame(() => {
    if (!roomy.matches) return;
    OBJECTS.forEach((o) => {
      const el = markEls.get(o.id);
      if (!el) return;
      const p = project(o.id);
      const on = p && p.on && o.groups.includes(group);
      el.classList.toggle('on', !!on);
      if (on) el.style.transform = `translate(${p.x + 18}px, ${p.y}px) translateY(-50%)`;
    });

    const p = tethered && project(tethered);
    /*
      The camera carries objects in and out of view, so the highlight on the
      tethered entry and its star's name follows visibility every frame, in BOTH
      directions; only ever clearing it stranded the return trip.
    */
    if (tethered) {
      const seen = !!(p && p.on);
      const row = rows.get(`${group}:${tethered}`);
      if (row) row.classList.toggle('hot', seen);
      const mk = markEls.get(tethered);
      if (mk) mk.classList.toggle('lit', seen);
    }
    if (!p || !p.on || !anchor) { svg.classList.remove('on'); return; }
    svg.classList.add('on');
    line.setAttribute('x1', anchor.x); line.setAttribute('y1', anchor.y);
    line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
  });

  /* ----------------------------------------------------- sky -> document */
  onHover((id) => { if (id) tether(id); else restore(); });

  // Clicking a star does what clicking its entry does. In the index that is a
  // link to the star's own chapter — so the click sends the camera there.
  onSelect((id) => {
    const el = rows.get(`${group}:${id}`);
    if (el && el.tagName === 'A') el.click();
    else if (el) setActive(id, true);
  });
}

/* --------------------------------------------- where the chapters are ---
   The scene flies to each chapter's destination as that chapter is read, so it
   is told where each chapter falls along the scroll. Measured on load, resize
   and font load only. */

function anchorChapters() {
  if (!live) return;
  const span = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const map = {};
  chapters.forEach((el) => {
    map[el.dataset.group] =
      Math.min(1, Math.max(0, (el.offsetTop + el.offsetHeight / 2 - innerHeight / 2) / span));
  });
  setAnchors(map);
}
anchorChapters();
addEventListener('resize', anchorChapters, { passive: true });
/* the faces load with display=swap; when they arrive, line heights change and
   every chapter moves — a one-time event, so re-measuring here is safe */
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { anchorChapters(); measure(); });
}

/* ------------------------------------------------ which chapter is read */

const navs = [...document.querySelectorAll('[data-nav]')];

function enter(name) {
  if (name === group) return;
  group = name;
  setGroup(name);
  const ch = chapterOf.get(name);
  // the veil darkens the panel's side; project chapters light "Work" in the nav
  document.body.dataset.side = (ch && ch.dataset.side) || 'left';
  const navAs = (ch && ch.dataset.navAs) || name;
  navs.forEach((a) => a.classList.toggle('cur', a.dataset.nav === navAs));
  tethered = null;
  svg.classList.remove('on');
  if (!(name in pinned)) pinned[name] = firstOf[name] || null;
  if (pinned[name]) tether(pinned[name]); else paint();
}

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

// every chapter is observed: one left unobserved would leave the previous
// chapter active, its line pinned to an entry scrolled off-screen
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); });
  settle();
}, { rootMargin: '-42% 0px -42% 0px' });
chapters.forEach((c) => io.observe(c));

/* --------------------------------------------------------------- hint */

if (live) {
  const hint = document.getElementById('hint');
  const skyEl = document.getElementById('sky');
  setTimeout(() => hint.classList.add('show'), 1400);
  const drop = () => { hint.classList.add('gone'); skyEl.removeEventListener('pointerdown', drop); };
  skyEl.addEventListener('pointerdown', drop);
}
