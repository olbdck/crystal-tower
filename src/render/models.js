// Low-poly tower and enemy models built from primitives. Static parts are merged per material.
import * as THREE from "three";
import { MAT, geo, part, bakeStatic } from "./gfx.js";

export function towerModel(ty, lv, seatMat, ghost) {
  const g = new THREE.Group(), M = m => ghost || m, sh = ghost ? { noShadow: true } : {};
  const ud = { ty, lv };
  part(g, geo("plinth", () => new THREE.CylinderGeometry(0.4, 0.45, 0.16, 8)), M(MAT.stoneDark), 0, 0.08, 0, sh);
  part(g, geo("band", () => new THREE.CylinderGeometry(0.405, 0.405, 0.06, 8)), M(seatMat), 0, 0.17, 0, sh);
  if (ty === 0) {
    const h = 0.58 + 0.14 * (lv - 1), top = 0.2 + h;
    part(g, geo("arShaft", () => new THREE.CylinderGeometry(0.19, 0.27, 1, 8)), M(MAT.stone), 0, 0.2 + h / 2, 0, { s: [1, h, 1], ...sh });
    part(g, geo("arDeck", () => new THREE.CylinderGeometry(0.31, 0.25, 0.12, 8)), M(MAT.wood), 0, top + 0.06, 0, sh);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; part(g, geo("arPost", () => new THREE.BoxGeometry(0.05, 0.2, 0.05)), M(MAT.woodDark), Math.cos(a) * 0.24, top + 0.22, Math.sin(a) * 0.24, sh); }
    part(g, geo("arRoof", () => new THREE.ConeGeometry(0.38, 0.4, 8)), M(seatMat), 0, top + 0.52, 0, sh);
    part(g, geo("pole", () => new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4)), M(MAT.woodDark), 0, top + 0.85, 0, { noShadow: true });
    ud.flag = part(g, geo("flag", () => new THREE.BoxGeometry(0.18, 0.1, 0.012)), M(seatMat), 0.09, top + 0.95, 0, { noShadow: true });
    ud.top = top + 0.25;
  } else if (ty === 1) {
    part(g, geo("caBody", () => new THREE.CylinderGeometry(0.33, 0.38, 0.36, 10)), M(MAT.stone), 0, 0.38, 0, sh);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; part(g, geo("merlon", () => new THREE.BoxGeometry(0.11, 0.11, 0.11)), M(MAT.stone), Math.cos(a) * 0.29, 0.61, Math.sin(a) * 0.29, sh); }
    const tur = new THREE.Group(); tur.position.y = 0.68; g.add(tur);
    part(tur, geo("caBall", () => new THREE.SphereGeometry(0.15, 12, 10)), M(MAT.iron), 0, 0, 0, sh);
    const rad = 0.068 + 0.012 * (lv - 1), bgeo = geo("barrel" + lv, () => new THREE.CylinderGeometry(rad, rad * 1.25, 0.5, 10));
    const xs = lv < 3 ? [0] : [-0.075, 0.075];
    for (const x of xs) {
      part(tur, bgeo, M(MAT.iron), x, 0.02, 0.22, { rx: Math.PI / 2, ...sh });
      part(tur, geo("muzzle" + lv, () => new THREE.TorusGeometry(rad * 1.05, 0.022, 6, 12)), M(MAT.gold), x, 0.02, 0.46, { noShadow: true });
    }
    part(g, geo("caBanner", () => new THREE.BoxGeometry(0.17, 0.22, 0.02)), M(seatMat), 0, 0.37, 0.385, { noShadow: true });
    ud.turret = tur; ud.top = 0.72;
  } else if (ty === 2) {
    const h = 0.48 + 0.1 * (lv - 1);
    part(g, geo("frShaft", () => new THREE.CylinderGeometry(0.11, 0.22, 1, 6)), M(MAT.stone), 0, 0.2 + h / 2, 0, { s: [1, h, 1], ...sh });
    part(g, geo("frCap", () => new THREE.CylinderGeometry(0.22, 0.12, 0.1, 6)), M(seatMat), 0, 0.25 + h, 0, sh);
    ud.crystalY = 0.6 + h;
    ud.crystal = part(g, geo("frCrys" + lv, () => new THREE.OctahedronGeometry(0.15 + 0.03 * lv, 0)), M(MAT.ice), 0, ud.crystalY, 0, { s: [1, 1.5, 1], noShadow: !!ghost });
    ud.shards = [];
    for (let i = 1; i < lv; i++) ud.shards.push(part(g, geo("shard", () => new THREE.OctahedronGeometry(0.06, 0)), M(MAT.ice), 0, ud.crystalY, 0, { noShadow: true }));
    ud.top = ud.crystalY;
  } else if (ty === 4) {
    // Маяк: a slim stone column with a glowing lamp in a gold cage
    const h = 0.62 + 0.12 * (lv - 1);
    part(g, geo("bcShaft", () => new THREE.CylinderGeometry(0.12, 0.2, 1, 8)), M(MAT.stone), 0, 0.2 + h / 2, 0, { s: [1, h, 1], ...sh });
    part(g, geo("bcBowl", () => new THREE.CylinderGeometry(0.2, 0.12, 0.1, 8)), M(seatMat), 0, 0.25 + h, 0, sh);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; part(g, geo("bcBar", () => new THREE.BoxGeometry(0.03, 0.28, 0.03)), M(MAT.gold), Math.cos(a) * 0.15, 0.43 + h, Math.sin(a) * 0.15, { noShadow: true }); }
    part(g, geo("bcCap", () => new THREE.ConeGeometry(0.2, 0.16, 8)), M(MAT.gold), 0, 0.64 + h, 0, sh);
    ud.orbY = 0.43 + h;
    ud.orb = part(g, geo("bcLamp" + lv, () => new THREE.SphereGeometry(0.09 + 0.015 * lv, 14, 12)), M(MAT.beacon), 0, ud.orbY, 0, { noShadow: true });
    ud.top = ud.orbY;
  } else if (ty === 5) {
    // Стяг: a war banner in the owner's colour on a tall pole, with a pennant on top
    const h = 0.95 + 0.1 * (lv - 1), w = 0.3 + 0.04 * (lv - 1);
    part(g, geo("bnPole", () => new THREE.CylinderGeometry(0.03, 0.04, 1, 6)), M(MAT.woodDark), 0, 0.2 + h / 2, 0, { s: [1, h, 1], ...sh });
    part(g, geo("bnBar", () => new THREE.CylinderGeometry(0.02, 0.02, 1, 5)), M(MAT.woodDark), 0, 0.12 + h, 0.04, { rz: Math.PI / 2, s: [1, w + 0.08, 1], ...sh });
    part(g, geo("bnCloth" + lv, () => new THREE.BoxGeometry(w, 0.42 + 0.05 * (lv - 1), 0.02)), M(seatMat), 0, h - 0.12 - 0.025 * (lv - 1), 0.05, sh);
    part(g, geo("bnEmblem", () => new THREE.CylinderGeometry(0.06, 0.06, 0.025, 12)), M(MAT.gold), 0, h - 0.1, 0.065, { rx: Math.PI / 2, noShadow: true });
    part(g, geo("bnFinial", () => new THREE.SphereGeometry(0.045, 10, 8)), M(MAT.gold), 0, 0.24 + h, 0, { noShadow: true });
    ud.flag = part(g, geo("flag", () => new THREE.BoxGeometry(0.18, 0.1, 0.012)), M(seatMat), 0.09, 0.32 + h, 0, { noShadow: true });
    ud.top = 0.2 + h;
  } else if (ty === 6) {
    // Відлуння: a ring of standing stones around a floating violet crystal
    part(g, geo("ecDrum", () => new THREE.CylinderGeometry(0.3, 0.34, 0.12, 10)), M(MAT.stoneDark), 0, 0.24, 0, sh);
    const n = 2 + lv, sh2 = 0.34 + 0.06 * lv;
    for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n + 0.3; part(g, geo("ecStone", () => new THREE.BoxGeometry(0.07, 1, 0.09)), M(MAT.stone), Math.cos(a) * 0.25, 0.3 + sh2 / 2, Math.sin(a) * 0.25, { s: [1, sh2, 1], ry: -a, ...sh }); }
    part(g, geo("ecRing", () => new THREE.TorusGeometry(0.25, 0.018, 6, 24)), M(seatMat), 0, 0.33 + sh2, 0, { rx: Math.PI / 2, noShadow: true });
    ud.crystalY = 0.62 + 0.05 * lv;
    ud.crystal = part(g, geo("ecCrys" + lv, () => new THREE.OctahedronGeometry(0.11 + 0.02 * lv, 0)), M(MAT.echo), 0, ud.crystalY, 0, { s: [1, 1.5, 1], noShadow: true });
    ud.shards = [];
    for (let i = 1; i < lv; i++) ud.shards.push(part(g, geo("ecShard", () => new THREE.OctahedronGeometry(0.05, 0)), M(MAT.echo), 0, ud.crystalY, 0, { noShadow: true }));
    ud.top = ud.crystalY;
  } else {
    part(g, geo("teBase", () => new THREE.CylinderGeometry(0.2, 0.27, 0.2, 8)), M(MAT.iron), 0, 0.27, 0, sh);
    const h = 0.72 + 0.1 * (lv - 1);
    part(g, geo("tePole", () => new THREE.CylinderGeometry(0.055, 0.085, 1, 8)), M(MAT.copper), 0, 0.37 + h / 2, 0, { s: [1, h, 1], ...sh });
    for (let i = 0; i < 1 + lv; i++) part(g, geo("coil", () => new THREE.TorusGeometry(0.15, 0.032, 6, 16)), M(i === 0 ? seatMat : MAT.copper), 0, 0.5 + i * (h - 0.22) / (lv + 0.6), 0, { rx: Math.PI / 2, ...sh });
    ud.orbY = 0.44 + h;
    ud.orb = part(g, geo("orb", () => new THREE.SphereGeometry(0.12, 14, 12)), M(MAT.spark), 0, ud.orbY, 0, { noShadow: true });
    ud.top = ud.orbY;
  }
  for (let i = 0; i < lv; i++) part(g, geo("pip", () => new THREE.SphereGeometry(0.045, 8, 6)), M(MAT.gold), (i - (lv - 1) / 2) * 0.13, 0.1, 0.41, { noShadow: true });
  if (ud.crystal) ud.crystal.castShadow = false;
  bakeStatic(g, `t${ty}-${lv}`, new Set([ud.flag, ud.crystal, ud.orb, ...(ud.shards || [])].filter(Boolean)), !ghost);
  if (ud.turret) bakeStatic(ud.turret, `tt${lv}`, new Set(), !ghost);
  g.userData = ud;
  return g;
}

