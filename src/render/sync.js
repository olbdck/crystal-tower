// Keeps the 3D objects in step with the game view: towers, enemies, synergy links and auras,
// the crystal, the build cursor and teammates' pointers.
import * as THREE from "three";
import { COLS, ROWS, CRYSTAL, START_LIVES, TOWERS, ENEMIES, BLOCKED, SLOW_FACTOR, posAt, towerStats } from "../sim/rules.js";
import { SPELLS, buildCost, has, towerStatsFor } from "../sim/cards.js";
import { OWN_SYN_MAX } from "../sim/rules.js";
import { MAT, SEAT_HEX, col, geo, part, mergeGeos } from "./gfx.js";
import { towerModel } from "./models.js";
import { placeTower, removeTower, towerTop, updateTowerInstances, updateEnemyInstances, ENEMY_HEIGHT } from "./instancing.js";
import { scene, synRoot, cursorRoot, crystal, decor } from "./scene.js";
import { ringBurst } from "./fx.js";
import { lifeHit } from "../ui/dom.js";
import { mySeat, myGold, canBuildAt } from "../game.js";
import { S } from "../state.js";

// Per-tower and per-enemy data the effects and the overlay read (no meshes: those are instanced).
export const towerObjs = new Map(); // cell -> { ty, lv, o, born, aim, aimT, top, bucket }
export const enemyObjs = new Map(); // id -> { e, x, z, h, ty, phase, yaw }
export let synKey = "", synHint = null;
let livesShown = null, crystalHitAt = -1e9, worldReady = false, shadowDirty = true, lastTurretShadow = 0;
export function markWorldReady() { worldReady = true; }
/** True once after anything that casts a shadow moved; the shadow map is redrawn only then. */
export function takeShadowDirty() { const d = shadowDirty; shadowDirty = false; return d; }
export function clearBoard() {
  for (const [c, o] of towerObjs) { removeTower(o.bucket, c); towerObjs.delete(c); }
  enemyObjs.clear();
  updateTowerInstances(performance.now(), towerInfo);
  updateEnemyInstances([]);
}
const easeOutBack = t => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
function angLerp(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
const burstAt = (c, hex, r, life) => ringBurst(c % COLS + 0.5, ((c / COLS) | 0) + 0.5, hex, r, life);

let frameNow = 0;
const info = { x: 0, z: 0, scale: 1, aim: 0, phase: 0 };
function towerInfo(c) {
  const o = towerObjs.get(c), age = (frameNow - o.born) / 1000;
  info.x = c % COLS + 0.5; info.z = ((c / COLS) | 0) + 0.5;
  info.scale = age < 0.35 ? Math.max(0.01, easeOutBack(age / 0.35)) : 1;
  info.aim = o.aim; info.phase = c * 1.7;
  return info;
}

export function syncTowers(v, now, dt) {
  frameNow = now;
  const seen = new Set();
  for (const tw of v.towers) {
    seen.add(tw.c);
    let o = towerObjs.get(tw.c);
    if (o && (o.ty !== tw.ty || o.lv !== tw.lv || o.o !== tw.o)) {
      const levelled = o.ty === tw.ty && o.lv !== tw.lv;
      o.bucket = placeTower(tw.c, tw.ty, tw.lv, tw.o, o.bucket);
      Object.assign(o, { ty: tw.ty, lv: tw.lv, o: tw.o, top: towerTop(tw.ty, tw.lv) });
      if (levelled) { o.born = now - 120; burstAt(tw.c, 0xf1cd6a, 0.7, 420); }
      shadowDirty = true;
    }
    if (!o) {
      o = { ty: tw.ty, lv: tw.lv, o: tw.o, born: worldReady ? now : now - 1000, aim: 0, aimT: 0, top: towerTop(tw.ty, tw.lv) };
      o.bucket = placeTower(tw.c, tw.ty, tw.lv, tw.o, null);
      towerObjs.set(tw.c, o);
      shadowDirty = true;
      if (worldReady) burstAt(tw.c, 0xe3cfa2, 0.6, 380);
    }
    if (now - o.born < 450) shadowDirty = true;
    if (o.ty === 1) {
      const moving = Math.abs(o.aimT - o.aim) > 0.04;
      o.aim = angLerp(o.aim, o.aimT, Math.min(1, dt * 9));
      if (moving && now - lastTurretShadow > 250) { lastTurretShadow = now; shadowDirty = true; }
    }
  }
  for (const [c, o] of towerObjs) if (!seen.has(c)) {
    removeTower(o.bucket, c); towerObjs.delete(c); shadowDirty = true;
    burstAt(c, 0x9b8a70, 0.7, 380);
  }
  updateTowerInstances(now, towerInfo);
}

const enemyList = [];
export function syncEnemies(v, now) {
  const seen = new Set();
  enemyList.length = 0;
  for (const e of v.enemies) {
    seen.add(e.id);
    let o = enemyObjs.get(e.id);
    if (!o || o.ty !== e.ty) {
      o = { ty: e.ty, phase: (e.id * 2.39) % 6.28, yaw: null, h: ENEMY_HEIGHT[e.ty], it: { id: e.id, ty: e.ty } };
      enemyObjs.set(e.id, o);
    }
    const p2 = posAt(e.ln, e.d + 0.08), yaw = Math.atan2(p2[0] - e.x, p2[1] - e.y);
    o.yaw = o.yaw === null ? yaw : angLerp(o.yaw, yaw, 0.25);
    o.x = e.x; o.z = e.y; o.e = e;
    const spd = ENEMIES[e.ty].speed * (e.sl > 0 ? SLOW_FACTOR : 1), ph = now * 0.001 * spd * 8 + o.phase, it = o.it;
    it.x = e.x; it.z = e.y; it.yaw = o.yaw;
    it.bob = Math.abs(Math.sin(ph)) * (e.ty === 3 ? 0.03 : 0.06);
    it.tilt = Math.sin(ph) * (e.ty === 1 ? 0.04 : 0.09);
    it.wobble = e.ty === 3 ? Math.sin(now * 0.0008) * 0.3 : 0;
    it.slowed = e.sl > 0;
    enemyList.push(it);
  }
  for (const id of enemyObjs.keys()) if (!seen.has(id)) enemyObjs.delete(id);
  updateEnemyInstances(enemyList);
}

export function syncSynergy(v) {
  const key = v.towers.map(t => t.c + ":" + t.o).join(",");
  if (key === synKey) return;
  synKey = key;
  while (synRoot.children.length) { const ch = synRoot.children[0]; synRoot.remove(ch); if (ch.geometry) ch.geometry.dispose(); }
  const box = geo("linkNI", () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
  const parts = [], mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const tw of v.towers) {
    const x = tw.c % COLS, y = (tw.c / COLS) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny >= ROWS) continue;
      const nb = v.tmap.get(ny * COLS + nx);
      if (!nb || nb.o === tw.o) continue;
      const len = Math.hypot(dx, dy) - 0.62;
      q.setFromAxisAngle(up, Math.atan2(dx, dy));
      mtx.compose(new THREE.Vector3(x + 0.5 + dx / 2, 0.19, y + 0.5 + dy / 2), q, new THREE.Vector3(0.06, 0.04, len));
      parts.push(box.clone().applyMatrix4(mtx));
    }
  }
  if (parts.length) synRoot.add(new THREE.Mesh(mergeGeos(parts), MAT.link));
  // golden aura under towers that have a bonus, brighter for a bigger bonus
  const ring = geo("auraNI", () => new THREE.RingGeometry(0.47, 0.57, 32).toNonIndexed());
  const byLevel = [[], [], [], [], []];
  for (const tw of v.towers) {
    const n = Math.min(4, v.syn.get(tw.c) || 0);
    if (!n) continue;
    mtx.makeRotationX(-Math.PI / 2).setPosition(tw.c % COLS + 0.5, 0.035, ((tw.c / COLS) | 0) + 0.5);
    byLevel[n].push(ring.clone().applyMatrix4(mtx));
  }
  for (let n = 1; n <= 4; n++) if (byLevel[n].length) synRoot.add(new THREE.Mesh(mergeGeos(byLevel[n]), MAT.aura[n]));
}
/**
 * Towers around a cell that give it synergy: other players' towers, and with `unity` ("Єдність") the
 * owner's own towers of another type than `ty`. count matches synergyAt in the rules.
 */
