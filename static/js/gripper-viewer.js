// Interactive 3D ContactUMI gripper (WEBSITE_PLAN Step 6b).
// Plain ES module. three.js (vendored r170, via the import map) and the GLB are
// loaded lazily when #gripper-viewer comes within 600 px of the viewport.
// t in [0,1]: 0 = assembled, 1 = exploded. Rendering is on demand only.

const viewer = document.getElementById('gripper-viewer');

/* ------------------------------------------------------------------ constants */

// Reference camera of gripper_assemble.mp4 (Blender v1_45 view after the 4 % fit),
// in the same world frame as the Blender scene (root rotX = -pi/2, scale 0.001).
// Source: web-build/gripper_check/verification.json (camera).
const REF_CAM = {
  position: [-1.2557202565335246, 0.8656345037408116, -0.8255749361935671],
  quaternion: [0.019123, -0.870863, -0.279671, 0.403753],
  vfov: 13.126818661185155, // degrees, rendered at 1920x1080
  aspect: 1920 / 1080,
  relevel: 20, // render_explode.py --relevel 20: the floor is level, camera looks down 20 deg, zero roll
};

// Label anchors. Slide-6 labels only (Carriages / Mount modules get hover tint but no chip).
// `anchor` overrides which solids define the chip position (default: the whole module).
//
// SERVO_SOLIDS: Step 6a left modules.servo empty. Solid 050 (29.0 x 34.0 x 20.1 mm box,
// "trigger_housing" in explode_map.json) sits directly behind the trigger lever 049, whose
// round hub fits a servo horn; 048 is the 2 mm mounting plate beside it. In
// identify_explode_iso_labeled.png 050 is the only servo-sized box in the handle group, and
// the slide's "Servo force feedback - contact force felt on the trigger" puts the servo on
// the trigger. So the Servo label is mapped here (JS only; gripper-parts.json untouched):
// 048 + 050 are treated as module "servo" for labels and hover, and leave "handle".
// Wrist Camera: no camera solid exists in the CAD export (every unassigned solid is a
// <= 12 mm screw, pin or bearing), so that label is omitted.
const SERVO_SOLIDS = ['048', '050'];
const LABELS = [
  { module: 'tracker', text: 'Vive Tracker' },
  { module: 'ft_sensor', text: '6-axis F/T sensor' },
  { module: 'handle', text: 'Handle', anchor: ['046'] }, // the grip itself, not the trigger
  { module: 'camera', text: 'Wrist Camera' }, // omitted automatically (no solids)
  { module: 'motor', text: 'Motor', anchor: ['042', '043'] }, // motor body, not the pinion in the rail
  { module: 'servo', text: 'Servo' },
  { module: 'rail', text: 'Rail' },
  { module: 'tactile', text: 'Tactile Sensor' },
];

const EXPLODE_MS = 1600; // Assembled <-> Exploded buttons
const INTRO_MS = 2400; // first-view assemble -> explode
const HOVER_TINT = 0.35; // emissive intensity of the hovered module
// Blender 4 Principled "Sheen" defaults to a WHITE tint (roughness 0.5) and, in Cycles under the
// bright white studio world, turns the near-black soft-touch handle (#141416, sheen 0.4) light grey.
// three's sheenColor defaults to black (sheen = no-op, handle renders black), which is why a plain
// material port shows a dark handle. With a white sheenColor plus the studio rig below, the handle
// reads light grey as in the reference; SHEEN_TINT > 1 would brighten it further.
const SHEEN_TINT = 1.0;

