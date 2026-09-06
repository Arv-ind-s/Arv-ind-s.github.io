/*
  The universe behind the document.

  Design rules — these were arrived at painfully, don't "improve" them away:

  - ONE camera framing, for the whole page. An earlier version of this site flew
    the camera between sections and it cost scroll performance and, worse, made
    the annotation lines impossible to draw: you can't tether a caption to a star
    that is drifting, clipped, or behind the camera. Section changes are carried
    by COLOUR and by which objects are named — never by moving the camera.
  - The galaxy is ambient. The eleven NAMED objects are the content, and they are
    placed to project into the clear right-hand region of the viewport where no
    copy sits. Everything else is atmosphere.
  - Hit-testing is done in screen space, on the projected positions we already
    compute every frame for the tethers. No raycaster, no invisible pick meshes.
  - Everything is additively blended with depthTest off, so draw order never
    matters and there is nothing to sort. Depth is carried by a near/far alpha
    fade in the vertex shader instead of fog.
*/
import * as THREE from '../vendor/three/three.module.min.js';

/* ---------------------------------------------------------------- palette */

const CORE_HOT   = new THREE.Color(0xfff0d2);  // galactic core, near-white gold
const CORE_GOLD  = new THREE.Color(0xffb45c);  // dust-lane gold
const ARM_BLUE   = new THREE.Color(0x7ba7ff);  // population-I blue-white
const ARM_FAR    = new THREE.Color(0x3a4b96);  // cold outer arms

const STAR_LIT   = new THREE.Color(0xdfe7ff);
const STAR_DIM   = new THREE.Color(0x2b3358);
const STAR_GOLD  = new THREE.Color(0xffb45c);
const STAR_HOT   = new THREE.Color(0xffffff);

/*
  The named objects — the catalogue.

  These are authored in SCREEN space (`ndc`, -1..1) and unprojected into world
  space at the resting camera, because where they land on screen is a layout
  decision: they have to sit in the clear band right of the copy column, in the
  same vertical order as the entries that tether to them, with room to the right
  edge for a name. Solving that in world coordinates means re-solving it for
  every aspect ratio. `depth` is distance from the camera, and it is the only
  part that is genuinely spatial: it spaces them through the volume so a drag
  moves them against each other with real parallax.

  `tone: 'gold'` is reserved for the one thing that is live in the world.
*/
export const OBJECTS = [
  { id: 'thought2build', group: 'work',   ndc: [ 0.24,  0.50 ], depth: 16.0, tone: 'gold' },
  { id: 'nexus',         group: 'work',   ndc: [ 0.48,  0.10 ], depth: 21.0 },
  { id: 'moderation',    group: 'work',   ndc: [ 0.20, -0.36 ], depth: 17.5 },

  { id: 'language',      group: 'stack',  ndc: [ 0.18,  0.60 ], depth: 16.5 },
  { id: 'ml',            group: 'stack',  ndc: [ 0.44,  0.33 ], depth: 20.0 },
  { id: 'genai',         group: 'stack',  ndc: [ 0.52, -0.04 ], depth: 22.5 },
  { id: 'cloud',         group: 'stack',  ndc: [ 0.34, -0.38 ], depth: 19.0 },
  { id: 'serve',         group: 'stack',  ndc: [ 0.13, -0.64 ], depth: 15.5 },

  { id: 'email',         group: 'signal', ndc: [ 0.23,  0.44 ], depth: 17.0 },
  { id: 'linkedin',      group: 'signal', ndc: [ 0.49,  0.04 ], depth: 21.0 },
  { id: 'github',        group: 'signal', ndc: [ 0.19, -0.42 ], depth: 17.5 },
];

/* ------------------------------------------------------------------ state */

let canvas, renderer, scene, camera;
let galaxy, dust, bulge, starfield, coreGlow, nebulae = [], namedStars, links, ripple;
let cheap = false, still = false, running = true, alive = false;
/* device pixel ratio actually used, and the running check that lowers it */
let pxCap = 2, watchN = 0, watchSum = 0;
let group = null, activeId = null, hoverId = null;
let hoverCbs = [], selectCbs = [], frameCbs = [];

/* camera: a fixed base orientation plus a small, bounded, springy user offset */
const BASE_AZ = -0.30, BASE_POL = 1.06;   // polar measured from +Y
let dragAz = 0, dragPol = 0, targetAz = 0, targetPol = 0;
let parX = 0, parY = 0, targetParX = 0, targetParY = 0;
let dist = 27, targetPt = new THREE.Vector3();
let dragging = false, lastPtr = null, travelled = 0;

