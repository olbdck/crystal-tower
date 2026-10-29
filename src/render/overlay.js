// 2D overlay drawn over the 3D canvas: health bars, lightning, floating gold, names and synergy labels.
import { COLS, ROWS, TOWERS, SYN_BONUS, hash01 } from "../sim/rules.js";
import { SEAT_CSS } from "./gfx.js";
import { renderer, octx, W, H, DPR, proj, cellPx } from "./scene.js";
import { enemyObjs, synHint } from "./sync.js";
import { bolts, floats } from "./fx.js";
import { cleanName } from "../net/session.js";
import { S } from "../state.js";

function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
export function drawOverlay(v, now) {
  const g = octx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!v || !renderer) return;
  const cp = cellPx();
  for (const o of enemyObjs.values()) {
    const e = o.e;
    if (!e || e.hp >= e.mhp) continue;
    const [sx, sy] = proj(o.x, o.h + 0.2, o.z);
    const w = Math.max(18, Math.min(70, cp * (e.ty === 3 ? 1.2 : 0.7))), h = Math.max(4, Math.min(8, cp * 0.11)), f = Math.max(0, Math.min(1, e.hp / e.mhp));
    g.fillStyle = "rgba(20,10,4,.88)"; rr(g, sx - w / 2 - 1.5, sy - 1.5, w + 3, h + 3, 3); g.fill();
    g.fillStyle = f > 0.5 ? "#6fd25a" : f > 0.25 ? "#f0b429" : "#e2483c"; rr(g, sx - w / 2, sy, w * f, h, 2); g.fill();
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i], t = (now - b.start) / 190;
    if (t >= 1) { bolts.splice(i, 1); continue; }
    const A = proj(b.a.x, b.a.y, b.a.z), B = proj(b.b.x, b.b.y, b.b.z);
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    const pts = [[A[0], A[1]]], n = 6, jit = Math.min(14, len * 0.12);
    for (let k = 1; k < n; k++) { const j = (hash01((b.seed | 0) * 13 + k + (((now / 50) | 0) % 3) * 7) - 0.5) * 2 * jit; pts.push([A[0] + dx * k / n + nx * j, A[1] + dy * k / n + ny * j]); }
    pts.push([B[0], B[1]]);
    g.save(); g.globalAlpha = 1 - t; g.lineJoin = "round"; g.lineCap = "round";
    g.shadowColor = "#a888ff"; g.shadowBlur = 14; g.strokeStyle = "#b79bff"; g.lineWidth = 4;
    g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = "#ffffff"; g.lineWidth = 1.6; g.stroke();
    g.restore();
  }
  g.textAlign = "center"; g.textBaseline = "middle";
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i], t = (now - f.start) / 950;
    if (t >= 1) { floats.splice(i, 1); continue; }
    const [sx, sy] = proj(f.x, 0.7 + t * 0.9, f.z);
    g.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    g.font = `400 ${Math.round(Math.max(15, Math.min(24, cp * 0.45)))}px "Yeseva One", Georgia, serif`;
    g.lineWidth = 4; g.strokeStyle = "#1a0d04"; g.strokeText(f.text, sx, sy);
    g.fillStyle = "#f1cd6a"; g.fillText(f.text, sx, sy);
    g.globalAlpha = 1;
  }
  if (synHint) drawSynLabels(g, v, cp, now);
  g.font = `600 12px "Alegreya Sans SC", system-ui, sans-serif`;
  for (const p of S.peerList) {
    if (p.sameTab || !p.presence || !Number.isInteger(p.presence.h)) continue;
    const s = v.seats.indexOf(p.peer), h = p.presence.h;
    if (s < 0 || h < 0 || h >= COLS * ROWS) continue;
    const nm = cleanName(p.presence.n); if (!nm) continue;
    const [sx, sy] = proj(h % COLS + 0.5, 0.95, ((h / COLS) | 0) + 0.5);
    const w = g.measureText(nm).width + 14;
    g.fillStyle = SEAT_CSS[s]; rr(g, sx - w / 2, sy - 10, w, 20, 10); g.fill();
    g.lineWidth = 1.5; g.strokeStyle = "#1a0d04"; g.stroke();
    g.fillStyle = "#fff"; g.fillText(nm, sx, sy + 0.5);
  }
}

function pill(g, sx, sy, text, bg, fg, size) {
  g.font = `700 ${size}px "Alegreya Sans SC", system-ui, sans-serif`;
  const w = g.measureText(text).width + size * 1.1, h = size * 1.7;
  g.fillStyle = bg; rr(g, sx - w / 2, sy - h / 2, w, h, h / 2); g.fill();
  g.lineWidth = 1.5; g.strokeStyle = "#1a0d04"; g.stroke();
  g.fillStyle = fg; g.fillText(text, sx, sy + 0.5);
  return h;
}
function drawSynLabels(g, v, cp, now) {
  const h = synHint, x = h.cell % COLS + 0.5, z = ((h.cell / COLS) | 0) + 0.5;
  const big = Math.round(Math.max(12, Math.min(16, cp * 0.3))), small = Math.max(11, big - 2);
  g.textAlign = "center"; g.textBaseline = "middle";
  if (h.kind === "build") {
    const [sx, sy] = proj(x, 1.9, z);
    if (h.count > 0) {
      const base = TOWERS[h.ty].dmg, boosted = base * (1 + SYN_BONUS * h.count);
      const hh = pill(g, sx, sy, `Синергія +${Math.round(h.count * SYN_BONUS * 100)}%`, "#f1cd6a", "#3a2312", big);
      pill(g, sx, sy + hh + 2, `шкода ${+base.toFixed(1)} → ${+boosted.toFixed(1)}`, "rgba(30,16,6,.88)", "#fff1bd", small);
    } else if (h.own.length) {
      pill(g, sx, sy, "Свої вежі не дають синергії", "rgba(30,16,6,.85)", "#e3cfa2", small);
    }
    const pulse = 1 + Math.sin(now * 0.008) * 0.06;
    // under the towers it would strengthen, so these never cover the label above the new tower
    for (const t of h.boosted) {
      const [bx, by] = proj(t.c % COLS + 0.5, 0, ((t.c / COLS) | 0) + 0.5);
      pill(g, bx, by + small * 1.4, "+15% їм", SEAT_CSS[t.o] || "#f1cd6a", "#fff", Math.round(small * pulse));
    }
  } else if (h.kind === "sel" && h.count > 0) {
    const [sx, sy] = proj(x, 1.5, z);
    pill(g, sx, sy, `Синергія +${Math.round(h.count * SYN_BONUS * 100)}%`, "#f1cd6a", "#3a2312", big);
  }
}

