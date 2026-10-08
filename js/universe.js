/*
  The universe behind the document.

  Design rules — these were arrived at painfully, don't "improve" them away:

  - The reader TRAVELS: scroll flies the camera along a curve that starts far
    outside the disc and ends inside the core. An earlier version of this site
    tried a flythrough and abandoned it for a fixed backdrop because of scroll
    jank — so note where the work happens here. The scroll handler does NOTHING.
    rAF reads scrollY (a cheap read, never a forced layout) and eases toward it.
    Scrolling fast leaves the camera trailing its target, which reads as flight.
  - Progress is scrollY over a span measured at load and on resize, and NEVER
    re-measured when a disclosure opens. Dividing by the live document height
    would mean that opening an entry makes the document taller, the same scrollY
    maps to a smaller t, and the camera slides backward through the galaxy while
    the reader is doing nothing but reading.
  - The eleven NAMED objects are placed ONCE, in world space, at the camera pose
    of their own section. They are not re-placed per frame: pinning them to the
    screen would kill the parallax that makes travel feel three-dimensional.
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
const ARM_BLUE   = new THREE.Color(0x8ea6ff);  // population-I blue-white
const ARM_FAR    = new THREE.Color(0x5b3fb0);  // outer arms, toward violet

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

  /*
    By the time the reader reaches these two groups the camera is inside the
    disc and sees it nearly edge-on: a bright band crossing the frame at about
    41-59% of its height. A name placed in that band is unreadable, so these
    objects sit above or below it. The camera's field of view is vertical, so
    the band holds that screen height at every width. Each group keeps its
    top-to-bottom order, so the leader lines from the list never cross.
  */
  { id: 'language',      group: 'stack',  ndc: [ 0.18,  0.64 ], depth: 16.5 },
  { id: 'ml',            group: 'stack',  ndc: [ 0.44,  0.40 ], depth: 20.0 },
  { id: 'genai',         group: 'stack',  ndc: [ 0.52, -0.24 ], depth: 22.5 },
  { id: 'cloud',         group: 'stack',  ndc: [ 0.34, -0.48 ], depth: 19.0 },
  { id: 'serve',         group: 'stack',  ndc: [ 0.13, -0.72 ], depth: 15.5 },

  { id: 'email',         group: 'signal', ndc: [ 0.23,  0.56 ], depth: 17.0 },
  { id: 'linkedin',      group: 'signal', ndc: [ 0.47,  0.26 ], depth: 21.0 },
  { id: 'github',        group: 'signal', ndc: [ 0.19, -0.42 ], depth: 17.5 },
];

/* ------------------------------------------------------------------ state */

let canvas, renderer, scene, camera;
let galaxy, dust, bulge, streams, starfield, coreGlow, nebulae = [], namedStars, links, ripple;
let cheap = false, still = false, running = true, alive = false;
/* device pixel ratio actually used, and the running check that lowers it */
let pxCap = 2, watchN = 0, watchSum = 0;
let group = null, activeId = null, hoverId = null;
let hoverCbs = [], selectCbs = [], frameCbs = [];

/*
  The journey. Two curves: where the camera is, and what it is looking at. The
  descent runs from high outside the disc down into the arms and finally into
  the core — the model's own latent space collapsing toward a single light.
*/
/*
  Where each section sits along the journey. These are only defaults: the real
  values come from the document, because an object is placed at the camera pose
  its section will actually be read at. Guess the two apart and every named
  object lands somewhere other than where the layout put it.
*/
const PATH_T = { hero: 0.0, work: 0.34, stack: 0.70, signal: 1.0 };

/*
  How close to the camera the named objects sit, as a fraction of their authored
  depth — and therefore how large they draw. The sprite and ripple sizes were
  tuned when these objects sat at their full depth; once the journey pulled them
  in, they rendered about 2.5x too big, glare discs smearing into each other and
  each label sitting on its own star's flare. Placement, sprite and ripple all
  read this one value so they cannot drift apart again.
*/
const NEAR = 0.42;
const PATH_POS = [
  // P0 is the framing the fixed-camera version was tuned to, kept exactly, so
  // the page still opens on a composition that is known to work
  [ -6.6, 12.4, 21.3 ],    // outside and above: the whole galaxy in view
  [ -1.6,  7.0, 13.2 ],    // dropping toward the disc, swinging round
  [  2.8,  3.9,  8.8 ],    // crossing over the outer arm
  [  3.6,  1.5,  4.3 ],    // inside the arm, dust streaming past
  [  1.4,  0.36, 1.6 ],    // arriving at the core
];
const PATH_LOOK = [
  [ 0, 0, 0 ], [ 0, 0, -0.4 ], [ 0, 0, -1.0 ], [ 0, 0, -1.8 ], [ 0, 0, -3.0 ],
];
let posCurve, lookCurve;