const pointer = { x: -9999, y: -9999, inside: false };
/* wide enough to turn the object without the copy sitting on top of it */
const roomy = matchMedia('(min-width: 901px)');
/* Safari only gained addEventListener on MediaQueryList in 14 */
export function onMedia(mq, fn) {
  if (mq.addEventListener) mq.addEventListener('change', fn);
  else if (mq.addListener) mq.addListener(fn);
}
const projected = new Map();               // id -> {x, y, z, on}
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

/* --------------------------------------------------------------- textures */

/* soft radial falloff — the workhorse glow */
function glowTexture(stops) {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  stops.forEach(([at, col]) => g.addColorStop(at, col));
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

/*
  A named star is drawn the way a telescope actually records one: a hot core
  with four diffraction spikes. It is what separates "a catalogued object" from
  "one more particle in the cloud".
*/
function starTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d'), h = s / 2;

  const g = ctx.createRadialGradient(h, h, 0, h, h, h * 0.34);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);

  ctx.translate(h, h);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    const spike = ctx.createLinearGradient(0, 0, 0, -h);
    spike.addColorStop(0, 'rgba(255,255,255,.85)');
    spike.addColorStop(0.12, 'rgba(255,255,255,.30)');
    spike.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spike;
    ctx.beginPath();
    ctx.moveTo(-2.2, 0); ctx.lineTo(0, -h); ctx.lineTo(2.2, 0);
    ctx.closePath(); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

/*
  Nebula is baked into a texture ONCE rather than evaluated as noise per frame.
  Large additive quads are fill-bound; paying for them every frame at retina
  pixel ratios is the most expensive thing this scene could do, and it buys
  nothing you can see.
*/
function nebulaTexture(seed) {
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  let rnd = seed;
  const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.55) * s * 0.42;
    const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
    const rad = (0.06 + rand() * 0.20) * s;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.05 + rand() * 0.05})`);
    g.addColorStop(0.5, 'rgba(255,255,255,.018)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  // hold the cloud inside a soft disc so the quad's edges never show
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.55, 'rgba(0,0,0,.85)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

/* ----------------------------------------------------------- the galaxy */

const GAL_R = 10.5;
const ARMS = 2;
const WIND = 0.62;          // radians of sweep per world unit of radius

/*
  Shared shader for the star cloud. Rotation, twinkle and the depth fade all
  happen on the GPU from a single time uniform, so an idling frame costs one
  uniform write and nothing else on the CPU.
*/
const CLOUD_VERT = /* glsl */`
  uniform float uTime, uSize, uPixelRatio, uNear, uFar;
  attribute float aSize, aPhase, aSpin;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    // differential rotation: the inner disc turns faster, as a real one does.
    // Kept slow enough that the arms never visibly shear apart.
    float ang = uTime * aSpin;
    float s = sin(ang), c = cos(ang);
    vec3 p = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float twinkle = 0.72 + 0.28 * sin(uTime * 1.7 + aPhase);
    gl_PointSize = uSize * aSize * twinkle * uPixelRatio * (24.0 / max(depth, 0.001));
    vAlpha = 1.0 - smoothstep(uNear, uFar, depth);
    gl_Position = projectionMatrix * mv;
  }`;

const CLOUD_FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    // squared falloff reads as a glow rather than a disc, and overlapping
    // grains accumulate into bloom without any post-processing pass
    float a = 1.0 - d * 2.0;
    a *= a;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }`;

function cloudMaterial(size) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSize: { value: size },
      uPixelRatio: { value: Math.min(2, devicePixelRatio || 1) },
      uNear: { value: 12 }, uFar: { value: 42 },
    },
    vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, vertexColors: true,
  });
}

/* normal-ish scatter: uniform noise gives arms with hard, obviously random
   edges, where a summed distribution gives a dense spine that falls off */
function bell() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

/* the stellar population ramp, shared by every cloud so they read as one body */
function tint(f) {
  if (f < 0.16) tmpC.copy(CORE_HOT);
  else if (f < 0.42) tmpC.copy(CORE_HOT).lerp(CORE_GOLD, (f - 0.16) / 0.26);
  else if (f < 0.72) tmpC.copy(CORE_GOLD).lerp(ARM_BLUE, (f - 0.42) / 0.30);
  else tmpC.copy(ARM_BLUE).lerp(ARM_FAR, (f - 0.72) / 0.28);
  if (Math.random() < 0.045) tmpC.lerp(CORE_GOLD, 0.8);   // scattered red giants
  return tmpC;
}