function eyes(g, y, z, dx, r) { for (const s of [-1, 1]) part(g, geo("eye" + r, () => new THREE.SphereGeometry(r, 6, 6)), MAT.eye, s * dx, y, z, { noShadow: true }); }
export function enemyModel(ty) {
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const ud = { body };
  if (ty === 0) {
    part(body, geo("pwBase", () => new THREE.CylinderGeometry(0.17, 0.21, 0.08, 12)), MAT.shadow, 0, 0.04, 0);
    part(body, geo("pwBody", () => new THREE.CylinderGeometry(0.09, 0.17, 0.3, 12)), MAT.shadow, 0, 0.23, 0);
    part(body, geo("pwCollar", () => new THREE.CylinderGeometry(0.14, 0.12, 0.05, 12)), MAT.shadow, 0, 0.39, 0);
    part(body, geo("pwHead", () => new THREE.SphereGeometry(0.12, 14, 10)), MAT.shadow, 0, 0.5, 0);
    eyes(body, 0.52, 0.1, 0.045, 0.022);
    ud.h = 0.66;
  } else if (ty === 1) {
    part(body, geo("ruBody", () => new THREE.SphereGeometry(0.15, 12, 8)), MAT.runner, 0, 0.24, 0, { s: [0.8, 0.75, 1.5] });
    part(body, geo("ruHead", () => new THREE.ConeGeometry(0.1, 0.26, 8)), MAT.runner, 0, 0.29, 0.28, { rx: Math.PI / 2 });
    for (const s of [-1, 1]) {
      part(body, geo("ruEar", () => new THREE.ConeGeometry(0.035, 0.13, 5)), MAT.runner, s * 0.06, 0.39, 0.18, { rx: -0.3 });
      part(body, geo("ruLeg", () => new THREE.BoxGeometry(0.04, 0.16, 0.04)), MAT.runner, s * 0.08, 0.08, 0.12, {});
      part(body, geo("ruLeg", () => new THREE.BoxGeometry(0.04, 0.16, 0.04)), MAT.runner, s * 0.08, 0.08, -0.13, {});
    }
    eyes(body, 0.33, 0.31, 0.04, 0.02);
    ud.h = 0.48;
  } else if (ty === 2) {
    for (const s of [-1, 1]) part(body, geo("arLeg", () => new THREE.BoxGeometry(0.13, 0.18, 0.15)), MAT.iron, s * 0.11, 0.09, 0);
    part(body, geo("arTorso", () => new THREE.BoxGeometry(0.44, 0.34, 0.34)), MAT.armor, 0, 0.35, 0);
    for (const s of [-1, 1]) part(body, geo("arShoulder", () => new THREE.BoxGeometry(0.14, 0.13, 0.38)), MAT.iron, s * 0.27, 0.48, 0);
    part(body, geo("arHead", () => new THREE.BoxGeometry(0.2, 0.17, 0.2)), MAT.armor, 0, 0.61, 0);
    part(body, geo("arVisor", () => new THREE.BoxGeometry(0.15, 0.035, 0.01)), MAT.visor, 0, 0.63, 0.102, { noShadow: true });
    ud.h = 0.74;
  } else {
    part(body, geo("coCore", () => new THREE.DodecahedronGeometry(0.38, 0)), MAT.colossus, 0, 0.5, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const dirs = [[1, 0.3, 0], [-1, 0.3, 0], [0, 0.4, -1], [0.7, 0.8, -0.5], [-0.7, 0.8, -0.5], [0, 1, 0.2], [0.6, -0.1, 0.7], [-0.6, -0.1, 0.7]];
    for (const d of dirs) {
      const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
      const sp = part(body, geo("coSpike", () => new THREE.ConeGeometry(0.07, 0.28, 5)), MAT.stoneDark, v.x * 0.4, 0.5 + v.y * 0.4, v.z * 0.4);
      sp.quaternion.setFromUnitVectors(up, v);
    }
    eyes(body, 0.56, 0.33, 0.1, 0.045);
    ud.h = 1.05;
  }
  ud.frost = part(g, geo("frostRing", () => new THREE.TorusGeometry(ty === 3 ? 0.46 : 0.3, 0.03, 6, 24)), MAT.ice, 0, 0.06, 0, { rx: Math.PI / 2, noShadow: true });
  ud.frost.visible = false;
  bakeStatic(body, "e" + ty, new Set(), false);
  const blob = part(g, geo("blob", () => new THREE.CircleGeometry(1, 20)), MAT.blob, 0, 0.016, 0, { rx: -Math.PI / 2, noShadow: true });
  blob.scale.setScalar([0.24, 0.24, 0.33, 0.5][ty]);
  ud.blob = blob;
  const sc = [1.35, 1.35, 1.25, 1.2][ty];
  g.scale.setScalar(sc); ud.h *= sc;
  g.userData = ud;
  return g;
}
