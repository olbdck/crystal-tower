// Keeps the 3D objects in step with the game view: towers, enemies, synergy links and auras,
// the crystal, the build cursor and teammates' pointers.
import * as THREE from "three";
import { COLS, ROWS, CRYSTAL, START_LIVES, TOWERS, ENEMIES, BLOCKED, SLOW_FACTOR, posAt, towerStats } from "../sim/rules.js";
import { MAT, SEAT_HEX, col, geo, part, mergeGeos } from "./gfx.js";
import { towerModel, enemyModel } from "./models.js";
import { scene, towerRoot, enemyRoot, synRoot, cursorRoot, crystal, decor } from "./scene.js";
import { ringBurst } from "./fx.js";
import { lifeHit } from "../ui/dom.js";
import { mySeat, myGold, canBuildAt } from "../game.js";
import { S } from "../state.js";

export const towerObjs = new Map(), enemyObjs = new Map();
export let synKey = "", synHint = null;
let livesShown = null, crystalHitAt = -1e9, worldReady = false, shadowDirty = true, lastTurretShadow = 0;
export function markWorldReady() { worldReady = true; }
/** True once after anything that casts a shadow moved; the shadow map is redrawn only then. */
export function takeShadowDirty() { const d = shadowDirty; shadowDirty = false; return d; }
export function clearBoard() {
  for (const [c, o] of towerObjs) { towerRoot.remove(o.g); towerObjs.delete(c); }
  for (const [id, o] of enemyObjs) { enemyRoot.remove(o.g); enemyObjs.delete(id); }
}
const easeOutBack = t => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
function angLerp(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

export function syncTowers(v, now, dt) {
  const seen = new Set();
  for (const tw of v.towers) {
    seen.add(tw.c);
    let o = towerObjs.get(tw.c);
    if (o && (o.ty !== tw.ty || o.lv !== tw.lv || o.o !== tw.o)) {
      towerRoot.remove(o.g);
      const aim = o.aim; o = null;
      const g = makeTowerObj(tw, now); g.aim = aim; g.aimT = aim; g.born = now - 120;
      o = g;
      ringBurst(new THREE.Vector3(tw.c % COLS + 0.5, 0.05, ((tw.c / COLS) | 0) + 0.5), 0xf1cd6a, 0.7, 420);
    }
    if (!o) { o = makeTowerObj(tw, now); if (worldReady) ringBurst(new THREE.Vector3(tw.c % COLS + 0.5, 0.05, ((tw.c / COLS) | 0) + 0.5), 0xe3cfa2, 0.6, 380); }
    const age = (now - o.born) / 1000;
    if (age < 0.45) { o.g.scale.setScalar(age < 0.35 ? Math.max(0.01, easeOutBack(age / 0.35)) : 1); shadowDirty = true; }
    else if (o.g.scale.x !== 1) { o.g.scale.setScalar(1); shadowDirty = true; }
    const ud = o.g.userData, ph = tw.c * 1.7;
    if (ud.turret) {
      const moving = Math.abs(o.aimT - o.aim) > 0.04;
      o.aim = angLerp(o.aim, o.aimT, Math.min(1, dt * 9)); ud.turret.rotation.y = o.aim;
      if (moving && now - lastTurretShadow > 250) { lastTurretShadow = now; shadowDirty = true; }
    }
    if (ud.crystal) {
      ud.crystal.rotation.y = now * 0.0012 + ph;
      ud.crystal.position.y = ud.crystalY + Math.sin(now * 0.002 + ph) * 0.04;
      ud.shards.forEach((s, i) => { const a = now * 0.002 + ph + i * Math.PI; s.position.set(Math.cos(a) * 0.24, ud.crystalY + Math.sin(a * 1.3) * 0.05, Math.sin(a) * 0.24); s.rotation.y = a; });
    }
    if (ud.orb) ud.orb.scale.setScalar(1 + Math.sin(now * 0.008 + ph) * 0.12);
    if (ud.flag) ud.flag.rotation.y = Math.sin(now * 0.004 + ph) * 0.35;
  }
  for (const [c, o] of towerObjs) if (!seen.has(c)) {
    towerRoot.remove(o.g); towerObjs.delete(c); shadowDirty = true;
    ringBurst(new THREE.Vector3(c % COLS + 0.5, 0.05, ((c / COLS) | 0) + 0.5), 0x9b8a70, 0.7, 380);
  }
}
function makeTowerObj(tw, now) {
  const g = towerModel(tw.ty, tw.lv, MAT.seat[tw.o] || MAT.neutral);
  g.position.set(tw.c % COLS + 0.5, 0, ((tw.c / COLS) | 0) + 0.5);
  g.userData.cell = tw.c;
  towerRoot.add(g);
  shadowDirty = true;
  const o = { g, ty: tw.ty, lv: tw.lv, o: tw.o, born: worldReady ? now : now - 1000, aim: 0, aimT: 0 };
  towerObjs.set(tw.c, o);
  return o;
}

export function syncEnemies(v, now) {
  const seen = new Set();
  for (const e of v.enemies) {
    seen.add(e.id);
    let o = enemyObjs.get(e.id);
    if (!o || o.ty !== e.ty) {
      if (o) enemyRoot.remove(o.g);
      const g = enemyModel(e.ty);
      enemyRoot.add(g);
      o = { g, ty: e.ty, phase: (e.id * 2.39) % 6.28, yaw: null };
      enemyObjs.set(e.id, o);
    }
    const p2 = posAt(e.ln, e.d + 0.08), yaw = Math.atan2(p2[0] - e.x, p2[1] - e.y);
    o.yaw = o.yaw === null ? yaw : angLerp(o.yaw, yaw, 0.25);
    o.g.position.set(e.x, 0, e.y);
    o.g.rotation.y = o.yaw;
    const spd = ENEMIES[e.ty].speed * (e.sl > 0 ? SLOW_FACTOR : 1), ph = now * 0.001 * spd * 8 + o.phase, body = o.g.userData.body;
    body.position.y = Math.abs(Math.sin(ph)) * (e.ty === 3 ? 0.03 : 0.06);
    body.rotation.z = Math.sin(ph) * (e.ty === 1 ? 0.04 : 0.09);
    if (e.ty === 3) body.rotation.y = Math.sin(now * 0.0008) * 0.3;
    o.g.userData.frost.visible = e.sl > 0;
    o.e = e;
  }
  for (const [id, o] of enemyObjs) if (!seen.has(id)) { enemyRoot.remove(o.g); enemyObjs.delete(id); }
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
export function otherOwners(tmap, cell, owner) {
  const x = cell % COLS, y = (cell / COLS) | 0, owners = new Set(), partners = [], own = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
    const nb = tmap.get(ny * COLS + nx);
    if (!nb) continue;
    if (nb.o !== owner) { owners.add(nb.o); partners.push(nb); } else own.push(nb);
  }
  return { owners, partners, own };
}
// What a new tower of `owner` on `cell` would get, and which neighbouring towers it would strengthen.
export function synergyPreview(v, cell, owner) {
  const r = otherOwners(v.tmap, cell, owner);
  const boosted = r.partners.filter(nb => { const o = otherOwners(v.tmap, nb.c, nb.o).owners; return !o.has(owner) && o.size < 4; });
  return { count: Math.min(4, r.owners.size), partners: r.partners, own: r.own, boosted };
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
  if (S.buildType >= 0 && hc >= 0 && seat >= 0 && !v.tmap.has(hc) && v.ph <= 2) {
    const ok = canBuildAt(v, hc) && myGold(v) >= TOWERS[S.buildType].cost;
    const hex = ok ? 0x8dff6a : 0xff3b30, x = hc % COLS + 0.5, z = ((hc / COLS) | 0) + 0.5;
    d.hoverTile.visible = true; d.hoverTile.position.set(x, 0.012, z);
    d.hoverTile.material.color.copy(col(hex)); d.hoverTile.material.opacity = 0.42 + Math.sin(now * 0.008) * 0.12;
    if (!BLOCKED[hc]) {
      const gm = d.ghosts[S.buildType]; gm.visible = true; gm.position.set(x, 0, z);
      MAT.ghost.color.copy(col(ok ? myHex : 0x6b6259));
      MAT.ghost.opacity = ok ? 0.55 : 0.35;
      showRange(hc, towerStats(S.buildType, 1).range, ok ? 0xfff1bd : 0xff3b30);
      const pv = synergyPreview(v, hc, seat);
      synHint = { kind: "build", cell: hc, ty: S.buildType, ...pv };
      synKeyNow = `b${hc}|${seat}|${synKey}`;
      setSynPreview(synKeyNow, () => [zoneMesh(hc), linkMesh(hc, pv.partners.map(t => t.c), MAT.linkHot, 0.1)]);
    }
  }
  const st = S.selCell >= 0 ? v.tmap.get(S.selCell) : null;
  if (st) {
    showRange(S.selCell, towerStats(st.ty, st.lv).range, SEAT_HEX[st.o] || 0xf1cd6a);
    d.selRing.visible = true; d.selRing.position.set(S.selCell % COLS + 0.5, 0.03, ((S.selCell / COLS) | 0) + 0.5);
    d.selRing.rotation.z = now * 0.001;
    if (S.upgradePreview && st.lv < 3) {
      d.nextRing.visible = true;
      d.nextRing.position.set(S.selCell % COLS + 0.5, 0.024, ((S.selCell / COLS) | 0) + 0.5);
      d.nextRing.scale.setScalar(towerStats(st.ty, st.lv + 1).range);
      d.nextRing.material.opacity = 0.65 + Math.sin(now * 0.01) * 0.25;
    }
    if (!synKeyNow) {
      const r = otherOwners(v.tmap, S.selCell, st.o);
      synHint = { kind: "sel", cell: S.selCell, count: Math.min(4, r.owners.size), partners: r.partners };
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

