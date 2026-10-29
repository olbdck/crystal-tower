// The 3D table: renderer, camera framing, the static world (table, board, frame, portals, candles,
// crystal) and the per-frame render. Dynamic objects live in sync.js, effects in fx.js.
import * as THREE from "three";
import { COLS, ROWS, CRYSTAL, LANE_WP, TOWERS } from "../sim/rules.js";
import { MAT, SEAT_HEX, col, geo, std, basic, part, glowSprite, initMaterials } from "./gfx.js";
import { towerModel } from "./models.js";
import { woodTexture, boardTexture } from "./textures.js";
import { syncTowers, syncEnemies, syncSynergy, updateCrystal, updateCursor, animateDecor, clearBoard, markWorldReady, takeShadowDirty } from "./sync.js";
import { updateFx } from "./fx.js";
import { drawOverlay } from "./overlay.js";

const $ = id => document.getElementById(id);
export const stage = $("stage"), glCanvas = $("gl"), ov = $("ov"), octx = ov.getContext("2d");
export let renderer = null, scene = null, camera = null;
let raycaster, groundPlane;
export let W = 1, H = 1, DPR = 1;
export let towerRoot, enemyRoot, fxRoot, synRoot, cursorRoot;
export const crystal = {}, decor = {};

function buildWorld() {
  scene.add(new THREE.HemisphereLight(col(0xffe2b8), col(0x2b170b), 0.62));
  const sun = new THREE.DirectionalLight(col(0xffdcaa), 1.35);
  sun.position.set(4, 18, 14); sun.target.position.set(10, 0, 6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 12, bottom: -12, near: 2, far: 48 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tableTex = woodTexture(3, "#5a3519", aniso); tableTex.repeat.set(7, 5);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.82, color: col(0xd9c0a6) }));
  table.rotation.x = -Math.PI / 2; table.position.set(10, -0.62, 6); table.receiveShadow = true; scene.add(table);

  const side = std(0x3a2a1c, { r: 0.9 });
  const top = new THREE.MeshStandardMaterial({ map: boardTexture(aniso), roughness: 0.92 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(COLS, 0.6, ROWS), [side, side, top, side, side, side]);
  slab.position.set(COLS / 2, -0.3, ROWS / 2); slab.receiveShadow = true; scene.add(slab);

  const frameTex = woodTexture(5, "#3d2311", aniso); frameTex.repeat.set(2, 0.3);
  const frameMat = new THREE.MeshStandardMaterial({ map: frameTex, roughness: 0.7, color: col(0xc79f7a) });
  const fw = 0.5, fh = 0.8, fy = 0.18 - fh / 2;
  const fbox = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, fh, d), frameMat); m.position.set(x, fy, z); m.castShadow = true; m.receiveShadow = true; scene.add(m); };
  const trim = (w, d, x, z) => part(scene, new THREE.BoxGeometry(w, 0.05, d), MAT.gold, x, 0.205, z, { noShadow: true });
  fbox(COLS + 2 * fw, fw, COLS / 2, -fw / 2); trim(COLS + 2 * fw, 0.07, COLS / 2, -0.04);
  fbox(COLS + 2 * fw, fw, COLS / 2, ROWS + fw / 2); trim(COLS + 2 * fw, 0.07, COLS / 2, ROWS + 0.04);
  fbox(fw, ROWS, COLS + fw / 2, ROWS / 2); trim(0.07, ROWS, COLS + 0.04, ROWS / 2);
  const gaps = LANE_WP.map(l => l[0][1]).sort((a, b) => a - b);
  let z0 = 0;
  for (const gz of gaps) { if (gz > z0) { fbox(fw, gz - z0, -fw / 2, (z0 + gz) / 2); trim(0.07, gz - z0, -0.04, (z0 + gz) / 2); } z0 = gz + 1; }
  fbox(fw, ROWS - z0, -fw / 2, (z0 + ROWS) / 2); trim(0.07, ROWS - z0, -0.04, (z0 + ROWS) / 2);
  for (const [x, z] of [[-fw / 2, -fw / 2], [COLS + fw / 2, -fw / 2], [-fw / 2, ROWS + fw / 2], [COLS + fw / 2, ROWS + fw / 2]]) {
    part(scene, geo("corner", () => new THREE.BoxGeometry(0.72, 0.95, 0.72)), MAT.woodDark, x, -0.62 + 0.475, z);
    part(scene, geo("cornerCap", () => new THREE.CylinderGeometry(0.2, 0.3, 0.12, 8)), MAT.gold, x, 0.39, z);
    part(scene, geo("cornerBall", () => new THREE.SphereGeometry(0.16, 14, 10)), MAT.gold, x, 0.55, z);
  }

  // portals
  decor.portals = [];
  const floor = std(0x8c6b40, { r: 0.95 });
  for (const gz of gaps) {
    const zc = gz + 0.5;
    part(scene, new THREE.BoxGeometry(fw, 0.6, 1), floor, -fw / 2, -0.3, zc, { noShadow: true });
    for (const s of [-1, 1]) part(scene, geo("gatePillar", () => new THREE.BoxGeometry(0.3, 1.15, 0.3)), MAT.stoneDark, -0.28, 0.45, zc + s * 0.64);
    part(scene, geo("gateLintel", () => new THREE.BoxGeometry(0.4, 0.26, 1.62)), MAT.stoneDark, -0.28, 1.12, zc);
    part(scene, geo("gateKey", () => new THREE.BoxGeometry(0.42, 0.18, 0.22)), MAT.gold, -0.28, 1.12, zc, { noShadow: true });
    const pl = part(scene, geo("portal", () => new THREE.PlaneGeometry(0.98, 1.02)), MAT.portal, -0.36, 0.5, zc, { ry: Math.PI / 2, noShadow: true });
    const glow = part(scene, geo("portalGlow", () => new THREE.CircleGeometry(0.7, 24)), basic(0x9b5cff, { op: 0.35, add: true }), 0.15, 0.015, zc, { rx: -Math.PI / 2, noShadow: true });
    const ph = glowSprite(0xa060ff, 1.8, 0.45); ph.position.set(-0.3, 0.5, zc); scene.add(ph);
    decor.portals.push({ pl, glow });
  }

  // candles on the table
  decor.candles = [];
  for (const [x, z] of [[-1.9, -1.7], [COLS + 1.9, -1.7]]) {
    part(scene, geo("candleDish", () => new THREE.CylinderGeometry(0.42, 0.48, 0.07, 18)), MAT.gold, x, -0.58, z);
    part(scene, geo("candleWax", () => new THREE.CylinderGeometry(0.17, 0.19, 0.95, 14)), MAT.wax, x, -0.07, z);
    const flame = part(scene, geo("flame", () => new THREE.ConeGeometry(0.09, 0.32, 10)), MAT.flame, x, 0.58, z, { noShadow: true });
    const halo = glowSprite(0xffa040, 2.2, 0.55); halo.position.set(x, 0.62, z); scene.add(halo);
    const light = new THREE.PointLight(col(0xffa95a), 1.1, 11, 2);
    light.position.set(x, 0.75, z); scene.add(light);
    decor.candles.push({ flame, light, halo, seed: x });
  }

  // crystal
  const cx = CRYSTAL.x + 0.5, cz = CRYSTAL.y + 0.5;
  part(scene, new THREE.CylinderGeometry(0.66, 0.7, 0.06, 28), MAT.stone, cx, 0.03, cz);
  part(scene, new THREE.CylinderGeometry(0.36, 0.45, 0.22, 8), MAT.stone, cx, 0.17, cz);
  part(scene, new THREE.CylinderGeometry(0.26, 0.31, 0.16, 8), MAT.stoneDark, cx, 0.36, cz);
  part(scene, new THREE.TorusGeometry(0.27, 0.035, 8, 24), MAT.gold, cx, 0.44, cz, { rx: Math.PI / 2 });
  crystal.group = new THREE.Group(); crystal.group.position.set(cx, 1.0, cz); crystal.group.scale.setScalar(1.35); scene.add(crystal.group);
  crystal.main = part(crystal.group, new THREE.OctahedronGeometry(0.36, 0), MAT.crystal, 0, 0, 0, { s: [1, 1.75, 1], noShadow: true });
  crystal.sats = [];
  for (let i = 0; i < 4; i++) crystal.sats.push(part(crystal.group, geo("sat", () => new THREE.OctahedronGeometry(0.09, 0)), MAT.crystal, 0, 0, 0, { s: [1, 1.6, 1], noShadow: true }));
  crystal.halo = glowSprite(0xa77bff, 2.6, 0.5); crystal.group.add(crystal.halo);
  crystal.light = new THREE.PointLight(col(0xa77bff), 1.4, 6, 2); crystal.light.position.set(cx, 1.1, cz); scene.add(crystal.light);
  crystal.ringBase = part(scene, new THREE.RingGeometry(0.74, 0.86, 48), basic(0x1b0f07, { op: 0.65 }), cx, 0.065, cz, { rx: -Math.PI / 2, noShadow: true });
  crystal.ringMat = basic(0xf1cd6a, { op: 0.95 });
  crystal.ring = null;
  crystal.baseEm = MAT.crystal.emissive.clone(); crystal.hitEm = col(0xff2a10);

  towerRoot = new THREE.Group(); enemyRoot = new THREE.Group(); fxRoot = new THREE.Group(); synRoot = new THREE.Group(); cursorRoot = new THREE.Group();
  scene.add(towerRoot, enemyRoot, fxRoot, synRoot, cursorRoot);

  // cursor helpers
  decor.hoverTile = part(cursorRoot, new THREE.PlaneGeometry(0.94, 0.94), basic(0xffffff, { op: 0.35 }), 0, 0.012, 0, { rx: -Math.PI / 2, noShadow: true });
  decor.rangeDisk = part(cursorRoot, new THREE.CircleGeometry(1, 64), basic(0xffffff, { op: 0.12 }), 0, 0.02, 0, { rx: -Math.PI / 2, noShadow: true });
  decor.rangeRing = part(cursorRoot, new THREE.RingGeometry(0.965, 1, 96), basic(0xffffff, { op: 0.75 }), 0, 0.022, 0, { rx: -Math.PI / 2, noShadow: true });
  decor.nextRing = part(cursorRoot, new THREE.RingGeometry(0.955, 1, 96), basic(0x8dff6a, { op: 0.9 }), 0, 0.024, 0, { rx: -Math.PI / 2, noShadow: true });
  decor.selRing = part(cursorRoot, new THREE.RingGeometry(0.44, 0.52, 40), basic(0xf1cd6a, { op: 0.95 }), 0, 0.03, 0, { rx: -Math.PI / 2, noShadow: true });
  decor.ghosts = TOWERS.map((_, i) => { const gm = towerModel(i, 1, MAT.ghost, MAT.ghost); gm.visible = false; cursorRoot.add(gm); return gm; });
  decor.mates = [0, 1, 2, 3, 4].map(i => part(cursorRoot, new THREE.PlaneGeometry(0.94, 0.94), basic(SEAT_HEX[i], { op: 0.38 }), 0, 0.014, 0, { rx: -Math.PI / 2, noShadow: true }));
  for (const o of [decor.hoverTile, decor.rangeDisk, decor.rangeRing, decor.nextRing, decor.selRing, ...decor.mates]) o.visible = false;
  decor.pending = new Map();
  decor.synPrev = new THREE.Group(); decor.synPrevKey = ""; cursorRoot.add(decor.synPrev);
  decor.partnerRings = Array.from({ length: 8 }, () => {
    const m = part(cursorRoot, geo("partnerRing", () => new THREE.RingGeometry(0.5, 0.6, 40)), basic(0xffffff, { op: 0.9 }), 0, 0.03, 0, { rx: -Math.PI / 2, noShadow: true });
    m.visible = false; return m;
  });

  raycaster = new THREE.Raycaster();
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
}