export function otherOwners(tmap, cell, owner, ty = -1, unity = false) {
  const x = cell % COLS, y = (cell / COLS) | 0, owners = new Set(), types = new Set(), partners = [], own = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
    const nb = tmap.get(ny * COLS + nx);
    if (!nb) continue;
    if (nb.o !== owner) { owners.add(nb.o); partners.push(nb); }
    else { own.push(nb); if (unity && nb.ty !== ty) { types.add(nb.ty); partners.push(nb); } }
  }
  return { owners, types, partners, own, count: Math.min(4, owners.size + Math.min(OWN_SYN_MAX, types.size)) };
}
const unityOf = (v, o) => o >= 0 && has(v.pv[o], "unity");
// What a new tower of `owner` and type `ty` on `cell` would get, and which neighbouring towers it would strengthen.
export function synergyPreview(v, cell, owner, ty) {
  const unity = unityOf(v, owner), r = otherOwners(v.tmap, cell, owner, ty, unity);
  const boosted = r.partners.filter(nb => {
    if ((v.syn.get(nb.c) || 0) >= 4) return false;
    if (nb.o === owner) return !otherOwners(v.tmap, nb.c, nb.o, nb.ty, true).types.has(ty);
    return !otherOwners(v.tmap, nb.c, nb.o).owners.has(owner);
  });
  return { count: r.count, partners: r.partners, own: r.own, boosted };
}
function linkMesh(fromCell, cells, mat, w) {
  const box = geo("linkNI", () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), parts = [];
  const x = fromCell % COLS, y = (fromCell / COLS) | 0;
  for (const c of cells) {
    const dx = c % COLS - x, dy = ((c / COLS) | 0) - y, len = Math.hypot(dx, dy) - 0.6;
    q.setFromAxisAngle(up, Math.atan2(dx, dy));
    mtx.compose(new THREE.Vector3(x + 0.5 + dx / 2, 0.2, y + 0.5 + dy / 2), q, new THREE.Vector3(w, 0.05, len));
    parts.push(box.clone().applyMatrix4(mtx));
  }
  return parts.length ? new THREE.Mesh(mergeGeos(parts), mat) : null;
}
function zoneMesh(cell) {
  const box = geo("linkNI", () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
  const x = cell % COLS, y = (cell / COLS) | 0, mtx = new THREE.Matrix4(), parts = [];
  const sides = [[x + 0.5, y - 1, 3, 0.05], [x + 0.5, y + 2, 3, 0.05], [x - 1, y + 0.5, 0.05, 3], [x + 2, y + 0.5, 0.05, 3]];
  for (const [cx, cz, sx, sz] of sides) {
    mtx.compose(new THREE.Vector3(cx, 0.02, cz), new THREE.Quaternion(), new THREE.Vector3(sx, 0.02, sz));
    parts.push(box.clone().applyMatrix4(mtx));
  }
  return new THREE.Mesh(mergeGeos(parts), MAT.zone);
}
function setSynPreview(key, build) {
  const g = decor.synPrev;
  if (key === decor.synPrevKey) { g.visible = !!key; return; }
  decor.synPrevKey = key;
  while (g.children.length) { const ch = g.children[0]; g.remove(ch); ch.geometry.dispose(); }
  if (key) for (const m of build()) if (m) g.add(m);
  g.visible = !!key;
}

export function updateCrystal(v, now) {
  const l = v ? v.l : START_LIVES;
  if (livesShown !== null && l < livesShown) { crystalHitAt = now; lifeHit(); }
  if (l !== livesShown) {
    livesShown = l;
    if (crystal.ring) scene.remove(crystal.ring);
    if (l > 0) {
      crystal.ringMat.color.copy(col(l <= 5 ? 0xe2483c : 0xf1cd6a));
      crystal.ring = part(scene, new THREE.RingGeometry(0.74, 0.86, 48, 1, Math.PI / 2, Math.PI * 2 * l / START_LIVES), crystal.ringMat, CRYSTAL.x + 0.5, 0.07, CRYSTAL.y + 0.5, { rx: -Math.PI / 2, noShadow: true });
    } else crystal.ring = null;
  }
  const hit = Math.max(0, 1 - (now - crystalHitAt) / 600);
  crystal.main.rotation.y = now * 0.0007;
  crystal.group.position.y = 1.1 + Math.sin(now * 0.0018) * 0.06;
  crystal.group.position.x = CRYSTAL.x + 0.5 + (hit ? (Math.random() - 0.5) * 0.08 * hit : 0);
  crystal.group.visible = l > 0;
  MAT.crystal.emissive.copy(crystal.baseEm).lerp(crystal.hitEm, hit);
  MAT.crystal.emissiveIntensity = 0.85 + Math.sin(now * 0.003) * 0.15 + hit;
  crystal.light.intensity = 1.3 + Math.sin(now * 0.003) * 0.25 + hit * 2.5;
  crystal.light.color.copy(col(0xa77bff)).lerp(col(0xff4020), hit);
  crystal.sats.forEach((s, i) => { const a = now * 0.0011 + i * Math.PI / 2; s.position.set(Math.cos(a) * 0.55, Math.sin(now * 0.002 + i) * 0.15, Math.sin(a) * 0.55); s.rotation.y = a * 2; });
}

export function updateCursor(v, now) {
  const d = decor;
  d.hoverTile.visible = d.rangeDisk.visible = d.rangeRing.visible = d.selRing.visible = d.nextRing.visible = false;
  d.ghosts.forEach(g => { g.visible = false; });
  d.mates.forEach(m => { m.visible = false; });
  d.partnerRings.forEach(m => { m.visible = false; });
  synHint = null;
  if (!v) { setSynPreview("", null); return; }
  let synKeyNow = "";
  const seat = mySeat(v);
  const myHex = seat >= 0 ? SEAT_HEX[seat] : 0xf1cd6a;
  const showRange = (cell, r, hex) => {
    const x = cell % COLS + 0.5, z = ((cell / COLS) | 0) + 0.5;
    d.rangeDisk.visible = d.rangeRing.visible = true;
    d.rangeDisk.position.set(x, 0.02, z); d.rangeRing.position.set(x, 0.022, z);
    d.rangeDisk.scale.setScalar(r); d.rangeRing.scale.setScalar(r);
    d.rangeDisk.material.color.copy(col(hex)); d.rangeRing.material.color.copy(col(hex));
  };
  const hc = S.armedCell >= 0 ? S.armedCell : S.hoverCell;
  const pvOf = o => (o >= 0 ? v.pv[o] : 0);
  // aiming a spell: the blast area, or the tower it would charge
  const spell = S.castSlot >= 0 && seat >= 0 ? SPELLS[v.hand[seat][S.castSlot]] : null;
  if (spell && hc >= 0) {
    if (spell.target === "cell") showRange(hc, spell.radius, 0xff7a2a);
    else if (spell.target === "tower" && v.tmap.has(hc)) { const t = v.tmap.get(hc); showRange(hc, towerStatsFor(t.ty, t.lv, pvOf(t.o)).range, 0xfff07a); }
  }
  if (S.buildType >= 0 && hc >= 0 && seat >= 0 && !v.tmap.has(hc) && v.ph <= 2) {
    const ok = canBuildAt(v, hc) && myGold(v) >= buildCost(pvOf(seat), S.buildType);
    const hex = ok ? 0x8dff6a : 0xff3b30, x = hc % COLS + 0.5, z = ((hc / COLS) | 0) + 0.5;
    d.hoverTile.visible = true; d.hoverTile.position.set(x, 0.012, z);
    d.hoverTile.material.color.copy(col(hex)); d.hoverTile.material.opacity = 0.42 + Math.sin(now * 0.008) * 0.12;
    if (!BLOCKED[hc]) {
      const gm = d.ghosts[S.buildType]; gm.visible = true; gm.position.set(x, 0, z);
      MAT.ghost.color.copy(col(ok ? myHex : 0x6b6259));
      MAT.ghost.opacity = ok ? 0.55 : 0.35;
      showRange(hc, towerStatsFor(S.buildType, 1, pvOf(seat)).range, ok ? 0xfff1bd : 0xff3b30);
      const pv = synergyPreview(v, hc, seat, S.buildType);
      synHint = { kind: "build", cell: hc, ty: S.buildType, ...pv };
      synKeyNow = `b${hc}|${seat}|${synKey}`;
      setSynPreview(synKeyNow, () => [zoneMesh(hc), linkMesh(hc, pv.partners.map(t => t.c), MAT.linkHot, 0.1)]);
    }
  }
  const st = S.selCell >= 0 ? v.tmap.get(S.selCell) : null;
  if (st) {
    showRange(S.selCell, towerStatsFor(st.ty, st.lv, pvOf(st.o)).range, SEAT_HEX[st.o] || 0xf1cd6a);
    d.selRing.visible = true; d.selRing.position.set(S.selCell % COLS + 0.5, 0.03, ((S.selCell / COLS) | 0) + 0.5);
    d.selRing.rotation.z = now * 0.001;
    if (S.upgradePreview && st.lv < 3) {
      d.nextRing.visible = true;
      d.nextRing.position.set(S.selCell % COLS + 0.5, 0.024, ((S.selCell / COLS) | 0) + 0.5);
      d.nextRing.scale.setScalar(towerStatsFor(st.ty, st.lv + 1, pvOf(st.o)).range);
      d.nextRing.material.opacity = 0.65 + Math.sin(now * 0.01) * 0.25;
    }
    if (!synKeyNow) {
      const r = otherOwners(v.tmap, S.selCell, st.o, st.ty, unityOf(v, st.o));
      synHint = { kind: "sel", cell: S.selCell, count: v.syn.get(S.selCell) || 0, partners: r.partners };
      synKeyNow = `s${S.selCell}|${synKey}`;
      setSynPreview(synKeyNow, () => [linkMesh(S.selCell, r.partners.map(t => t.c), MAT.linkHot, 0.1)]);
      r.partners.slice(0, 8).forEach((t, i) => {
        const m = d.partnerRings[i]; m.visible = true;
        m.position.set(t.c % COLS + 0.5, 0.03, ((t.c / COLS) | 0) + 0.5);
        m.material.color.copy(col(SEAT_HEX[t.o] || 0xf1cd6a));
      });
    }
  }
  if (!synKeyNow) setSynPreview("", null);
  for (const p of S.peerList) {
    if (p.sameTab || !p.presence || !Number.isInteger(p.presence.h)) continue;
    const s = v.seats.indexOf(p.peer), h = p.presence.h;
    if (s < 0 || h < 0 || h >= COLS * ROWS) continue;
    const m = d.mates[s]; m.visible = true; m.position.set(h % COLS + 0.5, 0.014, ((h / COLS) | 0) + 0.5);
  }
  // my pending builds
  const want = new Set();
  if (seat >= 0) for (const q of S.queue) if (q[1] === "b" && !v.tmap.has(q[2]) && TOWERS[q[3]]) {
    want.add(q[2]);
    if (!d.pending.has(q[2])) { const gm = towerModel(q[3], 1, MAT.pend, MAT.pend); gm.position.set(q[2] % COLS + 0.5, 0, ((q[2] / COLS) | 0) + 0.5); cursorRoot.add(gm); d.pending.set(q[2], gm); }
  }
  MAT.pend.color.copy(col(myHex));
  for (const [c, gm] of d.pending) if (!want.has(c)) { cursorRoot.remove(gm); d.pending.delete(c); }
}

export function animateDecor(now) {
  for (const p of decor.portals) { p.pl.material.opacity = 0.55 + Math.sin(now * 0.004) * 0.2; p.glow.scale.setScalar(1 + Math.sin(now * 0.003) * 0.08); }
  for (const c of decor.candles) {
    const f = 0.85 + Math.sin(now * 0.017 + c.seed) * 0.08 + Math.sin(now * 0.041 + c.seed * 3) * 0.06;
    c.light.intensity = 1.1 * f; c.flame.scale.set(1, f, 1); c.halo.material.opacity = 0.45 * f;
  }
}

