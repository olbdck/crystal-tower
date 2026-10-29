// Short-lived effects: projectiles, bursts, explosions, debris, lightning and floating gold.
// Meshes and effect records come from pools and go back when an effect ends, so a busy wave does
// not create garbage on every shot. When a pool is empty the effect is skipped.
import * as THREE from "three";
import { COLS, ENEMIES, KILL_SHARE } from "../sim/rules.js";
import { SP } from "../sim/cards.js";
import { MAT, geo, basic } from "./gfx.js";
import { renderer, fxRoot } from "./scene.js";
import { towerObjs } from "./sync.js";
import { S } from "../state.js";

export const bolts = [], floats = []; // drawn by the 2D overlay

const MAX = { arrow: 90, ball: 40, iceShard: 60, ring: 70, sphere: 30, debris: 160, bolt: 40, float: 30 };
const pools = {}, made = {};
function makeMesh(kind) {
  switch (kind) {
    case "arrow": return new THREE.Mesh(geo("arrow", () => new THREE.BoxGeometry(0.03, 0.03, 0.34)), MAT.shaft);
    case "ball": return new THREE.Mesh(geo("ball", () => new THREE.SphereGeometry(0.075, 10, 8)), MAT.iron);
    case "iceShard": return new THREE.Mesh(geo("iceShard", () => new THREE.OctahedronGeometry(0.075, 0)), MAT.ice);
    case "ring": { const m = new THREE.Mesh(geo("burstRing", () => new THREE.RingGeometry(0.8, 1, 40)), basic(0xffffff, { op: 0.8, add: true })); m.rotation.x = -Math.PI / 2; return m; }
    case "sphere": return new THREE.Mesh(geo("fxSphere", () => new THREE.SphereGeometry(1, 16, 12)), basic(0xffa040, { op: 0.9, add: true }));
    case "debris": return new THREE.Mesh(geo("debris", () => new THREE.BoxGeometry(0.07, 0.07, 0.07)), MAT.stoneDark);
  }
  return null;
}
/** A mesh of this kind from the pool (added to the scene once), or null when the pool is used up. */
function takeMesh(kind) {
  const free = pools[kind] || (pools[kind] = []);
  let m = free.pop();
  if (!m) {
    if ((made[kind] || 0) >= MAX[kind]) return null;
    made[kind] = (made[kind] || 0) + 1;
    m = makeMesh(kind);
    m.userData.kind = kind;
    fxRoot.add(m);
  }
  m.visible = true;
  return m;
}
function giveMesh(m) { m.visible = false; pools[m.userData.kind].push(m); }

// Active effects are plain records reused from a free list.
const active = [], freeRecs = [];
function rec(kind, mesh, life) {
  const r = freeRecs.pop() || {};
  r.kind = kind; r.mesh = mesh; r.start = performance.now(); r.life = life; r.end = 0;
  active.push(r);
  return r;
}

const END_NONE = 0, END_EXPLODE = 1, END_FROST = 2;
const tmp = new THREE.Vector3();

export function updateFx(now) {
  let keep = 0;
  for (let i = 0; i < active.length; i++) {
    const r = active[i], t = (now - r.start) / r.life;
    if (t >= 1) { finish(r); continue; }
    step(r, Math.max(0, t));
    active[keep++] = r;
  }
  active.length = keep;
}
function step(r, t) {
  const m = r.mesh;
  switch (r.kind) {
    case "proj": {
      const y = r.y0 + (r.y1 - r.y0) * t + Math.sin(Math.PI * t) * r.arc;
      tmp.set(r.x0 + (r.x1 - r.x0) * t, y, r.z0 + (r.z1 - r.z0) * t);
      if (r.orient) m.lookAt(tmp); else m.rotation.x += 0.3;
      m.position.copy(tmp);
      break;
    }
    case "ring": m.scale.setScalar(0.15 + r.radius * (1 - Math.pow(1 - t, 3))); m.material.opacity = 0.8 * (1 - t); break;
    case "sphere": m.scale.setScalar(0.12 + r.radius * 0.75 * (1 - Math.pow(1 - t, 2))); m.material.opacity = 0.9 * (1 - t); break;
    case "debris": {
      const s = t * 0.62;
      m.position.set(r.x0 + Math.cos(r.a) * r.sp * s, Math.max(0.03, 0.3 + r.vy * s - 4.5 * s * s), r.z0 + Math.sin(r.a) * r.sp * s);
      m.rotation.x += 0.2; m.rotation.y += 0.15;
      m.scale.setScalar(1 - t * 0.9);
      break;
    }
  }
}
function finish(r) {
  if (r.mesh) giveMesh(r.mesh);
  if (r.end === END_EXPLODE) explosion(r.x1, r.z1, 0.95);
  else if (r.end === END_FROST) ringBurst(r.x1, r.z1, 0x6cc8ff, 0.8, 380);
  r.mesh = null;
  freeRecs.push(r);
}

