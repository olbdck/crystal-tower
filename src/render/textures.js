// Procedural canvas textures: table wood and the painted board with stone paths.
import * as THREE from "three";
import { COLS, ROWS, PATHS, posAt } from "../sim/rules.js";
import { mulberry32 } from "./gfx.js";

export function woodTexture(seed, base, maxAniso) {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
  const g = c.getContext("2d"), rnd = mulberry32(seed);
  g.fillStyle = base; g.fillRect(0, 0, c.width, c.height);
  const plank = 64;
  for (let y = 0; y < c.height; y += plank) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "255,220,170" : "20,8,0"},${0.04 + rnd() * 0.08})`;
    g.fillRect(0, y, c.width, plank);
    for (let i = 0; i < 22; i++) {
      g.strokeStyle = `rgba(${rnd() < 0.7 ? "25,10,2" : "255,215,160"},${0.08 + rnd() * 0.14})`;
      g.lineWidth = 1 + rnd() * 2;
      g.beginPath();
      const yy = y + rnd() * plank, amp = 1 + rnd() * 4, fr = 0.004 + rnd() * 0.01, ph = rnd() * 6;
      for (let x = 0; x <= c.width; x += 16) g.lineTo(x, yy + Math.sin(x * fr + ph) * amp);
      g.stroke();
    }
    for (let k = 0; k < 2; k++) {
      const kx = rnd() * c.width, ky = y + 10 + rnd() * (plank - 20);
      g.fillStyle = "rgba(20,8,0,.35)"; g.beginPath(); g.ellipse(kx, ky, 9 + rnd() * 8, 4 + rnd() * 3, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = "rgba(10,4,0,.55)"; g.fillRect(0, y, c.width, 2);
    const seam = rnd() * c.width; g.fillRect(seam, y, 2, plank);
  }
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}

export function boardTexture(maxAniso) {
  const P = 96, c = document.createElement("canvas"); c.width = COLS * P; c.height = ROWS * P;
  const g = c.getContext("2d"), rnd = mulberry32(11);
  g.fillStyle = "#56783a"; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * c.width, y = rnd() * c.height, r = 40 + rnd() * 140, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rnd() < 0.5 ? "rgba(132,160,72,.32)" : "rgba(42,70,30,.32)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * c.width, y = rnd() * c.height;
    g.fillStyle = rnd() < 0.5 ? "rgba(150,182,86,.32)" : "rgba(34,60,24,.32)";
    g.fillRect(x, y, 2, 4 + rnd() * 6);
  }
  for (let i = 0; i < 90; i++) {
    const x = rnd() * c.width, y = rnd() * c.height;
    g.fillStyle = ["#e9d36b", "#f2f0e2", "#c792e8"][(rnd() * 3) | 0];
    for (let k = 0; k < 5; k++) g.fillRect(x + (rnd() - 0.5) * 18, y + (rnd() - 0.5) * 18, 3, 3);
  }
  g.strokeStyle = "rgba(24,40,12,.22)"; g.lineWidth = 2;
  for (let x = 1; x < COLS; x++) { g.beginPath(); g.moveTo(x * P, 0); g.lineTo(x * P, c.height); g.stroke(); }
  for (let y = 1; y < ROWS; y++) { g.beginPath(); g.moveTo(0, y * P); g.lineTo(c.width, y * P); g.stroke(); }
  g.lineJoin = "round"; g.lineCap = "round";
  for (const [w, color] of [[0.94, "#3c2816"], [0.82, "#7c5c36"], [0.72, "#b28d58"]]) {
    g.strokeStyle = color; g.lineWidth = w * P;
    for (const p of PATHS) { g.beginPath(); p.wp.forEach(([x, y], i) => (i ? g.lineTo(x * P, y * P) : g.moveTo(x * P, y * P))); g.stroke(); }
  }
  const stones = ["#9e7b4a", "#c6a36a", "#8a6a40", "#d4b47c", "#a98a5c"];
  PATHS.forEach((p, ln) => {
    for (let d = 0; d < p.len; d += 0.1) {
      const [x, y] = posAt(ln, d);
      for (let k = 0; k < 2; k++) {
        const ox = (rnd() - 0.5) * 0.6, oy = (rnd() - 0.5) * 0.6, rx = (0.05 + rnd() * 0.05) * P, ry = rx * (0.65 + rnd() * 0.3);
        g.fillStyle = stones[(rnd() * stones.length) | 0];
        g.strokeStyle = "rgba(50,32,16,.55)"; g.lineWidth = 2;
        g.beginPath(); g.ellipse((x + ox) * P, (y + oy) * P, rx, ry, rnd() * 3, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
  });
  const vg = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.3, c.width / 2, c.height / 2, c.width * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(25,12,0,.38)");
  g.fillStyle = vg; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso;
  return t;
}
