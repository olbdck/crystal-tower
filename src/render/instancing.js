// Instanced drawing for towers and enemies. Every tower type+level (and every enemy type) is one
// "bucket": a few InstancedMeshes, one per material part, that draw all copies in one call each.
// Moving parts (cannon turret, frost crystal, tesla orb, flag) are separate instanced parts whose
// matrices are rewritten every frame; static parts only when a tower appears, levels up or goes away.
import * as THREE from "three";
import { MAT, SEAT_HEX, col } from "./gfx.js";
import { towerModel, enemyModel } from "./models.js";

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** Flattens a model into parts: geometry, material, matrix relative to the model, and what animates it. */
function partsOf(group, tags) {
  const out = [];
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  group.traverse(o => {
    if (!o.isMesh) return;
    let anim = null, pivot = null;
    for (let p = o; p && p !== group; p = p.parent) if (tags.has(p)) { anim = tags.get(p); pivot = p; break; }
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    // animated parts are posed relative to their pivot (the turret, the body...) so the pose can change per copy
    let pivotLocal = null, inPivot = local;
    if (pivot && pivot !== o) {
      pivotLocal = new THREE.Matrix4().multiplyMatrices(inv, pivot.matrixWorld);
      inPivot = new THREE.Matrix4().copy(pivotLocal).invert().multiply(local);
    }
    out.push({ geometry: o.geometry, material: o.material, local, anim, pivotLocal, inPivot, cast: o.castShadow, seat: o.material === MAT.seatBase, pivotObj: pivot });
  });
  return out;
}

class Bucket {
  constructor(parts, capacity, root) {
    this.parts = parts;
    this.cap = capacity;
    this.keys = [];
    this.index = new Map();
    this.dirtyStatic = true;
    this.meshes = parts.map(p => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      m.count = 0; m.visible = false; m.frustumCulled = false;
      m.castShadow = p.cast; m.receiveShadow = p.cast;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (p.seat) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      m.userData.bucket = this;
      root.add(m);
      return m;
    });
  }
  get size() { return this.keys.length; }
  add(key) {
    if (this.index.has(key)) return this.index.get(key);
    if (this.keys.length >= this.cap) return -1;
    const i = this.keys.length;
    this.keys.push(key); this.index.set(key, i);
    this.dirtyStatic = true;
    return i;
  }
  /** Removes a copy; the last copy moves into its slot. */
  remove(key) {
    const i = this.index.get(key);
    if (i === undefined) return;
    const last = this.keys.length - 1, lastKey = this.keys[last];
    if (i !== last) {
      this.keys[i] = lastKey; this.index.set(lastKey, i);
      for (const m of this.meshes) {
        m.instanceMatrix.array.copyWithin(i * 16, last * 16, last * 16 + 16);
        if (m.instanceColor) m.instanceColor.array.copyWithin(i * 3, last * 3, last * 3 + 3);
      }
    }
    this.keys.pop(); this.index.delete(key);
    this.dirtyStatic = true;
  }
  setColor(i, color) { for (const m of this.meshes) if (m.instanceColor) { m.instanceColor.setXYZ(i, color.r, color.g, color.b); m.instanceColor.needsUpdate = true; } }
  commit() {
    const n = this.keys.length;
    for (const m of this.meshes) { m.count = n; m.visible = n > 0; if (n) m.instanceMatrix.needsUpdate = true; }
  }
}

/* ---------- towers ---------- */
const towerBuckets = new Map();
let towerRoot = null;
const SEAT_COLORS = [];
let NEUTRAL_COLOR = null;