let tCam = 0, tWant = 0, travelSpan = 1;
let dragAz = 0, dragPol = 0, targetAz = 0, targetPol = 0;
let parX = 0, parY = 0, targetParX = 0, targetParY = 0;
let dragging = false, lastPtr = null, travelled = 0;
let speed = 0;                              // smoothed camera displacement
const UP = new THREE.Vector3(0, 1, 0);
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const prevPos = new THREE.Vector3();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
/* poseAt's own scratch. It must NOT share the general-purpose temporaries:
   callers pass their own vectors as its out-params, and placeObjects passed
   exactly tmpA/tmpB — so the function was overwriting its own output midway
   and every named object landed in the wrong place. */
const poseA = new THREE.Vector3(), poseB = new THREE.Vector3(), poseC = new THREE.Vector3();

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
  The whole disc turns rigidly, about once every three minutes: slow enough to
  read as majestic, fast enough to SEE. It used to turn at a third of this,
  which on screen was indistinguishable from frozen. The rate is rigid on
  purpose: a differential rate winds the arms tighter for as long as the page
  is open, until they smear into rings.
*/
const ROT = 0.035;

/*
  Shared shader for the star cloud. Rotation, twinkle and the depth fade all
  happen on the GPU from a single time uniform, so an idling frame costs one
  uniform write and nothing else on the CPU.
*/
const CLOUD_VERT = /* glsl */`
  uniform float uTime, uSize, uPixelRatio, uNear, uFar, uRot, uGain;
  attribute float aSize, aPhase, aSpin;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Rigid rotation, plus a swirl that only the inner disc feels. The swirl is
    // a bounded oscillation (aSpin is its weight, highest at the core) rather
    // than a rate, so it breathes back and forth and never winds the arms up.
    float ang = uTime * uRot + sin(uTime * 0.09) * 0.16 * aSpin;
    float s = sin(ang), c = cos(ang);
    vec3 p = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float twinkle = 0.72 + 0.28 * sin(uTime * 1.7 + aPhase);
    // One star in twenty catches the light now and then: a sharp, brief peak
    // about every ten seconds, each on its own phase, so somewhere in the field
    // there is always a glint.
    float glint = pow(max(0.0, sin(uTime * 0.6 + aPhase * 2.3)), 48.0)
                * step(0.95, fract(aPhase * 0.618));
    vColor = color * uGain * (1.0 + 2.2 * glint);
    // Clamped: the camera now flies INTO the core, and without a ceiling a
    // grain passing close to the lens covers the screen.
    gl_PointSize = min(
      uSize * aSize * (twinkle + 1.6 * glint) * uPixelRatio * (24.0 / max(depth, 0.001)),
      12.0 * uPixelRatio
    );
    // Fade at BOTH ends. The far fade carries depth; the near one dissolves
    // grains just in front of the lens, which would otherwise arrive as soft
    // blobs — and it is also the cheapest thing available, since those are the
    // fragments that cost the most to fill.
    vAlpha = (1.0 - smoothstep(uNear, uFar, depth)) * smoothstep(0.0, 1.4, depth);
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
      uRot: { value: ROT }, uGain: { value: 1 },
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
    spn[i] = (1 - t) * (1 - t);           // inner-swirl weight: 1 at the core, 0 at the rim
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
    spn[i] = 1;
  }, cloudMaterial(o.px));
}

/*
  Streams — light flowing outward along the arms, in pulses.

  This is what makes the galaxy read as ALIVE rather than as a beautiful still:
  packets of brighter grains leave the core and travel the length of each arm,
  warm at the centre and cooling to violet at the rim, like signals moving
  through a network. Pulses, not an even spray: a uniform flow reads as texture,
  while packets you can follow with your eye are what hold attention.

  Every position is computed in the vertex shader from the same ARMS, WIND and
  rotation as the disc. Built any other way, the streams would drift off the
  arms within seconds of turning.
*/
const STREAM_VERT = /* glsl */`
  uniform float uTime, uRot, uSize, uPixelRatio, uNear, uFar;
  attribute float aArm, aPh, aSpd, aOff, aY, aSize;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float u = fract(aPh + uTime * aSpd);                 // 0 at the core .. 1 at the rim
    float r = 0.7 + u * ${(GAL_R - 0.7).toFixed(2)};
    float tt = clamp((r - 0.55) / ${GAL_R.toFixed(2)}, 0.0, 1.0);
    float swirl = sin(uTime * 0.09) * 0.16 * (1.0 - tt) * (1.0 - tt);   // matches the disc
    float ang = aArm + r * ${WIND.toFixed(3)} + aOff * (0.35 + 0.65 * u) + uTime * uRot + swirl;
    float thick = 0.85 * exp(-r / 3.2) + 0.09;
    vec3 p = vec3(cos(ang) * r, aY * thick * 0.6, sin(ang) * r);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    vec3 warm = vec3(1.0, 0.85, 0.58), cool = vec3(0.56, 0.74, 1.0), rim = vec3(0.72, 0.52, 1.0);
    vColor = mix(mix(warm, cool, smoothstep(0.08, 0.55, u)), rim, smoothstep(0.6, 1.0, u)) * 1.25;
    gl_PointSize = min(uSize * aSize * uPixelRatio * (24.0 / max(depth, 0.001)), 12.0 * uPixelRatio);
    // born at the core, fading out before the rim, so a pulse never pops
    float life = smoothstep(0.0, 0.07, u) * (1.0 - smoothstep(0.72, 1.0, u));
    vAlpha = life * (1.0 - smoothstep(uNear, uFar, depth)) * smoothstep(0.0, 1.4, depth);
    gl_Position = projectionMatrix * mv;
  }`;

function buildStreams(packetsPerArm, perPacket) {
  const n = ARMS * packetsPerArm * perPacket;
  const at = { aArm: new Float32Array(n), aPh: new Float32Array(n), aSpd: new Float32Array(n),
               aOff: new Float32Array(n), aY: new Float32Array(n), aSize: new Float32Array(n) };
  let i = 0;
  for (let a = 0; a < ARMS; a++) {
    for (let k = 0; k < packetsPerArm; k++) {
      // a packet shares one phase and one speed, so it travels as a single pulse
      const ph = Math.random(), spd = 0.016 + Math.random() * 0.02;
      const len = 0.006 + Math.random() * 0.022;
      for (let j = 0; j < perPacket; j++, i++) {
        at.aArm[i] = a * (Math.PI * 2 / ARMS);
        at.aPh[i] = ph + (Math.random() - 0.5) * len;
        at.aSpd[i] = spd;
        at.aOff[i] = bell() * 0.22;
        at.aY[i] = bell();
        at.aSize[i] = 0.55 + Math.random() * Math.random() * 1.3;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  // three needs a position attribute to draw; the shader ignores it
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  Object.entries(at).forEach(([k, v]) => geo.setAttribute(k, new THREE.BufferAttribute(v, 1)));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uRot: { value: ROT }, uSize: { value: 3.4 },
      uPixelRatio: { value: Math.min(2, devicePixelRatio || 1) },
      uNear: { value: 12 }, uFar: { value: 42 },
    },
    vertexShader: STREAM_VERT, fragmentShader: CLOUD_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  return pts;
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
    spn[i] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
  geo.setAttribute('aSpin', new THREE.BufferAttribute(spn, 1));
  const m = cloudMaterial(2.6);
  m.uniforms.uNear.value = 30; m.uniforms.uFar.value = 150;
  m.uniforms.uRot.value = 0.0006;            // the far sky barely moves
  const p = new THREE.Points(geo, m);
  p.frustumCulled = false;
  return p;
}

/*
  Motes — fine grains that stream past the lens.

  They exist for one reason: to make speed legible. They are recycled around the
  camera rather than placed in the world, so a fixed handful covers the whole
  journey, and their opacity rides the camera's ACTUAL per-frame displacement.
  A constant would leave them dotting the view at every section, which is
  exactly where the reader stops and reads; driven by speed they appear during
  transit and fade out on arrival.
*/
const MOTE_R = 14;
let motes;

function buildMotes(count) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 2 * MOTE_R;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 2 * MOTE_R;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 2 * MOTE_R;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  motes = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.09, map: glowTexture([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(210,225,255,.5)'], [1, 'rgba(190,210,255,0)']]),
    color: 0xd8e2ff, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  motes.frustumCulled = false;
  scene.add(motes);
}

function updateMotes() {
  if (!motes) return;
  // fade in from about walking pace, full by the fastest part of the descent
  const want = clamp((speed - 1.2) / 16, 0, 1) * 0.75;
  motes.material.opacity += (want - motes.material.opacity) * 0.12;
  if (motes.material.opacity < 0.004) return;

  const attr = motes.geometry.attributes.position;
  const a = attr.array, c = camera.position;
  for (let i = 0; i < a.length; i += 3) {
    // wrap anything that falls behind through to the far side, so a small
    // fixed set of grains covers an arbitrarily long journey
    for (let j = 0; j < 3; j++) {
      const d = a[i + j] - (j === 0 ? c.x : j === 1 ? c.y : c.z);
      if (d > MOTE_R) a[i + j] -= 2 * MOTE_R;
      else if (d < -MOTE_R) a[i + j] += 2 * MOTE_R;
    }
  }
  attr.needsUpdate = true;
}

/* --------------------------------------------------------------- bloom */

/*
  Glow, as a separate layer drawn ON TOP of the scene — not by routing the scene
  through a render target. In three r169, built-in materials (every sprite, the
  lines, the motes) write linear values into a target while these shader
  materials write raw values, so sending the main pass through a target would
  shift the brightness of every sprite on the page. Instead the main scene draws
  to the canvas exactly as before, and the star clouds alone are drawn a second
  time at quarter resolution, thresholded, blurred at two widths and added back.

  Named stars, links, the ripple, the core glow and the nebula quads are kept
  out of the bloom source on purpose: blooming them puts glare around every
  label and brings back the grey wash over the core.
*/
const BLOOM_LAYER = 1;
const BLOOM_THR = 0.38;
let bloomOn = true, rtA, rtB, rtC, rtD, fsScene, fsCam, fsMesh, blurMat, compMat;

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/* nine-tap Gaussian in five reads (linear-sampling trick); uThr > 0 thresholds */
const BLUR_FRAG = /* glsl */`
  uniform sampler2D tMap;
  uniform vec2 uDir;
  uniform float uThr;
  varying vec2 vUv;
  vec3 S(vec2 uv) {
    vec3 c = texture2D(tMap, uv).rgb;
    return uThr > 0.0 ? max(c - uThr, 0.0) / (1.0 - uThr) : c;
  }
  void main() {
    vec3 c = S(vUv) * 0.2270270;
    c += (S(vUv + uDir * 1.3846154) + S(vUv - uDir * 1.3846154)) * 0.3162162;
    c += (S(vUv + uDir * 3.2307692) + S(vUv - uDir * 3.2307692)) * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
  }`;

const COMP_FRAG = /* glsl */`
  uniform sampler2D tNear, tWide;
  uniform float uNear, uWide;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tNear, vUv).rgb * uNear + texture2D(tWide, vUv).rgb * uWide;
    gl_FragColor = vec4(c, 1.0);
  }`;

function buildBloom() {
  // plain 8-bit RGBA: float targets are where Safari support gets uneven
  const opts = { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  [rtA, rtB, rtC, rtD] = [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(1, 1, opts));
  fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  fsMesh.frustumCulled = false;
  fsScene = new THREE.Scene();
  fsScene.add(fsMesh);
  blurMat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() }, uThr: { value: 0 } },
    vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
  });
  compMat = new THREE.ShaderMaterial({
    uniforms: {
      tNear: { value: rtA.texture }, tWide: { value: rtD.texture },
      uNear: { value: 0.5 }, uWide: { value: 0.7 },
    },
    vertexShader: FS_VERT, fragmentShader: COMP_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  });
}

function sizeBloom() {
  if (!rtA) return;
  const w = renderer.domElement.width, h = renderer.domElement.height;
  rtA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
  rtB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
  rtC.setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
  rtD.setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
}

function pass(mat, target) {
  fsMesh.material = mat;
  renderer.setRenderTarget(target);
  renderer.render(fsScene, fsCam);
}

/* The one way a frame is drawn, by the loop and by the still render alike. */
function renderFrame() {
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  if (!bloomOn || !rtA) return;

  // The bloom source, at quarter resolution. gl_PointSize is in pixels, so the
  // clouds' pixel ratio is scaled down with the target — left alone, every
  // grain would draw four times too large into it.
  const px = renderer.getPixelRatio();
  const scale = rtA.width / renderer.domElement.width;
  const clouds = [galaxy, dust, streams, starfield].filter(Boolean);
  clouds.forEach((c) => { c.material.uniforms.uPixelRatio.value = px * scale; });
  camera.layers.set(BLOOM_LAYER);
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(rtA);
  renderer.render(scene, camera);
  camera.layers.set(0);
  renderer.setClearColor(0x04050c, 1);
  clouds.forEach((c) => { c.material.uniforms.uPixelRatio.value = px; });

  const u = blurMat.uniforms;
  u.tMap.value = rtA.texture; u.uDir.value.set(1 / rtA.width, 0); u.uThr.value = BLOOM_THR; pass(blurMat, rtB);
  u.tMap.value = rtB.texture; u.uDir.value.set(0, 1 / rtB.height); u.uThr.value = 0; pass(blurMat, rtA);
  u.tMap.value = rtA.texture; u.uDir.value.set(2 / rtA.width, 0); pass(blurMat, rtC);
  u.tMap.value = rtC.texture; u.uDir.value.set(0, 1.5 / rtC.height); pass(blurMat, rtD);

  renderer.setRenderTarget(null);
  renderer.autoClear = false;
  fsMesh.material = compMat;
  renderer.render(fsScene, fsCam);
  renderer.autoClear = true;
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
  namedStars.children.forEach((sp) => {
    const o = OBJECTS.find((x) => x.id === sp.userData.id);
    // the pose the reader will actually be at when this object's section is the
    // one being read, so on arrival it sits exactly where the layout wants it
    poseAt(ease(PATH_T[o.group]), tmpA, tmpB);
    camera.position.copy(tmpA);
    camera.lookAt(tmpB);
    camera.updateMatrixWorld(true);
    tmpV.set(o.ndc[0], o.ndc[1], 0.5).unproject(camera).sub(camera.position).normalize();
    sp.position.copy(camera.position).addScaledVector(tmpV, o.depth * NEAR);
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
    sp.scale.setScalar((2.4 + d.lit * 2.6) * NEAR);
  });
}

/* ------------------------------------------------------------- framing */

/*
  The camera pose at journey position t.

  The lateral shift is what keeps the composition working while the camera is
  moving: the copy column owns the left of the viewport, so the look-at point is
  pushed sideways along the camera's own right vector. That slides the galaxy
  into the clear band without ever rolling the horizon.
*/
function poseAt(t, outPos, outLook) {
  posCurve.getPoint(t, outPos);
  lookCurve.getPoint(t, outLook);
  // Wide: the galaxy sits in the clear band right of the copy column.
  // Narrow: there is no clear band, so it rides high and the copy starts below.
  // "Wide" is the same query that turns the annotation layer on. It used to be
  // a separate, larger breakpoint, so between 901 and 1059px the labels were on
  // but the galaxy was framed for a phone: centred, with its core behind the copy.
  const wide = roomy.matches;
  const cx = wide ? 0.62 : 0.50;
  const cy = wide ? 0.50 : 0.30;
  if (cx === 0.5 && cy === 0.5) return;

  const tan = Math.tan((camera.fov * Math.PI / 180) / 2);
  const reach = outPos.distanceTo(outLook);
  poseA.subVectors(outLook, outPos).normalize();        // forward
  poseB.set(0, 1, 0).cross(poseA).normalize();          // camera-LEFT
  poseC.crossVectors(poseA, poseB).normalize();         // camera-up
  // moving the look-at point one way slides the galaxy the other
  outLook.addScaledVector(poseB, ((cx - 0.5) * 2) * tan * camera.aspect * reach);
  outLook.addScaledVector(poseC, ((cy - 0.5) * 2) * tan * reach);
}

/*
  Depth cues for wherever the camera currently is. Shared by the animation loop
  and the still render: a still frame that skipped this kept the shader defaults,
  which are tuned for a different camera distance entirely.
*/
function applyDepth() {
  const near = camera.position.length();
  /*
    The fade band tracks the camera but keeps the WIDTH of the galaxy, so the
    far half of the disc always falls away into the dark. Scaling the band with
    distance instead let the far side stay lit, which flattened the depth cue
    and turned the core into a grey smudge rather than the brightest thing in
    the frame.
  */
  const fogFar = near + GAL_R * 1.1;
  const fogNear = Math.max(1.2, near - GAL_R * 0.62);
  [galaxy, dust, bulge, streams].forEach((pc) => {
    if (!pc) return;
    pc.material.uniforms.uNear.value = fogNear;
    pc.material.uniforms.uFar.value = fogFar;
  });
  /*
    The haze layers — the core's glow sprite and the nebula quads — are painted
    at a size that reads correctly from outside the galaxy. Fly into them and
    they become a grey sheet over the whole screen, because you are now inside
    a billboard that was standing in for distance. So they fade out on approach
    and hand the job to the bulge stars, which is what should actually be
    blazing when the reader arrives at the core.
  */
  const haze = clamp((near - 3.5) / 11, 0, 1);
  coreGlow.material.opacity = haze;
  nebulae.forEach((n) => { n.material.opacity = n.userData.baseOpacity * haze; });
}

/*
  The still frame, for reduced motion. Always re-posed from scratch: resize()
  runs placeObjects(), which walks the camera through every section's pose and
  leaves it parked at the last one — the core. Rendering without re-posing would
  draw the still frame from inside the galaxy.
*/
function renderStill() {
  poseAt(0, camPos, camLook);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.updateMatrixWorld(true);
  applyDepth();
  renderFrame();
}

/* eased so both ends of the journey settle instead of arriving at full speed */
const ease = (x) => x * x * (3 - 2 * x);

/*
  How much scrolling the whole journey costs.

  Measured here and on resize, and deliberately NOT when a disclosure opens.
  Opening an entry makes the document taller; if this were read live, the same
  scrollY would map to a smaller t and the camera would slide backwards through
  the galaxy while the reader sat still and read.
*/
function frameScene() {
  travelSpan = Math.max(1, document.documentElement.scrollHeight - innerHeight);
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
  [galaxy, dust, bulge, streams, starfield].forEach((p) => { if (p) p.material.uniforms.uPixelRatio.value = px; });
  sizeBloom();
}

function resize() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  if (!w || !h) return;
  applyPixelRatio();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  frameScene();
  if (namedStars) placeObjects();
  // setSize() has just cleared the drawing buffer, and a still scene has no
  // loop to paint it again
  if (still && alive) renderStill();
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
  if ((pxCap > 1 || bloomOn) && dt < 0.045) {
    watchSum += dt; watchN++;
    if (watchN >= 90) {
      if (watchSum / watchN > 1 / 40) {
        // first the pixel ratio, and only if that is not enough, the glow
        if (pxCap > 1) { pxCap = 1; applyPixelRatio(); } else bloomOn = false;
      }
      watchN = 0; watchSum = 0;
    }
  }

  galaxy.material.uniforms.uTime.value = t;
  if (dust) dust.material.uniforms.uTime.value = t;
  bulge.material.uniforms.uTime.value = t;
  streams.material.uniforms.uTime.value = t;
  starfield.material.uniforms.uTime.value = t;

  const k = Math.min(1, dt * 4.2);
  dragAz += (targetAz - dragAz) * k;
  dragPol += (targetPol - dragPol) * k;
  parX += (targetParX - parX) * k;
  parY += (targetParY - parY) * k;

  /*
    The journey. scrollY is read HERE, in the frame, not in a scroll handler —
    reading it is cheap and forces no layout, and it means a burst of scroll
    events can never queue up work. The camera eases toward the target, so
    scrolling fast leaves it trailing, which is what makes this read as flight
    rather than as a scrubbed animation.
  */
  tWant = clamp(scrollY / travelSpan, 0, 1);
  tCam += (tWant - tCam) * Math.min(1, dt * 2.0);

  prevPos.copy(camera.position);
  poseAt(ease(tCam), camPos, camLook);

  // drag and pointer parallax orbit the look-at point, on top of the journey
  const yaw = dragAz + parX + Math.sin(t * 0.045) * 0.05;   // a slow breath
  const pitch = clamp(dragPol + parY, -0.5, 0.5);
  tmpA.subVectors(camPos, camLook);
  tmpA.applyAxisAngle(UP, yaw);
  tmpB.copy(tmpA).cross(UP).normalize();
  tmpA.applyAxisAngle(tmpB, pitch);
  camera.position.copy(camLook).add(tmpA);
  camera.lookAt(camLook);
  camera.updateMatrixWorld(true);

  // actual displacement, smoothed — this is what the motes ride on
  const moved = prevPos.distanceTo(camera.position) / Math.max(dt, 0.001);
  speed += (moved - speed) * Math.min(1, dt * 3.5);

  /*
    The depth fade and the point size are both tuned in world units, and the
    camera now travels from 30 units out to inside the core. Left fixed, the
    arrival would be a flat white bloom of enormous grains, so both sweep with
    how far the camera actually is from the centre.
  */
  applyDepth();

  // the core breathes: a slow swell in the glow and in the bulge's light
  const beat = Math.sin(t * 0.9);
  coreGlow.scale.setScalar(7.5 * (1 + 0.07 * beat));
  bulge.material.uniforms.uGain.value = 1 + 0.12 * Math.sin(t * 0.9 + 0.5);

  updateMotes(dt);
  nebulae.forEach((n, i) => { n.rotation.z = t * (i % 2 ? 0.008 : -0.006) + i; });

  if (ripple.visible) {
    ripple.userData.t += dt;
    const p = ripple.userData.t / 1.1;
    if (p >= 1) ripple.visible = false;
    else {
      ripple.scale.setScalar((0.4 + p * 3.4) * NEAR);
      ripple.material.opacity = (1 - p) * 0.55;
      ripple.quaternion.copy(camera.quaternion);
    }
  }

  projectAll();
  updateHover();
  paintNamed(dt);
  links.material.opacity += ((group && roomy.matches ? 0.30 : 0) - links.material.opacity) * k;

  renderFrame();
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

/*
  Told by the document where its sections fall, as a fraction of the whole
  scroll. Called on load and on resize only — never when a disclosure opens,
  for the same reason the travel span is not re-measured then.
*/
export function setAnchors(map) {
  Object.assign(PATH_T, map);
  // the travel span comes from the same layout, so it is re-read alongside
  frameScene();
  if (alive && namedStars) placeObjects();
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

  // Gain was 1.5 when the core had to look hot on its own. With bloom on top
  // that boost is counted twice and the core saturates into a flat white disc.
  bulge = buildBulge(cheap ? 3600 : 11000, {
    size: 0.85, px: 3.0, gain: 0.95, spin: 0.016,
  });
  scene.add(bulge);

  streams = cheap ? buildStreams(16, 55) : buildStreams(26, 85);
  scene.add(streams);

  starfield = buildStarfield(cheap ? 700 : 2200);
  scene.add(starfield);

  coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,244,224,.95)'], [0.22, 'rgba(255,190,120,.42)'],
                      [0.55, 'rgba(255,150,80,.10)'], [1, 'rgba(255,140,70,0)']]),
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  // Big enough to give the core a warm halo, small enough that it stays a
  // CORE. Past roughly half the frame it stops reading as a bright centre and
  // starts reading as haze over everything.
  coreGlow.scale.setScalar(7.5);
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
        m.userData.baseOpacity = op;
        nebulae.push(m); scene.add(m);
      });
  }

  posCurve = new THREE.CatmullRomCurve3(PATH_POS.map((p) => new THREE.Vector3().fromArray(p)));
  lookCurve = new THREE.CatmullRomCurve3(PATH_LOOK.map((p) => new THREE.Vector3().fromArray(p)));

  // The bulge stays out: it is already the densest light in the frame, and
  // blooming it only widens a saturated white plateau where the core's detail
  // should be. The core has its own warm halo sprite for that job.
  [galaxy, dust, streams, starfield].forEach((o) => { if (o) o.layers.enable(BLOOM_LAYER); });
  buildBloom();

  try {
    if (!cheap) buildMotes(500);
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
  document.addEventListener('visibilitychange', () => {
    if (still) return;          // there is no loop to resume, by design
    running = !document.hidden;
    if (running) { clock.getDelta(); requestAnimationFrame(frame); }
  });

  alive = true;
  if (still) {
    // The catalogue only means something with its names beside it, and names
    // are off here — left in, the eleven stars are unexplained blue blobs.
    namedStars.visible = false;
    links.visible = false;
    ripple.visible = false;
    // one frame at the start of the journey, and then left alone for good
    renderStill();
    return { cheap: cheap, still: true };
  }
  canvas.style.cursor = roomy.matches ? 'grab' : 'default';
  requestAnimationFrame(frame);
  return { cheap: cheap, still: false };
}
