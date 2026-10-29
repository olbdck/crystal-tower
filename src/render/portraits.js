// Renders a tower or enemy model into a small image for cards, the tower panel and the wave preview.
import * as THREE from "three";
import { MAT, col } from "./gfx.js";
import { towerModel, enemyModel } from "./models.js";

let pr = null;
const portraitCache = new Map();
export function portrait(kind, ty, lv, seat) {
  const key = `${kind}${ty}-${lv}-${seat}`;
  if (portraitCache.has(key)) return portraitCache.get(key);
  try {
    if (!pr) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1); r.setSize(200, 200, false);
      r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.2;
      const s = new THREE.Scene();
      s.add(new THREE.HemisphereLight(col(0xfff0d8), col(0x3a2414), 0.9));
      const key1 = new THREE.DirectionalLight(col(0xffe2b0), 1.5); key1.position.set(2, 3, 2.5); s.add(key1);
      const rim = new THREE.DirectionalLight(col(0xb79bff), 0.9); rim.position.set(-2.5, 1.5, -2); s.add(rim);
      pr = { r, s, cam: new THREE.PerspectiveCamera(28, 1, 0.05, 50) };
    }
    const model = kind === "t" ? towerModel(ty, lv, seat >= 0 ? MAT.seat[seat] : MAT.neutral) : enemyModel(ty);
    if (model.userData.frost) model.userData.frost.visible = false;
    if (model.userData.blob) model.userData.blob.visible = false;
    model.rotation.y = kind === "t" ? -0.55 : 0.75;
    const holder = new THREE.Group(); holder.add(model); pr.s.add(holder);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    model.traverse(o => { if (o.isMesh && o.visible) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); box.union(bb); } });
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const fitH = Math.max(size.y, size.x * 0.9, size.z * 0.9) * 1.08;
    const dist = fitH / (2 * Math.tan((pr.cam.fov / 2) * Math.PI / 180));
    pr.cam.position.set(0, dist * 0.28, dist); pr.cam.lookAt(0, 0, 0);
    pr.r.render(pr.s, pr.cam);
    const url = pr.r.domElement.toDataURL("image/png");
    pr.s.remove(holder);
    portraitCache.set(key, url);
    return url;
  } catch (_) { return ""; }
}