const FIT_PTS = [];
for (const [x, z] of [[-0.6, -0.6], [COLS + 0.6, -0.6], [-0.6, ROWS + 0.6], [COLS + 0.6, ROWS + 0.6]]) { FIT_PTS.push([x, 0.2, z], [x, 1.2, z]); }
export let lastSafe = "";
let lastLayout = "";
export function isNarrow() { return W < 900 || W / H <= 1; }
export function measureSafe() {
  const sr = stage.getBoundingClientRect();
  const R = el => { if (!el) return null; const q = el.getBoundingClientRect(); if (!q.width || !q.height) return null; return { l: q.left - sr.left, t: q.top - sr.top, r: q.right - sr.left, b: q.bottom - sr.top }; };
  let t = 0, b = 0, l = 0, r = 0;
  const top = R($("topbar")); if (top) t = top.b;
  const party = R($("party"));
  let bottomEdge = H;
  const hand = R($("hand")); if (hand) bottomEdge = Math.min(bottomEdge, hand.t + 34);
  const purse = R($("purse")); if (purse) bottomEdge = Math.min(bottomEdge, purse.t);
  if (isNarrow()) {
    if (party) t = Math.max(t, party.b + 12);
    const rb = R($("readyBtn")); if (rb) bottomEdge = Math.min(bottomEdge, rb.t);
  } else {
    if (party) l = party.r;
    const rc = R($("rightCol")); if (rc) r = W - rc.l;
  }
  b = H - bottomEdge;
  return { t: t + 6, b: b + 6, l: l + 10, r: r + 10 };
}
export function fitCamera() {
  if (!renderer) return;
  const safe = measureSafe();
  const narrow = isNarrow();
  lastSafe = JSON.stringify(safe);
  const portrait = W / H < 0.95;
  const yaw = portrait ? Math.PI / 2 : 0, el = portrait ? 1.08 : 0.94;
  camera.fov = portrait ? 38 : 34;
  camera.aspect = W / H;
  camera.clearViewOffset();
  const dir = new THREE.Vector3(Math.cos(el) * Math.sin(yaw), Math.sin(el), Math.cos(el) * Math.cos(yaw));
  const target = new THREE.Vector3(COLS / 2, 0, ROWS / 2);
  const sw = Math.max(0.2, (W - safe.l - safe.r) / W * 2), shh = Math.max(0.2, (H - safe.t - safe.b) / H * 2);
  const v = new THREE.Vector3();
  const bounds = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of FIT_PTS) { v.set(p[0], p[1], p[2]).project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    return { x0, x1, y0, y1 };
  };
  const place = d => { camera.position.copy(target).addScaledVector(dir, d); camera.up.set(0, 1, 0); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); };
  let lo = 3, hi = 160;
  for (let i = 0; i < 36; i++) { const d = (lo + hi) / 2; place(d); const bb = bounds(); if (bb.x1 - bb.x0 <= sw && bb.y1 - bb.y0 <= shh) hi = d; else lo = d; }
  place(hi);
  const bb = bounds();
  const cxN = (bb.x0 + bb.x1) / 2, cyN = (bb.y0 + bb.y1) / 2;
  const dX = ((safe.l + (W - safe.r)) / 2) / W * 2 - 1, dY = 1 - ((safe.t + (H - safe.b)) / 2) / H * 2;
  camera.setViewOffset(W, H, (cxN - dX) / 2 * W, -(cyN - dY) / 2 * H, W, H);
  camera.updateMatrixWorld(true);
  lastLayout = narrow ? "n" : "w";
}
// Render resolution: at most 1.5x, and it drops step by step if frames take too long.
let qualityCap = 1.5, perfFrames = 0, perfTime = 0, perfStart = performance.now() + 4000;
export function trackPerf(now, dt) {
  if (now < perfStart || dt > 250) return;
  perfFrames++; perfTime += dt;
  if (perfFrames < 90) return;
  const avg = perfTime / perfFrames;
  perfFrames = 0; perfTime = 0;
  if (avg > 24 && qualityCap > 1 && (window.devicePixelRatio || 1) > 1) { qualityCap = Math.max(1, qualityCap - 0.25); perfStart = now + 1500; resizeAll(); }
}
export function resizeAll() {
  W = Math.max(1, stage.clientWidth); H = Math.max(1, stage.clientHeight);
  DPR = Math.min(qualityCap, window.devicePixelRatio || 1);
  ov.width = Math.round(W * DPR); ov.height = Math.round(H * DPR);
  if (renderer) { renderer.setPixelRatio(DPR); renderer.setSize(W, H, false); fitCamera(); }
}