// Lighting: RoomEnvironment (dimmed) + the Blender studio rig of render_explode.py baked into the
// same PMREM environment. Rig = camera-relative area lights (right, up, back weights; size m;
// radiance = P / (pi * A) with S = 2.2 and EXPLODE_KEY = 4 on key/fill; color). Distance 1.3*S.
const RIG_S = 2.2;
const RIG = [
  { dir: [-0.45, 0.55, 0.95], size: 1.4 * RIG_S * 1.5, power: 45 * RIG_S * RIG_S * 4, color: [1.0, 0.97, 0.93] }, // key
  { dir: [0.90, 0.10, 0.60], size: 1.2 * RIG_S * 1.5, power: 10 * RIG_S * RIG_S * 4, color: [0.93, 0.96, 1.0] }, // fill
  { dir: [-0.35, 0.65, -0.70], size: 0.6 * RIG_S, power: 20 * RIG_S * RIG_S, color: [1, 1, 1] }, // rim
  { dir: [0.65, 0.30, -0.70], size: 0.4 * RIG_S, power: 15 * RIG_S * RIG_S, color: [0.6, 0.8, 1.0] }, // rim2 (dark_metal)
];
const ROOM_DIM = 0.2; // RoomEnvironment stands in for Blender's grey world dome (strength ~0.2)
const ROOM_TINT = [0.96, 1.0, 1.09]; // that dome's colour (0.55, 0.57, 0.62), normalised
const RIG_GAIN = 1.0;
const FLOOR_GAP = 0.01; // m, render_explode.py floor_gap
const CREASE_ANGLE = (30 * Math.PI) / 180;

// Lab-grid floor of the Blender render (render_explode.py --bg grid, GRID_LOOK['grid'] + grid_tile_png +
// compose_grid.py): 0.2 m major cell with 4 minor cells, 1024 px tile with 4 px minor / 2x4 px major lines,
// horizon fade to white over image rows 2 %..42 % and a 0.14 vignette. The row fade is reproduced as a fade on
// the floor's distance from the camera (matched at the reference camera, follows the orbit camera).
const GRID = {
  cell: 0.2, minor: 4,
  minorW: 0.2 * 4 / 1024, majorW: 0.2 * 8 / 1024, // m
  bg: 0xe9ecf0, minorC: 0xd6dae0, majorC: 0xbfc5cd, // sRGB, written to the canvas as is
  fadeRows: [0.02, 0.42], vignette: 0.14,
};
const MAX_POLAR = (84 * Math.PI) / 180; // keep the orbit camera above the floor

/* ------------------------------------------------------------------ helpers */

const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); }; // render_explode.py smooth()
const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

if (viewer) setup();

function setup() {
  const stage = $('gv-stage');
  const progress = $('gv-progress');
  let started = false;
  const near = new IntersectionObserver(entries => {
    if (started || !entries.some(e => e.isIntersecting)) return;
    started = true;
    near.disconnect();
    if (!hasWebGL()) { fallback('WebGL unavailable'); return; }
    if (progress) progress.textContent = 'Loading 3D model…';
    start().catch(err => fallback(err && err.message ? err.message : String(err)));
  }, { rootMargin: '600px 0px' });
  near.observe(stage || viewer);
}

/* ------------------------------------------------------------------ fallback */

let fellBack = false;
function fallback(reason) {
  if (fellBack) return;
  fellBack = true;
  console.info('[gripper-viewer] showing video fallback:', reason);
  const stage = $('gv-stage');
  if (!stage) return;
  stage.querySelectorAll('canvas').forEach(c => c.remove());
  const labels = $('gv-labels');
  if (labels) labels.replaceChildren();
  for (const id of ['gv-progress', 'gv-hint']) { const el = $(id); if (el) el.hidden = true; }
  const ui = viewer.querySelector('.viewer-ui');
  if (ui) { ui.hidden = true; ui.style.display = 'none'; } // .viewer-ui sets display:flex, which beats [hidden]
  viewer.classList.add('gv-fallback');
  const v = document.createElement('video');
  v.muted = true; v.loop = true; v.playsInline = true;
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  if (viewer.dataset.fallbackPoster) v.poster = viewer.dataset.fallbackPoster;
  v.setAttribute('aria-label', 'ContactUMI gripper assembly animation');
  if (reducedMotion) v.controls = true; else v.autoplay = true;
  v.src = viewer.dataset.fallbackVideo;
  stage.style.cursor = 'auto';
  stage.prepend(v);
  if (!reducedMotion) v.play().catch(() => {});
}

/* ------------------------------------------------------------------ viewer */

