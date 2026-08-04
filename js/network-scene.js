/*
  The neural network, rendered as a fixed backdrop that the document scrolls over.

  Read-first rules (these are the point — don't "improve" them away):
   - Every node is drawn at exactly the same size. All nodes sit on z=0, the
     scale is a constant, and state (hover / selected / active layer) is shown
     through COLOUR only. Varying node size made the figure read as an
     irregular scatter of balls instead of a network.
   - A long-lens FOV (22°) with the camera pulled back makes perspective
     foreshortening across the columns negligible (~2%), so the layers read as
     even columns — near-orthographic, the way a technical diagram is drawn,
     while still being the PerspectiveCamera the design calls for.
   - The camera is face-on, framed into the clear right-hand region of the
     viewport so the copy column never covers the network. Orbit is clamped to
     a narrow band so dragging adds depth but never destroys the diagram.
*/
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/controls/OrbitControls.js';

export const LAYER_SIZES = [4, 5, 3, 3];
const SPACING_X = 3.15;
const SPACING_Y = 0.92;
export const LAYER_X = LAYER_SIZES.map((_, i) => (i - (LAYER_SIZES.length - 1) / 2) * SPACING_X);
const AXIS_Y = -((Math.max(...LAYER_SIZES) - 1) / 2) * SPACING_Y - 0.85;

/* one node size, one node geometry — never scaled per instance */
const NODE_R = 0.15;

const C_NODE = new THREE.Color(0x18c8d8);   // resting
const C_NODE_ON = new THREE.Color(0x00ffff); // node in the active layer
const C_NODE_SEL = new THREE.Color(0x7df9ff);// selected
const C_NODE_HOT = new THREE.Color(0xffffff);// hovered
const C_NODE_OFF = new THREE.Color(0x0d5f70);// layer the reader has left
const EDGE_BASE = new THREE.Color(0x0066ff);
const EDGE_ON = new THREE.Color(0x2fb9ff);
const EDGE_HOT = new THREE.Color(0x9ff4ff);

let scene, camera, renderer, controls, canvas;
let nodeMesh, pickMesh, edgeLines, pulses, halo;
let nodes = [], edges = [], nodeStartOfLayer = [];
let raycaster, pointer = new THREE.Vector2(-10, -10), pointerInside = false;
let hovered = null;
let selected = [0, 0, 0, 0];
let hoverCbs = [], clickCbs = [], frameCbs = [];
let active = false, running = true;
let userDriving = false, idleTimer = null;
let emphasis = -1;
let fitDist = 24, curDist = 24, camX = 0, curX = 0;
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3(1, 1, 1), tmpC = new THREE.Color();

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}

/* ---------- geometry ---------- */

function buildNodePositions() {
  nodes = []; nodeStartOfLayer = [];
  let run = 0;
  LAYER_SIZES.forEach((n, li) => {
    nodeStartOfLayer.push(run);
    for (let i = 0; i < n; i++) {
      // z is flat: any depth offset would project neighbouring nodes at
      // different sizes, which is exactly the irregularity we're removing
      nodes.push({ layer: li, idx: i, pos: new THREE.Vector3(LAYER_X[li], (i - (n - 1) / 2) * SPACING_Y, 0) });
    }
    run += n;
  });
}