function packCloud(count, write, mat) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const pha = new Float32Array(count);
  const spn = new Float32Array(count);
  for (let i = 0; i < count; i++) write(i, pos, col, siz, pha, spn);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
  geo.setAttribute('aSpin', new THREE.BufferAttribute(spn, 1));
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

/* the disc: two grand-design arms, plus a minority of unbound field stars */
function buildDisc(count, o) {
  return packCloud(count, (i, pos, col, siz, pha, spn) => {
    const t = Math.pow(Math.random(), o.bias);
    const r = 0.55 + t * GAL_R;
    const onArm = Math.random() > o.field;
    const arm = Math.floor(Math.random() * ARMS) * (Math.PI * 2 / ARMS);
    const ang = onArm
      ? arm + r * WIND + bell() * (o.spread * (0.22 + 0.9 * t))
      : Math.random() * Math.PI * 2;

    const rr = r + bell() * 0.5;
    const thick = o.thick * (0.85 * Math.exp(-r / 3.2) + 0.09);
    pos[i * 3]     = Math.cos(ang) * rr;
    pos[i * 3 + 1] = bell() * thick;
    pos[i * 3 + 2] = Math.sin(ang) * rr;

    tint(Math.min(1, rr / GAL_R)).multiplyScalar(o.gain * (onArm ? 1 : 0.6));
    col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    siz[i] = o.size * (0.4 + Math.random() * Math.random() * 2.2);
    pha[i] = Math.random() * 100;
    spn[i] = o.spin * (0.5 + 0.5 * (1 - t));
  }, cloudMaterial(o.px));
}

/* the bulge: a dense, round, gold-white swarm that gives the core a body
   rather than leaving it to a single glowing sprite */
function buildBulge(count, o) {
  return packCloud(count, (i, pos, col, siz, pha, spn) => {
    const r = Math.pow(Math.random(), 2.1) * 2.9;
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3]     = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * u * 0.62;
    pos[i * 3 + 2] = r * s * Math.sin(th);
    tint(Math.min(1, r / GAL_R) * 0.7).multiplyScalar(o.gain);
    col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    siz[i] = o.size * (0.35 + Math.random() * Math.random() * 1.7);
    pha[i] = Math.random() * 100;
    spn[i] = o.spin;
  }, cloudMaterial(o.px));
}

/* the sky the galaxy hangs in: far, still, and never rotating with the disc */
function buildStarfield(count) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const pha = new Float32Array(count);
  const spn = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const r = 46 + Math.random() * 26, s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * u * 0.75;
    pos[i * 3 + 2] = r * s * Math.sin(th);
    tmpC.copy(ARM_BLUE).lerp(CORE_HOT, Math.random());
    tmpC.multiplyScalar(0.30 + Math.random() * 0.55);
    col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    siz[i] = 0.7 + Math.random() * 1.5;
    pha[i] = Math.random() * 100;
    spn[i] = 0.0004;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
  geo.setAttribute('aSpin', new THREE.BufferAttribute(spn, 1));
  const m = cloudMaterial(2.6);
  m.uniforms.uNear.value = 30; m.uniforms.uFar.value = 150;
  const p = new THREE.Points(geo, m);
  p.frustumCulled = false;
  return p;
}

/* ------------------------------------------------------- named objects */

function buildNamed() {
  const tex = starTexture();
  namedStars = new THREE.Group();
  OBJECTS.forEach((o) => {
    const mat = new THREE.SpriteMaterial({
      map: tex, color: STAR_DIM.clone(), transparent: true,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(2.1);
    sp.userData = { id: o.id, lit: 0, want: 0, tone: o.tone };
    namedStars.add(sp);
  });
  scene.add(namedStars);

  // constellation lines across whichever group is being read
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60), 3));
  links = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0x6f86d8, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  links.frustumCulled = false;
  scene.add(links);

  // a single ring, reused: it answers a click and then gets out of the way
  ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 0.94, 64),
    new THREE.MeshBasicMaterial({
      color: 0xbfd4ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    })
  );
  ripple.visible = false;
  scene.add(ripple);
}

