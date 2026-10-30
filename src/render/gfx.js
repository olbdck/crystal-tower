// Three.js helpers shared by the renderer: colours, materials, cached geometry and mesh merging.
import * as THREE from "three";

export const SEAT_HEX = [0xe2483c, 0xf0a81e, 0x22b8a4, 0x4c7cf0, 0xd04aa8];
export const SEAT_CSS = ["#e2483c", "#f0a81e", "#22b8a4", "#4c7cf0", "#d04aa8"];
export const MAT = {};
const GEOC = new Map();

export function col(h) { return new THREE.Color(h).convertSRGBToLinear(); }
export function geo(key, make) { let g = GEOC.get(key); if (!g) { g = make(); GEOC.set(key, g); } return g; }
export function std(hex, o) {
  o = o || {};
  return new THREE.MeshStandardMaterial({
    color: col(hex), roughness: o.r !== undefined ? o.r : 0.8, metalness: o.m || 0,
    emissive: o.e ? col(o.e) : new THREE.Color(0), emissiveIntensity: o.ei !== undefined ? o.ei : 1,
    transparent: !!o.t, opacity: o.op !== undefined ? o.op : 1, flatShading: !!o.flat, map: o.map || null,
  });
}
export function basic(hex, o) {
  o = o || {};
  return new THREE.MeshBasicMaterial({ color: col(hex), transparent: o.t !== false, opacity: o.op !== undefined ? o.op : 1, depthWrite: !!o.dw, blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending, side: o.ds ? THREE.DoubleSide : THREE.FrontSide });
}
export function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function initMaterials() {
  MAT.stone = std(0xa79d8c, { r: 0.95, flat: true });
  MAT.stoneDark = std(0x6c6359, { r: 0.95, flat: true });
  MAT.wood = std(0x80522d, { r: 0.85 });
  MAT.woodDark = std(0x4b2e18, { r: 0.85 });
  MAT.shaft = std(0xd8b27a, { r: 0.7 });
  MAT.gold = std(0xe6b54e, { r: 0.3, m: 0.9 });
  MAT.iron = std(0x474a52, { r: 0.45, m: 0.75 });
  MAT.copper = std(0xcf7b3c, { r: 0.35, m: 0.85 });
  MAT.ice = std(0xd2f4ff, { r: 0.08, e: 0x2c9be8, ei: 0.8, t: true, op: 0.9, flat: true });
  MAT.spark = std(0xeee6ff, { r: 0.2, e: 0x9a6bff, ei: 1.7 });
  MAT.beacon = std(0xfff0b8, { r: 0.2, e: 0xffb020, ei: 1.8 });
  MAT.echo = std(0xe2d2ff, { r: 0.12, e: 0x8f4dff, ei: 1.2, t: true, op: 0.92, flat: true });
  MAT.shadow = std(0x4b3d5e, { r: 0.5, m: 0.1, e: 0x2c1244, flat: true });
  MAT.runner = std(0x8a3129, { r: 0.55, e: 0x3a0c06, flat: true });
  MAT.armor = std(0x868b96, { r: 0.38, m: 0.7, flat: true });
  MAT.colossus = std(0x5a4476, { r: 0.65, e: 0x34155a, flat: true });
  MAT.eye = basic(0xff4a2e, { t: false, dw: true });
  MAT.visor = basic(0xffa23a, { t: false, dw: true });
  MAT.seat = SEAT_HEX.map(h => std(h, { r: 0.55 }));
  MAT.seatBase = std(0xffffff, { r: 0.55 }); // instanced towers: tinted per copy with the owner's colour
  MAT.neutral = std(0xc0954a, { r: 0.55, m: 0.3 });
  MAT.crystal = std(0xb393ff, { r: 0.1, m: 0.1, e: 0x6a3be0, ei: 0.95, t: true, op: 0.94, flat: true });
  MAT.portal = basic(0x9b5cff, { op: 0.75, add: true, ds: true });
  MAT.link = std(0xffd36b, { r: 0.4, m: 0.5, e: 0xffa21a, ei: 0.9 });
  MAT.linkHot = basic(0xffe48a, { op: 0.95, add: true });
  MAT.zone = basic(0xffd36b, { op: 0.55, add: true });
  MAT.aura = [null, 0.28, 0.45, 0.62, 0.8].map(op => (op ? basic(0xffc845, { op, add: true }) : null));
  MAT.ghost = basic(0xffffff, { op: 0.45 });
  MAT.pend = basic(0xffffff, { op: 0.35 });
  MAT.wax = std(0xf3e7c9, { r: 0.6 });
  MAT.flame = basic(0xffc66b, { op: 0.95, add: true });
  MAT.blob = basic(0x000000, { op: 0.38 });
  for (const k in MAT) if (MAT[k] && MAT[k].isMaterial) MAT[k].userData.slot = k;
  MAT.seat.forEach(m => { m.userData.slot = "seat"; });
}

export const MERGED = new Map();
export function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const m = new THREE.BufferGeometry();
  m.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  m.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  m.computeBoundingSphere(); m.computeBoundingBox();
  return m;
}
// Collapse a model's static parts into one mesh per material (geometry cached per model type),
// which cuts draw calls per tower/enemy from ~15 to 2-4.
export function bakeStatic(g, key, keep, shadow) {
  const groups = new Map();
  for (const ch of g.children.slice()) {
    if (!ch.isMesh || keep.has(ch)) continue;
    const slot = (ch.material.userData && ch.material.userData.slot) || ch.material.uuid;
    if (!groups.has(slot)) groups.set(slot, { mat: ch.material, meshes: [] });
    groups.get(slot).meshes.push(ch);
  }
  for (const [slot, grp] of groups) {
    const k = key + "|" + slot;
    let geom = MERGED.get(k);
    if (!geom) {
      geom = mergeGeos(grp.meshes.map(m => { m.updateMatrix(); const gg = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); gg.applyMatrix4(m.matrix); return gg; }));
      MERGED.set(k, geom);
    }
    for (const m of grp.meshes) g.remove(m);
    const mm = new THREE.Mesh(geom, grp.mat);
    mm.castShadow = shadow; mm.receiveShadow = shadow;
    g.add(mm);
  }
}
export function part(g, geometry, material, x, y, z, o) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  if (o) {
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
    if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
  }
  m.castShadow = !(o && o.noShadow);
  m.receiveShadow = !(o && o.noShadow);
  g.add(m);
  return m;
}

let glowTex = null;
export function glowSprite(hex, size, op) {
  if (!glowTex) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col(hex), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.set(size, size, 1);
  return sp;
}