function projectile(kind, x0, y0, z0, x1, y1, z1, life, arc, orient, end) {
  const m = takeMesh(kind);
  if (!m) { if (end === END_EXPLODE) explosion(x1, z1, 0.95); return; }
  m.position.set(x0, y0, z0); m.rotation.set(0, 0, 0); m.scale.setScalar(1);
  const r = rec("proj", m, life);
  r.x0 = x0; r.y0 = y0; r.z0 = z0; r.x1 = x1; r.y1 = y1; r.z1 = z1; r.arc = arc; r.orient = orient; r.end = end;
}
const ringColor = new THREE.Color();
export function ringBurst(x, z, hex, radius, life) {
  const m = takeMesh("ring");
  if (!m) return;
  m.position.set(x, 0.04, z); m.scale.setScalar(0.15);
  m.material.color.copy(ringColor.setHex(hex).convertSRGBToLinear()); m.material.opacity = 0.8;
  rec("ring", m, life).radius = radius;
}
function explosion(x, z, radius) {
  const m = takeMesh("sphere");
  if (m) { m.position.set(x, 0.32, z); m.scale.setScalar(0.12); m.material.opacity = 0.9; rec("sphere", m, 340).radius = radius; }
  ringBurst(x, z, 0xffb060, radius, 420);
  debris(x, z, MAT.stoneDark, 3, 0.9);
}
function debris(x, z, material, n, power) {
  for (let i = 0; i < n; i++) {
    const m = takeMesh("debris");
    if (!m) return;
    m.material = material; m.position.set(x, 0.3, z); m.scale.setScalar(1);
    const r = rec("debris", m, 620);
    r.x0 = x; r.z0 = z; r.a = Math.random() * Math.PI * 2; r.sp = (0.6 + Math.random() * 0.9) * power; r.vy = 1.4 + Math.random() * 1.2;
  }
}

function spellFx(x, z, id, r) {
  if (id === SP.fire) { explosion(x, z, r); ringBurst(x, z, 0xff7a2a, r * 1.3, 520); debris(x, z, MAT.stoneDark, 6, 1.3); }
  else if (id === SP.storm) ringBurst(x, z, 0x9fe4ff, r, 700);
  else if (id === SP.quake) { ringBurst(x, z, 0xc08a4a, r, 500); debris(x, z, MAT.stoneDark, 2, 0.7); }
  else if (id === SP.heal) { ringBurst(x, z, 0x6dff9a, r, 800); ringBurst(x, z, 0xc8ffd8, r * 0.6, 600); }
  else if (id === SP.surge) { ringBurst(x, z, 0xfff07a, r, 600); ringBurst(x, z, 0xfff07a, r * 0.5, 400); }
  else if (id === SP.rush) ringBurst(x, z, 0xf1cd6a, r, 800);
}

const ENEMY_MAT = () => [MAT.shadow, MAT.runner, MAT.armor, MAT.colossus];
function goldFloat(x, z, amount, h, now) {
  if (amount >= 1 && floats.length < MAX.float) floats.push({ x, z, h, text: "+" + Math.round(amount), start: now });
}

/** Plays one effect from the simulation (see Sim.fx for the layout). */
export function spawnFx(f) {
  if (!renderer) return;
  const k = f[0], now = performance.now();
  if (k === 4) {
    const x = f[1] / 10, z = f[2] / 10, ty = f[3], killer = f[4] - 1, share = (f[5] || 0) / 100;
    if (!ENEMIES[ty]) return;
    debris(x, z, ENEMY_MAT()[ty], ty === 3 ? 12 : 5, ty === 3 ? 1.6 : 1);
    ringBurst(x, z, ty === 3 ? 0xff5030 : 0x9b6dff, ty === 3 ? 1.3 : 0.6, 450);
    // our gold from this kill: the killer's half plus a share, or just the share (shown when it is worth a coin)
    if (S.mySeat >= 0) goldFloat(x, z, killer === S.mySeat ? ENEMIES[ty].gold * (1 - KILL_SHARE) + share : share, 0.7, now);
    return;
  }
  if (k === 5) { if (S.mySeat >= 0) goldFloat(f[1] / 10, f[2] / 10, f[3], 1.7, now); return; } // the crystal's drip
  if (k === 6) { spellFx(f[1] / 10, f[2] / 10, f[3], f[4] / 10); return; }
  const x1 = f[1] / 10, z1 = f[2] / 10, x2 = f[3] / 10, z2 = f[4] / 10;
  const to = towerObjs.get(Math.floor(z1) * COLS + Math.floor(x1));
  const top = to ? to.top : 0.35;
  if (k === 0) projectile("arrow", x1, top, z1, x2, 0.32, z2, 150, 0.15, true, END_NONE);
  else if (k === 1) {
    if (to) to.aimT = Math.atan2(x2 - x1, z2 - z1);
    projectile("ball", x1, top, z1, x2, 0.32, z2, 300, 0.7, false, END_EXPLODE);
  } else if (k === 2) projectile("iceShard", x1, top, z1, x2, 0.32, z2, 220, 0.25, true, END_FROST);
  else if (k === 3 && bolts.length < MAX.bolt) bolts.push({ a: { x: x1, y: top, z: z1 }, b: { x: x2, y: 0.32, z: z2 }, start: now, seed: Math.random() * 1000 });
}

/** How many effect meshes exist and how many are in use, for the benchmark. */
export function fxStats() {
  let made_ = 0; for (const k in made) made_ += made[k];
  return { meshes: made_, active: active.length };
}