/*
  Put the camera in its rest pose, fire a ray through each object's authored
  screen position, and drop the object on that ray at its own depth. Re-run on
  resize, because the framing it solves against has moved.
*/
function placeObjects() {
  const az = BASE_AZ, pol = BASE_POL;
  camera.position.set(
    targetPt.x + dist * Math.sin(pol) * Math.sin(az),
    targetPt.y + dist * Math.cos(pol),
    targetPt.z + dist * Math.sin(pol) * Math.cos(az)
  );
  camera.lookAt(targetPt);
  camera.updateMatrixWorld(true);

  namedStars.children.forEach((sp) => {
    const o = OBJECTS.find((x) => x.id === sp.userData.id);
    tmpV.set(o.ndc[0], o.ndc[1], 0.5).unproject(camera).sub(camera.position).normalize();
    sp.position.copy(camera.position).addScaledVector(tmpV, o.depth);
  });
  if (group) wireLinks();
}

function wireLinks() {
  const inGroup = OBJECTS.filter((o) => o.group === group);
  const attr = links.geometry.attributes.position;
  let v = 0;
  const at = (o) => namedStars.children.find((s) => s.userData.id === o.id).position;
  for (let i = 0; i < inGroup.length - 1; i++) {
    const a = at(inGroup[i]), b = at(inGroup[i + 1]);
    attr.setXYZ(v++, a.x, a.y, a.z);
    attr.setXYZ(v++, b.x, b.y, b.z);
  }
  links.geometry.setDrawRange(0, v);
  attr.needsUpdate = true;
}

function paintNamed(dt) {
  namedStars.children.forEach((sp) => {
    const d = sp.userData;
    const isGroup = group && OBJECTS.find((o) => o.id === d.id).group === group;
    const isHot = hoverId === d.id;
    const isSel = activeId === d.id;
    d.want = isHot ? 1 : isSel ? 0.92 : isGroup ? 0.55 : 0.10;
    d.lit += (d.want - d.lit) * Math.min(1, dt * 7);

    const base = d.tone === 'gold' ? STAR_GOLD : STAR_LIT;
    tmpC.copy(STAR_DIM).lerp(isHot ? STAR_HOT : base, d.lit);
    sp.material.color.copy(tmpC);
    sp.material.opacity = 0.34 + d.lit * 0.66;
    sp.scale.setScalar(2.4 + d.lit * 2.6);
  });
}

/* ------------------------------------------------------------- framing */

/*
  The one framing, solved once. The galaxy is pushed into the clear right-hand
  region of the viewport; on narrow viewports there is no clear region, so it
  centres and the copy sits over it behind a scrim instead.
*/
function frameScene() {
  const wide = innerWidth >= 1060;
  const tan = Math.tan((camera.fov * Math.PI / 180) / 2);
  // Wide: the object sits in the clear band right of the copy column.
  // Narrow: there is no clear band, so it goes high and centred and the copy
  // starts below it.
  const cx = wide ? 0.635 : 0.5;                     // where the core lands, as a fraction of width
  const cy = wide ? 0.50 : 0.28;                     // ... and of height
  dist = wide ? 20.5 : 28;
  // shifting the look-at point is what moves the object on screen
  targetPt.set(
    -((cx - 0.5) * 2) * tan * camera.aspect * dist,
     ((cy - 0.5) * 2) * tan * dist,
    0
  );
}

/*
  Everything here is additively blended, so the cost is fill, and fill scales
  with the square of the pixel ratio. That makes the ratio the one lever worth
  pulling on a machine that cannot keep up — and pulling it is far less visible
  than thinning the star count, which is what the picture is made of.
*/
function applyPixelRatio() {
  const px = Math.min(cheap ? 1.5 : pxCap, devicePixelRatio || 1);
  renderer.setPixelRatio(px);
  renderer.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, false);
  [galaxy, dust, bulge, starfield].forEach((p) => { if (p) p.material.uniforms.uPixelRatio.value = px; });
}

function resize() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  if (!w || !h) return;
  applyPixelRatio();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  frameScene();
  if (namedStars) placeObjects();
}

/* --------------------------------------------------------- interaction */