export function pickCell(clientX, clientY) {
  if (!renderer) return -1;
  const r = glCanvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(towerRoot.children, true);
  for (const h of hits) { let o = h.object; while (o && o.userData.cell === undefined) o = o.parent; if (o) return o.userData.cell; }
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, p)) return -1;
  const x = Math.floor(p.x), z = Math.floor(p.z);
  if (x < 0 || z < 0 || x >= COLS || z >= ROWS) return -1;
  return z * COLS + x;
}


const PV = new THREE.Vector3();
/** World point to screen pixels: [x, y, depth]. */
export function proj(x, y, z) { PV.set(x, y, z).project(camera); return [(PV.x + 1) / 2 * W, (1 - PV.y) / 2 * H, PV.z]; }
/** Size of one board cell on screen, in pixels. */
export function cellPx() { const a = proj(COLS / 2, 0, ROWS / 2), b = proj(COLS / 2 + 1, 0, ROWS / 2); return Math.hypot(b[0] - a[0], b[1] - a[1]); }

let lastFrame = performance.now();
export function render3D(v, now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (v) { syncTowers(v, now, dt); syncEnemies(v, now); syncSynergy(v); }
  else clearBoard();
  markWorldReady();
  updateCrystal(v, now);
  updateCursor(v, now);
  updateFx(now);
  animateDecor(now);
  if (takeShadowDirty()) renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  drawOverlay(v, now);
}

export function initThree() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: "high-performance" });
  } catch (_) { renderer = null; return false; }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  scene = new THREE.Scene();
  scene.background = col(0x120a05);
  scene.fog = new THREE.Fog(col(0x120a05), 30, 62);
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  initMaterials();
  buildWorld();
  return true;
}