function buildEdges() {
  edges = [];
  const positions = [], colors = [];
  for (let li = 0; li < LAYER_SIZES.length - 1; li++) {
    for (let a = 0; a < LAYER_SIZES[li]; a++) {
      for (let b = 0; b < LAYER_SIZES[li + 1]; b++) {
        const na = nodes[nodeStartOfLayer[li] + a], nb = nodes[nodeStartOfLayer[li + 1] + b];
        edges.push({ aLayer: li, aIdx: a, bLayer: li + 1, bIdx: b, v: positions.length / 3 });
        positions.push(na.pos.x, na.pos.y, na.pos.z, nb.pos.x, nb.pos.y, nb.pos.z);
        colors.push(0, 0, 0, 0, 0, 0);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  edgeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
  scene.add(edgeLines);
}

function paintEdges() {
  const attr = edgeLines.geometry.attributes.color;
  edges.forEach((e) => {
    const hot = hovered && ((e.aLayer === hovered.layer && e.aIdx === hovered.idx) || (e.bLayer === hovered.layer && e.bIdx === hovered.idx));
    const near = emphasis >= 0 && (e.aLayer === emphasis || e.bLayer === emphasis);
    const c = hot ? EDGE_HOT : near ? EDGE_ON : EDGE_BASE;
    const k = hot ? 1 : near ? 0.7 : emphasis >= 0 ? 0.3 : 0.5;
    attr.setXYZ(e.v, c.r * k, c.g * k, c.b * k);
    attr.setXYZ(e.v + 1, c.r * k, c.g * k, c.b * k);
  });
  attr.needsUpdate = true;
}

/* colour is the ONLY channel that carries node state */
function paintNodes() {
  nodes.forEach((n, i) => {
    const hot = hovered && hovered.layer === n.layer && hovered.idx === n.idx;
    const on = emphasis < 0 || n.layer === emphasis;
    // selection only reads while the reader is actually in that layer,
    // otherwise every layer shows a standing highlight and the columns
    // stop looking uniform
    const sel = selected[n.layer] === n.idx && n.layer === emphasis;
    tmpC.copy(hot ? C_NODE_HOT : sel ? C_NODE_SEL : on ? (emphasis < 0 ? C_NODE : C_NODE_ON) : C_NODE_OFF);
    nodeMesh.setColorAt(i, tmpC);
  });
  if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
}

function dotTexture() {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

function buildNodes() {
  // MeshBasicMaterial: unlit, so a node's apparent brightness never depends on
  // where it sits relative to a light — every node looks identical at rest
  nodeMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(NODE_R, 20, 20),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    nodes.length
  );
  nodes.forEach((n, i) => {
    tmpM.compose(n.pos, tmpQ, tmpS);      // identity scale, always
    nodeMesh.setMatrixAt(i, tmpM);
    nodeMesh.setColorAt(i, C_NODE);
  });
  nodeMesh.instanceMatrix.needsUpdate = true;
  scene.add(nodeMesh);

  pickMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.48, 8, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    nodes.length
  );
  nodes.forEach((n, i) => { tmpM.makeTranslation(n.pos.x, n.pos.y, n.pos.z); pickMesh.setMatrixAt(i, tmpM); });
  scene.add(pickMesh);

  // the halo is a separate sprite, so "this node is active" never changes the
  // node's own drawn size
  halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: 0xbdf7ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(1.15);
  scene.add(halo);
}

function buildPulses() {
  const COUNT = 34;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.17, map: dotTexture(), color: 0x8ef2ff, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  scene.add(points);
  const spawn = () => ({ e: edges[(Math.random() * edges.length) | 0], t: Math.random(), sp: 0.2 + Math.random() * 0.25 });
  pulses = { points, state: Array.from({ length: COUNT }, spawn), spawn };
}

function updatePulses(dt) {
  const attr = pulses.points.geometry.attributes.position;
  pulses.state.forEach((p, i) => {
    p.t += dt * p.sp;
    if (p.t >= 1) Object.assign(p, pulses.spawn(), { t: 0 });
    const a = nodes[nodeStartOfLayer[p.e.aLayer] + p.e.aIdx].pos;
    const b = nodes[nodeStartOfLayer[p.e.bLayer] + p.e.bIdx].pos;
    attr.setXYZ(i, a.x + (b.x - a.x) * p.t, a.y + (b.y - a.y) * p.t, a.z + (b.z - a.z) * p.t);
  });
  attr.needsUpdate = true;
}

/* ---------- projection for the DOM axis labels ---------- */

function toScreen(v) {
  tmpV.copy(v).project(camera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (tmpV.x * 0.5 + 0.5) * r.width, y: r.top + (-tmpV.y * 0.5 + 0.5) * r.height };
}
export function projectNode(layer, idx) {
  const n = nodes[nodeStartOfLayer[layer] + idx];
  return n ? toScreen(n.pos) : null;
}
export function projectColumn(layer) { return toScreen(tmpV.set(LAYER_X[layer], AXIS_Y, 0)); }

/* ---------- interaction ---------- */

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { userDriving = false; }, 2600);
}

function setupPointer() {
  raycaster = new THREE.Raycaster();
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    pointerInside = true;
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => { pointerInside = false; }, { passive: true });
  canvas.addEventListener('pointerdown', () => { userDriving = true; clearTimeout(idleTimer); });
  addEventListener('pointerup', armIdle, { passive: true });
  canvas.addEventListener('click', () => { if (hovered) clickCbs.forEach((cb) => cb(hovered.layer, hovered.idx)); });
}