function setupPointer() {
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
    pointer.inside = true;
    targetParX = ((pointer.x / r.width) - 0.5) * 0.10;
    targetParY = ((pointer.y / r.height) - 0.5) * 0.07;
    if (dragging && lastPtr) {
      const dx = e.clientX - lastPtr.x, dy = e.clientY - lastPtr.y;
      travelled += Math.abs(dx) + Math.abs(dy);
      targetAz = clamp(targetAz - dx * 0.0032, -0.62, 0.62);
      targetPol = clamp(targetPol - dy * 0.0026, -0.34, 0.40);
      lastPtr = { x: e.clientX, y: e.clientY };
    }
  }, { passive: true });

  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false; targetParX = targetParY = 0;
  }, { passive: true });

  canvas.addEventListener('pointerdown', (e) => {
    if (!roomy.matches) return;
    dragging = true; lastPtr = { x: e.clientX, y: e.clientY }; travelled = 0;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });

  addEventListener('pointerup', () => {
    dragging = false; lastPtr = null;
    // always return to the one framing
    targetAz = 0; targetPol = 0;
  }, { passive: true });

  // A drag that happens to start on a star still ends in a click event on the
  // canvas. Turning the object is not the same as choosing something in it.
  canvas.addEventListener('click', () => {
    if (hoverId && travelled < 6) selectCbs.forEach((cb) => cb(hoverId));
  });
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* hover is a screen-space test against the positions the tethers already need */
function updateHover() {
  let best = null, bestD = 34 * 34;
  if (pointer.inside && !dragging && group) {
    projected.forEach((p, id) => {
      if (!p.on || OBJECTS.find((o) => o.id === id).group !== group) return;
      const dx = p.x - pointer.x, dy = p.y - pointer.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = id; }
    });
  }
  if (best !== hoverId) {
    hoverId = best;
    canvas.style.cursor = best ? 'pointer' : (roomy.matches ? 'grab' : 'default');
    hoverCbs.forEach((cb) => cb(best));
  }
}

let viewRect = null;
function measureView() { viewRect = canvas.getBoundingClientRect(); }

function projectAll() {
  const r = viewRect || (viewRect = canvas.getBoundingClientRect());
  namedStars.children.forEach((sp) => {
    tmpV.copy(sp.position).project(camera);
    projected.set(sp.userData.id, {
      x: (tmpV.x * 0.5 + 0.5) * r.width,
      y: (-tmpV.y * 0.5 + 0.5) * r.height,
      on: tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1,
    });
  });
}

/* ------------------------------------------------------------- the loop */

