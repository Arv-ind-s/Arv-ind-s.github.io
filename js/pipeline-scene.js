/*
  Immersive backdrop: the camera dollies along a fixed 3D path behind the DOM
  content as the page scrolls. Each pipeline stage (research/train/ship/endpoint)
  gets a "station" object placed off the path so it swims into view and recedes
  as the camera passes it — motion is authored (on rails), never free/orbit.

  The DOM (spine, nodes, copy, cards) is the source of truth for content and
  navigation; this canvas is a background layer only. If WebGL is unavailable
  or the visitor prefers reduced motion, we bail out and the static .amb
  gradient (already in the page) shows instead.
*/
import * as THREE from 'three';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('scene-canvas');

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}

/* ---------- palette (mirrors CSS custom properties) ---------- */
const INK = 0xf1e9d9, ACCENT = 0xff7a4d, GOLD = 0xf5c451, DIM = 0x2c3d44;

/* ---------- catmull-rom helper over plain {x,y,z} arrays ---------- */
function crPoint(pts, i, u) {
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(pts.length - 1, i + 1)], p3 = pts[Math.min(pts.length - 1, i + 2)];
  const t2 = u * u, t3 = t2 * u;
  const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: f(p0.x, p1.x, p2.x, p3.x),
    y: f(p0.y, p1.y, p2.y, p3.y),
    z: f(p0.z, p1.z, p2.z, p3.z),
  };
}
function pathAt(pts, t) {
  const segs = pts.length - 1;
  const scaled = Math.min(segs - 1e-6, Math.max(0, t * segs));
  const i = Math.floor(scaled);
  return crPoint(pts, i, scaled - i);
}