function updateHover() {
  let next = null;
  if (pointerInside) {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(pickMesh);
    if (hit.length) next = nodes[hit[0].instanceId];
  }
  if (next !== hovered) {
    hovered = next;
    canvas.style.cursor = next ? 'pointer' : 'grab';
    hoverCbs.forEach((cb) => cb(next ? next.layer : null, next ? next.idx : null));
    paintEdges(); paintNodes();
  }
  if (hovered) { halo.position.copy(hovered.pos); halo.material.opacity = 0.85; }
  else halo.material.opacity = Math.max(0, halo.material.opacity - 0.1);
}

/* ---------- framing ---------- */

/*
  Frame the network into the clear region of the viewport (the right side on
  desktop, where no copy sits) rather than the whole width, and shift the
  camera so the network is centred in that region.
*/
function computeFit() {
  const halfW = Math.abs(LAYER_X[0]) + 0.6;
  const halfH = Math.abs(AXIS_Y) + 0.5;
  const tan = Math.tan((camera.fov * Math.PI / 180) / 2);
  // The clear region of the viewport, in normalised width: starts right of the
  // copy column and stops short of the right edge so the OUTPUT axis label —
  // which is wider than the node column it sits under — is not clipped.
  const x0 = innerWidth < 1180 ? 0.40 : 0.53, x1 = 0.955;
  const w = x1 - x0;
  fitDist = Math.max(halfH / tan, halfW / (w * tan * camera.aspect)) * 1.1;
  camX = -(((x0 + x1) / 2) - 0.5) * 2 * tan * camera.aspect * fitDist;
}

function resize() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  computeFit();
}

function frame() {
  if (!running) return;
  const dt = Math.min(0.05, clock.getDelta());

  if (!userDriving) {
    // framing is constant — emphasis is carried entirely by colour, so the
    // network never drifts or clips as the reader moves between layers
    const k = 1 - Math.pow(0.002, dt);
    curDist += (fitDist - curDist) * k;
    curX += (camX - curX) * k;
    controls.target.set(curX, 0, 0);
    camera.position.set(curX, 0, curDist);
  } else {
    curX = controls.target.x;
    curDist = camera.position.distanceTo(controls.target);
  }
  controls.update();

  updatePulses(dt);
  updateHover();
  renderer.render(scene, camera);
  frameCbs.forEach((cb) => cb());
  requestAnimationFrame(frame);
}

/* ---------- public API ---------- */

export function focusLayer(i) {
  const next = (i === null || i < 0) ? -1 : Math.min(LAYER_SIZES.length - 1, i);
  if (next === emphasis) return;
  emphasis = next;
  paintEdges(); paintNodes();
}
export function setSelected(layer, idx) { selected[layer] = idx; paintNodes(); }
export function onHover(cb) { hoverCbs.push(cb); }
export function onClick(cb) { clickCbs.push(cb); }
export function onFrame(cb) { frameCbs.push(cb); }
export function isActive() { return active; }

export function initNetwork(canvasEl) {
  canvas = canvasEl;
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches || innerWidth < 820 || !supportsWebGL()) {
    if (canvas) canvas.remove();
    return false;
  }

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(22, 1, 0.1, 200);   // long lens ⇒ near-uniform node sizes

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch (e) { canvas.remove(); return false; }
  renderer.setPixelRatio(devicePixelRatio || 1);
  renderer.setClearColor(0x090a0f, 1);

  buildNodePositions();
  buildEdges();
  buildNodes();
  buildPulses();
  setupPointer();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.minAzimuthAngle = -0.3; controls.maxAzimuthAngle = 0.3;
  controls.minPolarAngle = Math.PI / 2 - 0.22; controls.maxPolarAngle = Math.PI / 2 + 0.22;

  resize();
  curDist = fitDist; curX = camX;
  camera.position.set(curX, 0, curDist);
  controls.target.set(curX, 0, 0);
  controls.update();
  paintEdges(); paintNodes();

  addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); requestAnimationFrame(frame); }
  });

  canvas.style.cursor = 'grab';
  requestAnimationFrame(frame);
  active = true;
  return true;
}