function frame() {
  if (!alive || !running) return;
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  // If the machine cannot hold a reasonable frame rate, step the pixel ratio
  // down once rather than letting the whole page stutter. Sampling continues
  // afterwards, so a slowdown that arrives later is caught too.
  // Frames at the clamp are stalls, not slowness — a backgrounded or occluded
  // window would otherwise look exactly like a machine that cannot cope.
  if (pxCap > 1 && dt < 0.045) {
    watchSum += dt; watchN++;
    if (watchN >= 90) {
      if (watchSum / watchN > 1 / 40) { pxCap = 1; applyPixelRatio(); }
      watchN = 0; watchSum = 0;
    }
  }

  galaxy.material.uniforms.uTime.value = t;
  if (dust) dust.material.uniforms.uTime.value = t;
  bulge.material.uniforms.uTime.value = t;
  starfield.material.uniforms.uTime.value = t;

  const k = Math.min(1, dt * 4.2);
  dragAz += (targetAz - dragAz) * k;
  dragPol += (targetPol - dragPol) * k;
  parX += (targetParX - parX) * k;
  parY += (targetParY - parY) * k;

  // a long, slow breath so the scene is never frozen, even untouched
  const drift = Math.sin(t * 0.045) * 0.055;

  const az = BASE_AZ + dragAz + parX + drift;
  const pol = clamp(BASE_POL + dragPol + parY, 0.30, Math.PI - 0.30);
  camera.position.set(
    targetPt.x + dist * Math.sin(pol) * Math.sin(az),
    targetPt.y + dist * Math.cos(pol),
    targetPt.z + dist * Math.sin(pol) * Math.cos(az)
  );
  camera.lookAt(targetPt);

  nebulae.forEach((n, i) => { n.rotation.z = t * (i % 2 ? 0.008 : -0.006) + i; });

  if (ripple.visible) {
    ripple.userData.t += dt;
    const p = ripple.userData.t / 1.1;
    if (p >= 1) ripple.visible = false;
    else {
      ripple.scale.setScalar(0.4 + p * 3.4);
      ripple.material.opacity = (1 - p) * 0.55;
      ripple.quaternion.copy(camera.quaternion);
    }
  }

  projectAll();
  updateHover();
  paintNamed(dt);
  links.material.opacity += ((group && roomy.matches ? 0.30 : 0) - links.material.opacity) * k;

  renderer.render(scene, camera);
  frameCbs.forEach((cb) => cb());
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------- the API */

export function setGroup(name) {
  if (name === group) return;
  group = name;
  if (!alive) return;
  if (group) wireLinks();
  hoverId = null;
}

export function setActive(id, pulse) {
  activeId = id;
  if (!alive || !id || !pulse) return;
  const sp = namedStars.children.find((s) => s.userData.id === id);
  if (!sp) return;
  ripple.position.copy(sp.position);
  ripple.userData.t = 0;
  ripple.visible = true;
}

export function project(id) { return projected.get(id) || null; }
export function onHover(cb) { hoverCbs.push(cb); }
export function onSelect(cb) { selectCbs.push(cb); }
export function onFrame(cb) { frameCbs.push(cb); }

export function initUniverse(el) {
  canvas = el;
  if (!canvas || !supportsWebGL()) {
    if (canvas) canvas.remove();
    return false;
  }
  // Reduced motion should cost the reader the movement, not the picture: the
  // scene is built and drawn exactly once, and then never touched again.
  still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phones get the same universe at a fraction of the fill cost. This is a
  // question about the DEVICE, so it is answered once, from device signals —
  // not from a window width that the reader can change at any moment.
  cheap = still || matchMedia('(pointer: coarse)').matches || screen.width < 900;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (e) { canvas.remove(); return false; }
  // Opaque, and cleared to the page's own ground. A transparent canvas was
  // tried so the CSS deep field could show through as a safety net, but every
  // additive layer also accumulates alpha, and compositing that over the page
  // darkens it — a soft grey bruise across the top of the scene. The safety net
  // costs nothing anyway: every path that fails removes the canvas outright,
  // which uncovers the CSS field properly.
  renderer.setClearColor(0x04050c, 1);

  // three passes over one distribution. Separately they are dot scatters;
  // together the bright grains sit on a continuous bed and the thing reads as
  // a body of dust rather than a particle system.
  galaxy = buildDisc(cheap ? 11000 : 30000, {
    bias: 0.62, spread: 0.50, thick: 0.85, field: 0.16,
    size: 1.0, px: 4.0, gain: 1.35, spin: 0.011,
  });
  scene.add(galaxy);

  if (!cheap) {
    dust = buildDisc(46000, {
      bias: 0.5, spread: 1.05, thick: 1.3, field: 0.30,
      size: 0.6, px: 2.4, gain: 0.5, spin: 0.011,
    });
    scene.add(dust);
  }

  bulge = buildBulge(cheap ? 3000 : 9000, {
    size: 0.8, px: 3.0, gain: 1.15, spin: 0.016,
  });
  scene.add(bulge);

  starfield = buildStarfield(cheap ? 700 : 2200);
  scene.add(starfield);

  coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,244,224,.95)'], [0.22, 'rgba(255,190,120,.42)'],
                      [0.55, 'rgba(255,150,80,.10)'], [1, 'rgba(255,140,70,0)']]),
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  coreGlow.scale.setScalar(13);
  scene.add(coreGlow);

  if (!cheap) {
    [[0x4d6bd8, 26, 1.0, 7], [0xff9a4d, 17, 0.55, 91], [0x3ab9d6, 22, 0.45, 313]]
      .forEach(([col, size, op, seed], i) => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(size, size),
          new THREE.MeshBasicMaterial({
            map: nebulaTexture(seed), color: col, transparent: true, opacity: op,
            depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
          })
        );
        m.position.set(i === 1 ? 2 : -3 + i * 4, i === 2 ? -2 : 1.5, -6 - i * 3);
        nebulae.push(m); scene.add(m);
      });
  }

  try {
    buildNamed();
  } catch (err) {
    console.error('universe: scene build failed, falling back to the still field', err);
    canvas.remove();
    return false;
  }
  setupPointer();
  resize();          // resize() computes the framing, then places the catalogue

  measureView();
  addEventListener('resize', () => { measureView(); resize(); }, { passive: true });
  addEventListener('scroll', measureView, { passive: true });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); requestAnimationFrame(frame); }
  });

  alive = true;
  if (still) {
    // one frame, and then the scene is left alone for good
    renderer.render(scene, camera);
    return { cheap: cheap, still: true };
  }
  canvas.style.cursor = roomy.matches ? 'grab' : 'default';
  requestAnimationFrame(frame);
  return { cheap: cheap, still: false };
}