async function start() {
  const progress = $('gv-progress');
  const [THREE, { OrbitControls }, { GLTFLoader }, { MeshoptDecoder }, { RoomEnvironment }, { toCreasedNormals }] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
    import('three/addons/environments/RoomEnvironment.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
  ]);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [parts, gltf] = await Promise.all([
    fetch(viewer.dataset.parts).then(r => { if (!r.ok) throw new Error('parts ' + r.status); return r.json(); }),
    loader.loadAsync(viewer.dataset.model, ev => {
      if (progress && ev.total) progress.textContent = `Loading 3D model… ${Math.round(100 * ev.loaded / ev.total)} %`;
    }),
  ]);
  if (fellBack) return;

  const stage = $('gv-stage');
  const labelsEl = $('gv-labels');
  const hint = $('gv-hint');
  const btnA = $('gv-assembled');
  const btnE = $('gv-exploded');
  const range = $('gv-range');
  const btnLabels = $('gv-labels-toggle');
  const btnReset = $('gv-reset');

  // loop / UI state (declared up front: setT() and requestRender() run during setup)
  let raf = 0;
  let frames = 0;
  let tween = null;
  let introPending = true;
  let hot = null;
  let anchorsDirty = true;
  let floor = null;
  let grid = null;
  let cameraDirty = true;

  /* renderer */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0); // CSS gradient shows through
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping; // Blender reference used AgX
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap; // soft contact-style shadows on the floor only
  renderer.shadowMap.autoUpdate = false; // only re-rendered when parts move
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Interactive 3D model of the ContactUMI gripper');
  canvas.setAttribute('role', 'img');
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fallback('WebGL context lost'); });
  stage.prepend(canvas);

  const scene = new THREE.Scene();
  // (environment is built below, once the reference camera axes are known)

  /* world leveling: rotate the Blender world so the reference "floor up" becomes +Y.
     Camera-space world-up after --relevel E is (0, cos E, sin E); applying the same rotation to
     camera and model keeps the reference view exactly while OrbitControls gets a Y-up frame. */
  const q0 = new THREE.Quaternion().fromArray(REF_CAM.quaternion).normalize();
  const e = THREE.MathUtils.degToRad(REF_CAM.relevel);
  const upW = new THREE.Vector3(0, Math.cos(e), Math.sin(e)).applyQuaternion(q0).normalize();
  const level = new THREE.Quaternion().setFromUnitVectors(upW, new THREE.Vector3(0, 1, 0));

  const world = new THREE.Group();
  world.quaternion.copy(level);
  scene.add(world);
  const root = new THREE.Group();
  root.rotation.x = parts.root.rotX;
  root.scale.setScalar(parts.root.scale);
  world.add(root);
  root.add(gltf.scene);

  /* materials and per-solid data */
  const matSpec = parts.materials || {};
  const servoSet = new Set(SERVO_SOLIDS);
  const solids = []; // {mesh, A, E, t0, dur, module}
  let creaseMs = 0;
  const byModule = new Map();
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const key = o.name.replace(/^s_/, '');
    const spec = parts.solids[key];
    if (!spec) return;
    const m = matSpec[spec.part] || matSpec.fastener || { color: '#9a9ea4', metalness: 1, roughness: 0.3 };
    const mat = new THREE.MeshPhysicalMaterial({
      color: m.color,
      metalness: m.metalness ?? 0,
      roughness: m.roughness ?? 0.5,
      clearcoat: m.clearcoat ?? 0,
      clearcoatRoughness: 0.08,
      sheen: m.sheen ?? 0,
      sheenColor: new THREE.Color(1, 1, 1).multiplyScalar(SHEEN_TINT),
      sheenRoughness: 0.5,
    });
    if (m.emissive) { mat.emissive.set(m.emissive); mat.emissiveIntensity = m.emissiveIntensity ?? 1; }
    o.material = mat;
    // The GLB carries fully smoothed normals (coincident vertices merged), which smears shading
    // across the flat faces of machined parts. Blender used shade_smooth_by_angle(30 deg).
    const t0n = performance.now();
    const smoothGeo = o.geometry;
    o.geometry = toCreasedNormals(smoothGeo, CREASE_ANGLE);
    smoothGeo.dispose();
    creaseMs += performance.now() - t0n;
    o.castShadow = true;
    o.receiveShadow = false; // shadows land on the floor only (as in the reference)
    o.geometry.computeBoundingBox();
    const module = servoSet.has(key) ? 'servo' : spec.module;
    const s = {
      key, mesh: o, module,
      A: new THREE.Vector3().fromArray(spec.A),
      E: new THREE.Vector3().fromArray(spec.E),
      t0: spec.t0, dur: spec.dur,
      baseEmissive: mat.emissive.clone(), baseEmissiveIntensity: mat.emissiveIntensity,
    };
    o.userData.solid = s;
    solids.push(s);
    if (!byModule.has(module)) byModule.set(module, []);
    byModule.get(module).push(s);
  });
  if (!solids.length) throw new Error('no solids in GLB');
  const T0 = Math.min(...solids.map(s => s.t0));
  const T1 = Math.max(...solids.map(s => s.t0 + s.dur));

  /* explode state */
  let t = -1;
  function setT(v) {
    v = clamp01(v);
    if (v === t) return;
    t = v;
    // viewer t=1 -> video time T0 (exploded), t=0 -> T1 (assembled); per-solid smoothstep window.
    const tau = T0 + (1 - t) * (T1 - T0);
    for (const s of solids) {
      const k = 1 - smooth((tau - s.t0) / s.dur);
      s.mesh.position.copy(s.A).lerp(s.E, k);
    }
    world.updateMatrixWorld(true);
    renderer.shadowMap.needsUpdate = true;
    anchorsDirty = true;
    if (floor) { // floor follows the lowest part of the current state (render_explode.py drop_floor)
      let ymin = Infinity;
      for (const s of solids) ymin = Math.min(ymin, tmpBox.copy(s.mesh.geometry.boundingBox).applyMatrix4(s.mesh.matrixWorld).min.y);
      floor.position.y = ymin - FLOOR_GAP;
      if (grid) grid.position.y = floor.position.y;
    }
    range.value = String(Math.round(t * 100) / 100);
    const sel = tween ? tween.to : t; // keep the tween's destination highlighted while it runs
    btnA.classList.toggle('on', sel === 0);
    btnE.classList.toggle('on', sel === 1);
    btnA.setAttribute('aria-pressed', String(sel === 0));
    btnE.setAttribute('aria-pressed', String(sel === 1));
    requestRender();
  }

  // Bounds of both end states (world, leveled) for floor, shadow camera and orbit target.
  const box = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  function unionBounds(target) {
    for (const s of solids) target.union(tmpBox.copy(s.mesh.geometry.boundingBox).applyMatrix4(s.mesh.matrixWorld));
  }
  setT(1); unionBounds(box);
  setT(0); unionBounds(box);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = size.length() / 2;

  /* camera: reference view in the leveled frame */
  const camera = new THREE.PerspectiveCamera(REF_CAM.vfov, REF_CAM.aspect, 0.01, 20);
  const P0 = new THREE.Vector3().fromArray(REF_CAM.position).applyQuaternion(level);
  const Q0 = level.clone().multiply(q0);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(Q0);
  const target0 = P0.clone().addScaledVector(fwd, center.clone().sub(P0).dot(fwd)); // on the view ray, nearest the model
  camera.position.copy(P0);
  camera.quaternion.copy(Q0);
  const d0 = P0.distanceTo(target0);
  {
    const env = new RoomEnvironment();
    env.traverse(o => {
      if (o.isLight) { o.intensity *= ROOM_DIM; o.color.setRGB(...ROOM_TINT); }
      else if (o.isMesh && o.material.isMeshBasicMaterial) o.material.color.multiplyScalar(ROOM_DIM).multiply(new THREE.Color().setRGB(...ROOM_TINT));
    });
    const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map(a => a.applyQuaternion(Q0));
    const panelGeo = new THREE.PlaneGeometry(1, 1);
    for (const L of RIG) {
      const d = ax[0].clone().multiplyScalar(L.dir[0]).addScaledVector(ax[1], L.dir[1]).addScaledVector(ax[2], L.dir[2]).normalize();
      const radiance = RIG_GAIN * L.power / (Math.PI * L.size * L.size);
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      mat.color.setRGB(L.color[0] * radiance, L.color[1] * radiance, L.color[2] * radiance);
      const panel = new THREE.Mesh(panelGeo, mat);
      panel.scale.set(L.size, L.size, 1);
      panel.position.copy(d).multiplyScalar(1.3 * RIG_S);
      panel.lookAt(0, 0, 0);
      env.add(panel);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    env.dispose();
  }
  const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(REF_CAM.vfov / 2)) * REF_CAM.aspect);

  /* floor shadow + key light */
  floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 8, radius * 8), new THREE.ShadowMaterial({ color: 0x1d2433, opacity: 0.15 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, box.min.y - FLOOR_GAP, center.z);
  floor.receiveShadow = true;
  floor.renderOrder = 1; // drawn over the grid; the grid writes no depth, so the coplanar planes cannot z-fight
  scene.add(floor);

  /* lab-grid floor (see GRID). Analytic anti-aliased lines (Ben Golus' "pristine grid"), alpha fade by the
     floor's distance from the camera beyond the orbit target (the render's row fade at the reference view) times a
     radial fade around the model, so no plane edge shows at any orbit angle or zoom. Colours are sRGB and bypass tone mapping. */
  {
    const fy = box.min.y - FLOOR_GAP;
    const rowNdc = r => 1 - 2 * r; // image row fraction (from the top) -> NDC y
    const tanV = Math.tan(THREE.MathUtils.degToRad(REF_CAM.vfov / 2));
    const refRay = (x, y) => new THREE.Vector3(x * tanV * REF_CAM.aspect, y * tanV, -1).applyQuaternion(Q0).normalize();
    const hit = (x, y) => { const d = refRay(x, y); return d.y > -1e-4 ? null : P0.clone().addScaledVector(d, (fy - P0.y) / d.y); };
    const hitDist = (x, y) => { const p = hit(x, y); return p ? Math.hypot(p.x - center.x, p.z - center.z) : Infinity; };
    // horizon fade: horizontal distance from the camera, beyond the orbit target, of the reference fade rows
    const camDist = p => Math.hypot(p.x - P0.x, p.z - P0.z);
    const beyond = r => { const p = hit(0, rowNdc(r)); return (p ? camDist(p) : 10) - camDist(target0); };
    let r0 = 0;
    for (const [x, y] of [[-1, -1], [1, -1], [0, -1], [-1, rowNdc(GRID.fadeRows[1])], [1, rowNdc(GRID.fadeRows[1])]]) r0 = Math.max(r0, hitDist(x, y));
    r0 = Math.min(r0 * 1.15, 3);
    const r1 = Math.max(r0 * 1.6, Math.min(hitDist(0, rowNdc(GRID.fadeRows[0])), 6));
    // grid axes: Blender's floor X/Y after --relevel (Rz: up_w -> +Z), carried into this Y-up leveled frame
    const Rz = new THREE.Quaternion().setFromUnitVectors(upW, new THREE.Vector3(0, 0, 1));
    const M = level.clone().multiply(Rz.invert());
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(M), ay = new THREE.Vector3(0, 1, 0).applyQuaternion(M);
    const srgb = hex => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
    const gridMat = new THREE.ShaderMaterial({
      uniforms: {
        uAxU: { value: new THREE.Vector2(ax.x, ax.z) },
        uAxV: { value: new THREE.Vector2(ay.x, ay.z) },
        uCenter: { value: new THREE.Vector2(center.x, center.z) },
        // Blender's plane sits at (-cell/2, -cell/2) with the tile edges on its corners: majors at +-cell/2 (mod cell)
        uOffset: { value: 0.5 * GRID.cell },
        uCell: { value: GRID.cell }, uMinor: { value: GRID.minor },
        uWidth: { value: new THREE.Vector2(GRID.minorW * GRID.minor / GRID.cell, GRID.majorW / GRID.cell) },
        uBg: { value: srgb(GRID.bg) }, uMinorC: { value: srgb(GRID.minorC) }, uMajorC: { value: srgb(GRID.majorC) },
        uTarget: { value: new THREE.Vector2(target0.x, target0.z) },
        uFade: { value: new THREE.Vector4(beyond(GRID.fadeRows[1]), Math.min(beyond(GRID.fadeRows[0]), 6), r0, r1) },
        uRes: { value: new THREE.Vector2(1, 1) },
        uVignette: { value: GRID.vignette },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec2 uAxU, uAxV, uCenter, uTarget, uWidth, uRes;
        uniform float uOffset, uCell, uMinor, uVignette;
        uniform vec3 uBg, uMinorC, uMajorC;
        uniform vec4 uFade;
        varying vec3 vWorld;
        // coverage of a 1-D-per-axis line grid with lines at integer uv, full line width w (uv units)
        float pristineGrid(vec2 uv, vec2 w) {
          vec2 dd = vec2(length(vec2(dFdx(uv.x), dFdy(uv.x))), length(vec2(dFdx(uv.y), dFdy(uv.y))));
          vec2 drawW = clamp(w, dd, vec2(0.5));
          vec2 aa = dd * 1.5;
          vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
          vec2 l = smoothstep(drawW + aa, drawW - aa, g);
          l *= clamp(w / drawW, 0.0, 1.0);
          l = mix(l, w, clamp(dd * 2.0 - 1.0, 0.0, 1.0)); // sub-pixel cells: average coverage, no moire
          return mix(l.x, 1.0, l.y);
        }
        void main() {
          vec2 xz = vWorld.xz;
          vec2 q = (vec2(dot(xz, uAxU), dot(xz, uAxV)) - uOffset) / uCell;
          float major = pristineGrid(q, vec2(uWidth.y));
          float minor = pristineGrid(q * uMinor, vec2(uWidth.x));
          vec3 c = mix(mix(uBg, uMinorC, minor), uMajorC, major);
          // fade to the horizon: by distance from the camera beyond the orbit target (the render's row fade at
          // the reference view; still shows the floor around the model from low angles), and radially around the model
          float beyond = length(xz - cameraPosition.xz) - length(uTarget - cameraPosition.xz);
          float a = (1.0 - smoothstep(uFade.x, uFade.y, beyond)) * (1.0 - smoothstep(uFade.z, uFade.w, length(xz - uCenter)));
          vec2 s = gl_FragCoord.xy / uRes * 2.0 - 1.0;
          c *= 1.0 - uVignette * 0.5 * dot(s, s);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const span = 2 * r1 + 2 * GRID.cell; // alpha is 0 well inside the plane's edge
    grid = new THREE.Mesh(new THREE.PlaneGeometry(span, span), gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.set(center.x, fy, center.z);
    grid.renderOrder = -1;
    grid.frustumCulled = false;
    grid.raycast = () => {}; // never picked
    scene.add(grid);
  }

  const key = new THREE.DirectionalLight(0xffffff, 0.3); // mainly casts the floor shadow
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(Q0); camRight.y = 0; camRight.normalize();
  const camBack = fwd.clone().negate(); camBack.y = 0; camBack.normalize();
  key.position.copy(center).addScaledVector(camRight, -0.12 * radius * 3).addScaledVector(camBack, 0.12 * radius * 3).add(new THREE.Vector3(0, radius * 3, 0));
  key.target.position.copy(center);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 14;
  key.shadow.blurSamples = 16;
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -radius * 1.2; sc.right = sc.top = radius * 1.2;
  sc.near = radius * 0.5; sc.far = radius * 6;
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);

  /* controls */
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false; // enabled only while the user is engaged with the canvas (see below)
  controls.minDistance = 0.5 * d0;
  controls.maxDistance = 2 * d0;
  controls.rotateSpeed = 0.8;
  controls.maxPolarAngle = MAX_POLAR; // never under the grid floor
  controls.update();
  controls.saveState();
  // User input (pointer/wheel handlers call update() themselves) wakes the loop. Changes emitted by
  // the loop's own update() are ignored: whether to keep going is decided by real camera motion,
  // because r170's update() reports a change every frame while the distance sits on a zoom clamp
  // (radius re-clamped by 1 ulp), which would otherwise keep the loop alive forever.
  let inFrame = false;
  controls.addEventListener('change', () => { cameraDirty = true; if (!inFrame) requestRender(); });
  const lastPos = new THREE.Vector3();
  const lastQuat = new THREE.Quaternion();

  // Wheel-zoom only after the pointer went down on the canvas, so page scrolling over the
  // viewer is never hijacked. Touch: the first finger's pointerdown enables pinch-zoom.
  stage.addEventListener('pointerdown', () => { controls.enableZoom = true; }, true);
  stage.addEventListener('pointerleave', () => { controls.enableZoom = false; });
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (hint) hint.textContent = coarse ? 'Drag to rotate · pinch to zoom' : 'Drag to rotate · click, then scroll to zoom';

  /* labels */
  const labels = [];
  const labelWrap = labelsEl || stage;
  for (const L of LABELS) {
    const members = byModule.get(L.module);
    if (!members || !members.length) continue; // e.g. Wrist Camera: not identified
    const anchorSet = L.anchor ? solids.filter(s => L.anchor.includes(s.key)) : members;
    const chip = document.createElement('span');
    chip.textContent = L.text;
    chip.dataset.module = L.module;
    labelWrap.appendChild(chip);
    labels.push({ ...L, chip, anchorSet, world: new THREE.Vector3() });
  }
  const v3 = new THREE.Vector3();
  const lb = new THREE.Box3();
  function updateLabels() {
    if (anchorsDirty) {
      for (const L of labels) {
        lb.makeEmpty();
        for (const s of L.anchorSet) lb.union(tmpBox.copy(s.mesh.geometry.boundingBox).applyMatrix4(s.mesh.matrixWorld));
        lb.getCenter(L.world);
      }
    }
    const w = stage.clientWidth, h = stage.clientHeight;
    const op = smooth((t - 0.3) / 0.3); // invisible below t = 0.3, full from t = 0.6
    for (const L of labels) {
      v3.copy(L.world).project(camera);
      const visible = op > 0.01 && v3.z < 1;
      L.chip.style.opacity = visible ? String(op) : '0';
      L.chip.style.visibility = visible ? 'visible' : 'hidden';
      L.chip.style.left = ((v3.x + 1) / 2 * w).toFixed(1) + 'px';
      L.chip.style.top = ((1 - v3.y) / 2 * h).toFixed(1) + 'px';
    }
    anchorsDirty = false;
    cameraDirty = false;
  }

  /* hover / tap highlight */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = solids.map(s => s.mesh);
  const tint = new THREE.Color(getComputedStyle(viewer).getPropertyValue('--stage').trim() || '#3d5a80');
  function setHot(module) {
    if (module === hot) return;
    if (hot) for (const s of byModule.get(hot)) { s.mesh.material.emissive.copy(s.baseEmissive); s.mesh.material.emissiveIntensity = s.baseEmissiveIntensity; }
    hot = module;
    if (hot) for (const s of byModule.get(hot)) { s.mesh.material.emissive.copy(tint); s.mesh.material.emissiveIntensity = HOVER_TINT; }
    for (const L of labels) L.chip.classList.toggle('hot', L.module === hot);
    stage.style.cursor = hot ? 'pointer' : '';
    requestRender();
  }
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.solid.module : null;
  }
  let dragging = false;
  let pendingHover = null;
  let downAt = null;
  canvas.addEventListener('pointermove', ev => {
    if (ev.pointerType !== 'mouse' || dragging) return;
    pendingHover = ev; // raycast at most once per frame
    requestRender();
  });
  canvas.addEventListener('pointerleave', () => { pendingHover = null; if (!dragging) setHot(null); });
  canvas.addEventListener('pointerdown', ev => { downAt = [ev.clientX, ev.clientY]; });
  canvas.addEventListener('pointerup', ev => {
    if (ev.pointerType !== 'mouse' && downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) < 6) {
      const m = pick(ev.clientX, ev.clientY);
      setHot(m === hot ? null : m); // tap toggles
    }
    downAt = null;
  });
  controls.addEventListener('start', () => { dragging = true; stopIntro(); stage.style.cursor = 'grabbing'; });
  controls.addEventListener('end', () => { dragging = false; stage.style.cursor = hot ? 'pointer' : ''; });

  /* explode tween */
  function animateTo(target, ms) {
    if (reducedMotion || ms <= 0) { tween = null; setT(target); return; }
    tween = { from: t, to: target, t0: performance.now(), ms: ms * Math.abs(target - t) || 1 };
    btnA.classList.toggle('on', target === 0);
    btnE.classList.toggle('on', target === 1);
    btnA.setAttribute('aria-pressed', String(target === 0));
    btnE.setAttribute('aria-pressed', String(target === 1));
    requestRender();
  }
  function stopIntro() { introPending = false; }

  btnA.addEventListener('click', () => { stopIntro(); animateTo(0, EXPLODE_MS); });
  btnE.addEventListener('click', () => { stopIntro(); animateTo(1, EXPLODE_MS); });
  range.addEventListener('input', () => { stopIntro(); tween = null; setT(parseFloat(range.value)); });
  btnLabels.addEventListener('click', () => {
    const on = !viewer.classList.toggle('nolabels');
    btnLabels.setAttribute('aria-pressed', String(on));
  });
  btnReset.addEventListener('click', () => {
    controls.enableDamping = false; controls.update(); // flush residual damping motion
    controls.enableDamping = true;
    controls.reset();
    requestRender();
  });

  /* sizing */
  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    if (grid) renderer.getDrawingBufferSize(grid.material.uniforms.uRes.value); // vignette in canvas pixels
    camera.aspect = w / h;
    // keep the reference horizontal framing on narrower stages, its vertical framing on wider ones
    camera.fov = camera.aspect < REF_CAM.aspect
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / camera.aspect))
      : REF_CAM.vfov;
    camera.updateProjectionMatrix();
    cameraDirty = true;
    requestRender();
  }
  new ResizeObserver(resize).observe(stage);

  /* on-demand render loop */
  function requestRender() { if (!raf && !fellBack) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (tween) {
      const k = clamp01((now - tween.t0) / tween.ms);
      setT(tween.from + (tween.to - tween.from) * easeInOut(k));
      if (k >= 1) tween = null; else requestRender();
    }
    lastPos.copy(camera.position); lastQuat.copy(camera.quaternion);
    inFrame = true; controls.update(); inFrame = false; // damping step
    if (camera.position.distanceToSquared(lastPos) > 1e-12 || 1 - Math.abs(lastQuat.dot(camera.quaternion)) > 1e-12) {
      cameraDirty = true;
      requestRender(); // still settling
    }
    if (pendingHover) { const ev = pendingHover; pendingHover = null; setHot(pick(ev.clientX, ev.clientY)); }
    if (anchorsDirty || cameraDirty) updateLabels();
    renderer.render(scene, camera);
    frames++;
  }
  // test/diagnostic hook (no behaviour): frame counter and loop state
  viewer.gv = {
    get frames() { return frames; }, get idle() { return !raf; }, get t() { return t; },
    setT: v => { stopIntro(); tween = null; setT(v); },
    labels: () => labels.map(L => ({ module: L.module, x: parseFloat(L.chip.style.left), y: parseFloat(L.chip.style.top), opacity: parseFloat(L.chip.style.opacity), hot: L.chip.classList.contains('hot') })),
    get hot() { return hot; }, camera, controls, creaseMs: () => Math.round(creaseMs),
    floor: () => ({ y: floor.position.y, gridY: grid.position.y, fade: grid.material.uniforms.uFade.value.toArray() }),
  };

  /* start assembled, explode once when first visible */
  t = -1; // force a full refresh now that floor and labels exist
  setT(0);
  resize();
  if (progress) progress.textContent = '';
  viewer.classList.add('gv-ready');
  const vis = new IntersectionObserver(entries => {
    if (!entries.some(en => en.isIntersecting && en.intersectionRatio >= 0.35)) return;
    vis.disconnect();
    if (introPending) { introPending = false; animateTo(1, INTRO_MS); }
  }, { threshold: [0, 0.35, 0.6] });
  vis.observe(stage);
}