export function initTowerInstancing(root) {
  towerRoot = root;
  SEAT_HEX.forEach(h => SEAT_COLORS.push(col(h)));
  NEUTRAL_COLOR = col(0xc0954a);
}
function towerBucket(ty, lv) {
  const key = ty * 10 + lv;
  let b = towerBuckets.get(key);
  if (!b) {
    const g = towerModel(ty, lv, MAT.seatBase), ud = g.userData, tags = new Map();
    if (ud.flag) tags.set(ud.flag, "flag");
    if (ud.turret) tags.set(ud.turret, "turret");
    if (ud.crystal) tags.set(ud.crystal, "crystal");
    (ud.shards || []).forEach((s, i) => tags.set(s, "shard" + i));
    if (ud.orb) tags.set(ud.orb, "orb");
    b = new Bucket(partsOf(g, tags), 85, towerRoot);
    b.ud = { top: ud.top, crystalY: ud.crystalY, orbY: ud.orbY, turretY: ud.turret ? ud.turret.position.y : 0, flagPos: ud.flag ? ud.flag.position.clone() : null };
    towerBuckets.set(key, b);
  }
  return b;
}
export function towerTop(ty, lv) { return towerBucket(ty, lv).ud.top; }

/** Adds or moves a tower copy; returns the bucket it lives in. */
export function placeTower(cell, ty, lv, owner, prev) {
  if (prev) prev.remove(cell);
  const b = towerBucket(ty, lv), i = b.add(cell);
  if (i >= 0) b.setColor(i, owner >= 0 ? SEAT_COLORS[owner] : NEUTRAL_COLOR);
  return b;
}
export function removeTower(bucket, cell) { bucket.remove(cell); }

/**
 * Writes the matrices of every tower copy. `info(cell)` gives { x, z, scale, aim, phase } and
 * `animStatic` says whether static parts need rewriting (a tower is still growing in).
 */
export function updateTowerInstances(now, info) {
  for (const b of towerBuckets.values()) {
    if (!b.size) { b.commit(); continue; }
    const writeStatic = b.dirtyStatic || b.growing;
    b.growing = false;
    for (let i = 0; i < b.keys.length; i++) {
      const t = info(b.keys[i]);
      if (t.scale !== 1) b.growing = true;
      tmpS.setScalar(t.scale);
      const base = tmpM.compose(tmpV.set(t.x, 0, t.z), tmpQ.identity(), tmpS);
      b.parts.forEach((p, k) => {
        if (!p.anim) { if (writeStatic) b.meshes[k].setMatrixAt(i, tmpM2.multiplyMatrices(base, p.local)); return; }
        b.meshes[k].setMatrixAt(i, animMatrix(b, p, base, t, now));
      });
    }
    b.dirtyStatic = false;
    b.commit();
  }
}
const animTmp = new THREE.Matrix4(), animTmp2 = new THREE.Matrix4(), pose = new THREE.Matrix4();
function animMatrix(b, p, base, t, now) {
  const ph = t.phase;
  switch (p.anim) {
    case "turret":
      // pivot (turret) placed, turned to aim, then the part inside it
      pose.makeRotationY(t.aim).setPosition(0, b.ud.turretY, 0);
      return animTmp.multiplyMatrices(base, pose).multiply(p.inPivot);
    case "flag":
      pose.makeRotationY(Math.sin(now * 0.004 + ph) * 0.35).setPosition(b.ud.flagPos);
      return animTmp.multiplyMatrices(base, pose).multiply(animTmp2.makeScale(1, 1, 1));
    case "crystal": {
      const y = b.ud.crystalY + Math.sin(now * 0.002 + ph) * 0.04;
      pose.compose(tmpV.set(0, y, 0), tmpQ.setFromAxisAngle(Y, now * 0.0012 + ph), tmpS.set(1, 1.5, 1));
      return animTmp.multiplyMatrices(base, pose);
    }
    case "orb": {
      const s = 1 + Math.sin(now * 0.008 + ph) * 0.12;
      pose.compose(tmpV.set(0, b.ud.orbY, 0), tmpQ.identity(), tmpS.set(s, s, s));
      return animTmp.multiplyMatrices(base, pose);
    }
    default: { // shard0, shard1: orbit the frost crystal
      const n = +p.anim.slice(5), a = now * 0.002 + ph + n * Math.PI;
      pose.compose(tmpV.set(Math.cos(a) * 0.24, b.ud.crystalY + Math.sin(a * 1.3) * 0.05, Math.sin(a) * 0.24), tmpQ.setFromAxisAngle(Y, a), tmpS.set(1, 1, 1));
      return animTmp.multiplyMatrices(base, pose);
    }
  }
}