function init() {
  const CAM_PATH = [
    { x: 0, y: 0, z: 0 },
    { x: 1.4, y: -0.25, z: -15 },
    { x: -1.2, y: 0.35, z: -30 },
    { x: 1.6, y: -0.15, z: -46 },
    { x: 0, y: 0.15, z: -60 },
  ];
  const STATION_OFFSET = [
    { x: 2.3, y: 0.3, z: -8 },
    { x: 3.6, y: 0.5, z: -8.5 },
    { x: -4.4, y: 0.2, z: -9 },
    { x: 4.4, y: 0.9, z: -10 },
    { x: 4.6, y: -0.9, z: -6 },
  ];
  const STATION_LIGHT_COLOR = [ACCENT, ACCENT, ACCENT, GOLD, GOLD];

  const scene = new THREE.Scene();
  // depth cue only (not mood lighting): keeps the upcoming station from reading
  // as prominently as the one currently in frame, since local per-station lights
  // don't otherwise attenuate with camera distance.
  scene.fog = new THREE.Fog(0x081a23, 5, 22);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch (e) { canvas.remove(); return; }
  renderer.setClearColor(0x081a23, 1);

  scene.add(new THREE.AmbientLight(0x1c3946, 1.4));
  const key = new THREE.PointLight(INK, 2.2, 12, 2);
  key.position.set(0, 3, 5);
  scene.add(key);

  /* ---------- stations ---------- */
  const stations = [buildModelCluster(), buildInspector(), buildLayerStack(), buildFlagship(), buildBeacon()];
  stations.forEach((g, i) => {
    if (!g) return;
    const p = CAM_PATH[i], o = STATION_OFFSET[i];
    g.position.set(p.x + o.x, p.y + o.y, p.z + o.z);
    // each station carries its own light — a single global light can't reach
    // every waypoint along a 60-unit path, and distant stations rendered flat without one
    const light = new THREE.PointLight(STATION_LIGHT_COLOR[i], 5, 9, 2);
    light.position.set(1.2, 1, 2.4);
    g.add(light);
    scene.add(g);
  });

  function buildModelCluster() {
    const g = new THREE.Group();
    const LAYERS = [5, 7, 7, 5, 3];
    const nodes = [];
    const lineGeo = new THREE.BufferGeometry();
    const linePositions = [];
    LAYERS.forEach((count, li) => {
      const x = (li - (LAYERS.length - 1) / 2) * 1.15;
      for (let i = 0; i < count; i++) {
        const y = (i - (count - 1) / 2) * 0.62;
        nodes.push({ x, y, layer: li });
      }
    });
    const startOf = LAYERS.reduce((acc, c, i) => { acc.push((acc[i - 1] ?? 0) + (i ? LAYERS[i - 1] : 0)); return acc; }, []);
    for (let li = 0; li < LAYERS.length - 1; li++) {
      const a0 = startOf[li], a1 = a0 + LAYERS[li], b0 = a1, b1 = b0 + LAYERS[li + 1];
      for (let a = a0; a < a1; a++) for (let b = b0; b < b1; b++) {
        if (Math.random() > 0.55) continue;
        linePositions.push(nodes[a].x, nodes[a].y, 0, nodes[b].x, nodes[b].y, 0);
      }
    }
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    g.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.08 })));
    const sphereGeo = new THREE.SphereGeometry(0.09, 12, 12);
    g.userData.pulses = [];
    nodes.forEach((n) => {
      const mat = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.4, roughness: 0.4 });
      const m = new THREE.Mesh(sphereGeo, mat);
      m.position.set(n.x, n.y, 0);
      g.add(m);
      g.userData.pulses.push({ mesh: m, mat, phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 0.6 });
    });
    g.userData.tick = (t) => {
      g.rotation.y = Math.sin(t * 0.05) * 0.18;
      g.userData.pulses.forEach((p) => {
        const v = 0.35 + Math.sin(t * p.speed + p.phase) * 0.35 + 0.35;
        p.mat.emissiveIntensity = v;
      });
    };
    return g;
  }

  function buildInspector() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 24, 24),
      new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.55, roughness: 0.35 })
    );
    g.add(core);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.78, 48),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
    );
    g.add(halo);
    const halo2 = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.0, 48),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
    );
    g.add(halo2);
    // a few satellite fragments — the "parts under inspection"
    const frags = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.11, 0),
        new THREE.MeshStandardMaterial({ color: INK, emissive: ACCENT, emissiveIntensity: 0.5, roughness: 0.4 })
      );
      const a = (i / 6) * Math.PI * 2;
      m.userData.a = a; m.userData.r = 1.25;
      g.add(m); frags.push(m);
    }
    g.userData.tick = (t) => {
      halo.rotation.z = t * 0.15;
      halo2.rotation.z = -t * 0.1;
      frags.forEach((m, i) => {
        const a = m.userData.a + t * 0.25;
        m.position.set(Math.cos(a) * m.userData.r, Math.sin(a) * m.userData.r * 0.6, Math.sin(t * 0.4 + i) * 0.3);
        m.rotation.x = t * 0.6; m.rotation.y = t * 0.4;
      });
    };
    return g;
  }

  function buildLayerStack() {
    const g = new THREE.Group();
    g.rotation.x = 1.05; // tilt so plate faces are visible, not viewed edge-on
    g.rotation.z = 0.18;
    const labels = 5;
    const plates = [];
    for (let i = 0; i < labels; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x123647, emissive: ACCENT, emissiveIntensity: 0.12 + i * 0.03,
        roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.88, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.09, 40), mat);
      m.position.y = (i - (labels - 1) / 2) * 0.68;
      g.add(m); plates.push(m);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.012, 8, 40),
        new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5 })
      );
      rim.rotation.x = Math.PI / 2; rim.position.y = m.position.y;
      g.add(rim);
    }
    g.userData.tick = (t) => {
      plates.forEach((m, i) => { m.rotation.y = t * (0.06 + i * 0.01); });
      g.rotation.y = Math.sin(t * 0.04) * 0.25;
    };
    return g;
  }

  function buildFlagship() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.16, 24, 100),
      new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.2 })
    );
    ring.rotation.x = Math.PI / 2.4;
    g.add(ring);
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.62, 1),
      new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: GOLD, emissiveIntensity: 0.85, roughness: 0.25 })
    );
    g.add(core);
    const sats = [];
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 16, 16),
        new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.6 })
      );
      s.userData.a = i * Math.PI; s.userData.r = 2.1 + i * 0.4;
      g.add(s); sats.push(s);
    }
    g.userData.tick = (t) => {
      ring.rotation.z = t * 0.12;
      core.rotation.y = t * 0.3; core.rotation.x = t * 0.18;
      sats.forEach((s) => {
        const a = s.userData.a + t * 0.22;
        s.position.set(Math.cos(a) * s.userData.r, Math.sin(t * 0.5) * 0.4, Math.sin(a) * s.userData.r);
      });
    };
    return g;
  }

  function buildBeacon() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: GOLD, emissiveIntensity: 0.9, roughness: 0.2 })
    );
    g.add(core);
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.56, 48),
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, side: THREE.DoubleSide })
      );
      g.add(r); rings.push(r);
    }
    g.userData.tick = (t) => {
      rings.forEach((r, i) => {
        const local = ((t * 0.35) + i / rings.length) % 1;
        const s = 1 + local * 2.1;
        r.scale.set(s, s, s);
        r.material.opacity = Math.max(0, 0.55 * (1 - local));
      });
      core.scale.setScalar(1 + Math.sin(t * 1.6) * 0.06);
    };
    return g;
  }

  /* ---------- ambient data-packet particles threading the whole path ---------- */
  const PARTICLE_COUNT = 46;
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const phases = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) phases[i] = i / PARTICLE_COUNT;
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const particleMat = new THREE.PointsMaterial({
    size: 0.11, map: dotTexture(), transparent: true, depthWrite: false,
    vertexColors: true, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);
  const cAccent = new THREE.Color(ACCENT), cGold = new THREE.Color(GOLD);

  function dotTexture() {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }

  /* ---------- scroll progress (mirrors the inline deploy-progress calc) ---------- */
  const pipelineEl = document.getElementById('top');
  const STAGE_IDS = ['s-hero', 's-research', 's-train', 's-ship', 's-contact'];
  let breakpoints = [0, 0.25, 0.5, 0.75, 1];
  function computeBreakpoints() {
    const total = Math.max(1, pipelineEl.offsetHeight - innerHeight);
    breakpoints = STAGE_IDS.map((id) => {
      const el = document.getElementById(id);
      return el ? Math.min(1, Math.max(0, el.offsetTop / total)) : 0;
    });
    breakpoints[0] = 0;
  }
  function scrollProg() {
    const total = pipelineEl.offsetHeight - innerHeight;
    return Math.min(1, Math.max(0, (-pipelineEl.getBoundingClientRect().top) / (total || 1)));
  }
  function progToPathT(prog) {
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const a = breakpoints[i], b = breakpoints[i + 1];
      if (prog <= b || i === breakpoints.length - 2) {
        const u = b > a ? (prog - a) / (b - a) : 0;
        return (i + Math.min(1, Math.max(0, u))) / (breakpoints.length - 1);
      }
    }
    return 1;
  }

  /* ---------- resize ---------- */
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', () => { computeBreakpoints(); resize(); }, { passive: true });

  /* ---------- render loop ---------- */
  let smoothT = 0, running = true;
  const clock = new THREE.Clock();
  function frame() {
    if (!running) return;
    const t = clock.getElapsedTime();
    const targetT = progToPathT(scrollProg());
    smoothT += (targetT - smoothT) * 0.07;

    const camPos = pathAt(CAM_PATH, smoothT);
    camera.position.set(camPos.x, camPos.y + 0.15, camPos.z);

    // Central difference for the forward direction: a one-sided sample clamps
    // to camPos itself right at either end of the path (t=0 or t=1), collapsing
    // the look vector to zero and letting the station-bias term fully dictate
    // orientation regardless of its weight. Only one side can clamp at a time,
    // so forward-minus-behind always stays a valid, non-degenerate direction.
    const ahead = pathAt(CAM_PATH, Math.min(1, smoothT + 0.035));
    const behind = pathAt(CAM_PATH, Math.max(0, smoothT - 0.035));
    const lookPos = {
      x: camPos.x + (ahead.x - behind.x),
      y: camPos.y + (ahead.y - behind.y),
      z: camPos.z + (ahead.z - behind.z),
    };

    const activeIdx = Math.round(smoothT * (CAM_PATH.length - 1));
    const station = stations[Math.max(1, activeIdx)];
    const bias = station ? 0.12 : 0;
    const look = new THREE.Vector3(lookPos.x, lookPos.y + 0.15, lookPos.z);
    if (station) look.lerp(station.position, bias);
    camera.lookAt(look);

    stations.forEach((g) => g && g.userData.tick && g.userData.tick(t));

    const posAttr = particles.geometry.attributes.position;
    const colAttr = particles.geometry.attributes.color;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const pt = (phases[i] + t * 0.03) % 1;
      const p = pathAt(CAM_PATH, pt);
      posAttr.setXYZ(i, p.x + Math.sin(t + i) * 0.15, p.y + Math.cos(t * 0.7 + i) * 0.15, p.z);
      const col = cAccent.clone().lerp(cGold, pt);
      colAttr.setXYZ(i, col.r, col.g, col.b);
    }
    posAttr.needsUpdate = true; colAttr.needsUpdate = true;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });

  computeBreakpoints();
  resize();
  requestAnimationFrame(frame);
  // recompute breakpoints once fonts/layout settle (web fonts can reflow section heights)
  setTimeout(computeBreakpoints, 400);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(computeBreakpoints);
}

if (canvas && !reduce && supportsWebGL()) {
  init();
} else if (canvas) {
  canvas.remove();
}
