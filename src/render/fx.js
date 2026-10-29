// Short-lived effects: projectiles, bursts, explosions, debris, lightning and floating gold.
import * as THREE from "three";
import { COLS, ENEMIES } from "../sim/rules.js";
import { MAT, geo, basic } from "./gfx.js";
import { renderer, fxRoot } from "./scene.js";
import { towerObjs } from "./sync.js";
import { S } from "../state.js";

const fxObjs = [];
export const bolts = [], floats = [];
function addTemp(mesh, life, update, onEnd) { fxRoot.add(mesh); fxObjs.push({ mesh, start: performance.now(), life, update, onEnd }); }
export function updateFx(now) {
  for (let i = fxObjs.length - 1; i >= 0; i--) {
    const f = fxObjs[i], t = (now - f.start) / f.life;
    if (t >= 1) {
      fxRoot.remove(f.mesh);
      if (f.mesh.material && f.mesh.material.userData.temp) f.mesh.material.dispose();
      fxObjs.splice(i, 1);
      if (f.onEnd) f.onEnd();
      continue;
    }
    f.update(Math.max(0, t), f.mesh);
  }
}
function projectile(geometry, material, from, to, life, arc, orient, onEnd) {
  const m = new THREE.Mesh(geometry, material), p = new THREE.Vector3();
  m.position.copy(from);
  addTemp(m, life, (t, mesh) => {
    p.lerpVectors(from, to, t); p.y += Math.sin(Math.PI * t) * arc;
    if (orient) mesh.lookAt(p);
    mesh.position.copy(p);
    if (!orient) mesh.rotation.x += 0.3;
  }, onEnd);
}
function tempMat(hex, op) { const m = basic(hex, { op, add: true }); m.userData.temp = true; return m; }
export function ringBurst(pos, hex, radius, life) {
  const mat = tempMat(hex, 0.8);
  const m = new THREE.Mesh(geo("burstRing", () => new THREE.RingGeometry(0.8, 1, 40)), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.04, pos.z);
  addTemp(m, life, t => { m.scale.setScalar(0.15 + radius * (1 - Math.pow(1 - t, 3))); mat.opacity = 0.8 * (1 - t); });
}
function explosion(pos, radius) {
  const mat = tempMat(0xffa040, 0.9);
  const m = new THREE.Mesh(geo("fxSphere", () => new THREE.SphereGeometry(1, 16, 12)), mat);
  m.position.copy(pos);
  addTemp(m, 340, t => { m.scale.setScalar(0.12 + radius * 0.75 * (1 - Math.pow(1 - t, 2))); mat.opacity = 0.9 * (1 - t); });
  ringBurst(pos, 0xffb060, radius, 420);
  debris(pos.x, pos.z, MAT.stoneDark, 3, 0.9);
}
function debris(x, z, material, n, power) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo("debris", () => new THREE.BoxGeometry(0.07, 0.07, 0.07)), material);
    const a = Math.random() * Math.PI * 2, sp = (0.6 + Math.random() * 0.9) * power, vy = 1.4 + Math.random() * 1.2;
    m.position.set(x, 0.3, z);
    addTemp(m, 620, (t, mesh) => {
      const s = t * 0.62;
      mesh.position.set(x + Math.cos(a) * sp * s, Math.max(0.03, 0.3 + vy * s - 4.5 * s * s), z + Math.sin(a) * sp * s);
      mesh.rotation.x += 0.2; mesh.rotation.y += 0.15;
      mesh.scale.setScalar(1 - t * 0.9);
    });
  }
}
const ENEMY_MAT = () => [MAT.shadow, MAT.runner, MAT.armor, MAT.colossus];
export function spawnFx(f) {
  if (!renderer) return;
  const k = f[0], now = performance.now();
  if (k === 4) {
    const x = f[1] / 10, z = f[2] / 10, ty = f[3], killer = f[4] - 1;
    if (!ENEMIES[ty]) return;
    debris(x, z, ENEMY_MAT()[ty], ty === 3 ? 12 : 5, ty === 3 ? 1.6 : 1);
    ringBurst(new THREE.Vector3(x, 0, z), ty === 3 ? 0xff5030 : 0x9b6dff, ty === 3 ? 1.3 : 0.6, 450);
    if (killer >= 0 && killer === S.mySeat) floats.push({ x, z, text: "+" + ENEMIES[ty].gold, start: now });
    return;
  }
  const x1 = f[1] / 10, z1 = f[2] / 10, x2 = f[3] / 10, z2 = f[4] / 10;
  const to = towerObjs.get(Math.floor(z1) * COLS + Math.floor(x1));
  const from = new THREE.Vector3(x1, to ? to.g.userData.top : 0.35, z1), dest = new THREE.Vector3(x2, 0.32, z2);
  if (k === 0) projectile(geo("arrow", () => new THREE.BoxGeometry(0.03, 0.03, 0.34)), MAT.shaft, from, dest, 150, 0.15, true);
  else if (k === 1) {
    if (to) to.aimT = Math.atan2(x2 - x1, z2 - z1);
    projectile(geo("ball", () => new THREE.SphereGeometry(0.075, 10, 8)), MAT.iron, from, dest, 300, 0.7, false, () => explosion(dest, 0.95));
  } else if (k === 2) projectile(geo("iceShard", () => new THREE.OctahedronGeometry(0.075, 0)), MAT.ice, from, dest, 220, 0.25, true, () => ringBurst(dest, 0x6cc8ff, 0.8, 380));
  else if (k === 3) bolts.push({ a: from, b: dest, start: now, seed: Math.random() * 1000 });
}