/** Tower under the pointer: the cell of the copy the ray hits first, or -1. */
export function pickTower(raycaster) {
  const meshes = [];
  for (const b of towerBuckets.values()) if (b.size) for (const m of b.meshes) meshes.push(m);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit || hit.instanceId === undefined) return -1;
  const b = hit.object.userData.bucket;
  return b.keys[hit.instanceId] ?? -1;
}

/* ---------- enemies ---------- */
const enemyBuckets = [];
const BODY_SCALE = [1.35, 1.35, 1.25, 1.2];
export const ENEMY_HEIGHT = [];

export function initEnemyInstancing(root) {
  for (let ty = 0; ty < 4; ty++) {
    const g = enemyModel(ty), ud = g.userData, tags = new Map([[ud.body, "body"], [ud.frost, "frost"], [ud.blob, "blob"]]);
    ud.frost.visible = true;
    g.scale.set(1, 1, 1); // the per-type scale is applied per copy
    const parts = partsOf(g, tags);
    const body = new Bucket(parts.filter(p => p.anim === "body" || p.anim === "blob"), 60, root);
    const frost = new Bucket(parts.filter(p => p.anim === "frost"), 60, root);
    enemyBuckets.push({ body, frost, bodyY: ud.body.position.y });
    ENEMY_HEIGHT[ty] = ud.h;
  }
}

const eBase = new THREE.Matrix4(), eBody = new THREE.Matrix4(), eTmp = new THREE.Matrix4(), eQ = new THREE.Quaternion(), eEuler = new THREE.Euler(0, 0, 0, "YXZ");
/** Rewrites every enemy copy from `list` items: { ty, x, z, yaw, bob, tilt, wobble, slowed }. */
export function updateEnemyInstances(list) {
  for (const eb of enemyBuckets) { eb.body.keys.length = 0; eb.body.index.clear(); eb.frost.keys.length = 0; eb.frost.index.clear(); }
  for (const e of list) {
    const eb = enemyBuckets[e.ty], s = BODY_SCALE[e.ty];
    const i = eb.body.keys.length;
    if (i >= eb.body.cap) continue;
    eb.body.keys.push(e.id);
    eBase.compose(tmpV.set(e.x, 0, e.z), eQ.setFromAxisAngle(Y, e.yaw), tmpS.set(s, s, s));
    eEuler.set(0, e.wobble, e.tilt);
    eBody.makeRotationFromEuler(eEuler).setPosition(0, e.bob, 0);
    eb.body.parts.forEach((p, k) => {
      eTmp.multiplyMatrices(eBase, p.anim === "body" ? eBody : eTmp2.identity());
      eb.body.meshes[k].setMatrixAt(i, eTmp.multiply(p.anim === "body" ? p.inPivot : p.local));
    });
    if (e.slowed && eb.frost.keys.length < eb.frost.cap) {
      const j = eb.frost.keys.length;
      eb.frost.keys.push(e.id);
      eb.frost.parts.forEach((p, k) => eb.frost.meshes[k].setMatrixAt(j, eTmp.multiplyMatrices(eBase, p.local)));
    }
  }
  for (const eb of enemyBuckets) { eb.body.commit(); eb.frost.commit(); }
}
const eTmp2 = new THREE.Matrix4();

/** Draw calls the instanced towers and enemies use right now, for the benchmark. */
export function instanceStats() {
  let meshes = 0, copies = 0;
  for (const b of [...towerBuckets.values(), ...enemyBuckets.flatMap(e => [e.body, e.frost])]) if (b.size) { meshes += b.meshes.length; copies += b.size; }
  return { meshes, copies };
}
