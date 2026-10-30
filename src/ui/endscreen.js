// The end of a game: a radiant crystal in a laurel wreath with confetti for a win, a skull over
// the shattered crystal on a darkened, greyed-out table for a loss.
import { $ } from "./dom.js";
import { SEAT_CSS } from "../render/gfx.js";

// Two laurel branches curving up around the crystal from a red bow at the bottom.
function laurel() {
  const cx = 100, cy = 80, r = 60, out = [], f = n => n.toFixed(1);
  for (const side of [1, -1]) {
    const stem = [];
    for (let i = 0; i <= 8; i++) {
      const deg = side > 0 ? 80 - i * 15 : 100 + i * 15, a = deg * Math.PI / 180;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      stem.push(`${f(x)} ${f(y)}`);
      if (i === 0) continue;
      const dir = side > 0 ? deg - 90 : deg + 90, len = 13 - i * 0.7; // along the branch, upwards
      for (const k of [-1, 1]) out.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(len)}" ry="${f(len * 0.4)}" transform="rotate(${f(dir + k * 38)} ${f(x)} ${f(y)}) translate(${f(len * 0.85)} 0)"/>`);
    }
    out.unshift(`<path d="M${stem.join(" L")}" fill="none" stroke="#9a7424" stroke-width="3" stroke-linecap="round"/>`);
  }
  out.push(`<path d="M88 146 L100 139 L112 146 L107 156 L100 149 L93 156 Z" fill="#c4392d" stroke="#5e1a10" stroke-width="1.5" stroke-linejoin="round"/>`);
  return `<g fill="url(#eg-leaf)" stroke="#7a5317" stroke-width="1.1">${out.join("")}</g>`;
}

const WIN_ART = `<svg viewBox="0 0 200 170" aria-hidden="true" class="art-win">
  <defs>
    <radialGradient id="eg-glow" cx="50%" cy="48%" r="50%"><stop offset="0" stop-color="#fff4c8" stop-opacity=".95"/><stop offset=".45" stop-color="#f1cd6a" stop-opacity=".45"/><stop offset="1" stop-color="#f1cd6a" stop-opacity="0"/></radialGradient>
    <linearGradient id="eg-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#efe2ff"/><stop offset=".5" stop-color="#b48cff"/><stop offset="1" stop-color="#5a2fc2"/></linearGradient>
    <linearGradient id="eg-b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9c4ff"/><stop offset="1" stop-color="#45209e"/></linearGradient>
    <linearGradient id="eg-leaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1bd"/><stop offset="1" stop-color="#c99434"/></linearGradient>
  </defs>
  <g class="rays" transform="translate(100 78)">
    ${Array.from({ length: 16 }, (_, i) => `<path d="M0 0 L-5 -86 L5 -86 Z" fill="#f1cd6a" opacity=".35" transform="rotate(${i * 22.5})"/>`).join("")}
  </g>
  <circle cx="100" cy="78" r="70" fill="url(#eg-glow)"/>
  <g class="laurel">${laurel()}</g>
  <g class="gem" stroke="#1a0d04" stroke-width="2.5" stroke-linejoin="round">
    <polygon points="100,18 132,52 122,110 100,132 78,110 68,52" fill="url(#eg-a)"/>
    <polygon points="100,18 100,132 78,110 68,52" fill="url(#eg-b)" opacity=".55" stroke="none"/>
    <polyline points="68,52 100,64 132,52" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/>
    <line x1="100" y1="64" x2="100" y2="132" stroke="#fff" stroke-opacity=".45" stroke-width="1.5"/>
    <polygon points="86,30 96,26 80,60 74,54" fill="#fff" opacity=".6" stroke="none"/>
  </g>
  <g class="sparks" fill="#fff8dc">
    <path d="M40 34 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3z"/>
    <path d="M160 26 l2.4 7 7 2.4 -7 2.4 -2.4 7 -2.4 -7 -7 -2.4 7 -2.4z"/>
    <path d="M168 104 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/>
    <path d="M30 112 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/>
  </g>
</svg>`;

const LOSE_ART = `<svg viewBox="0 0 200 170" aria-hidden="true" class="art-lose">
  <defs>
    <radialGradient id="eg-bone" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#f4ecdb"/><stop offset=".6" stop-color="#cbbd9f"/><stop offset="1" stop-color="#8d7d62"/></radialGradient>
    <radialGradient id="eg-eye" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff5a3c"/><stop offset=".35" stop-color="#8c1f15"/><stop offset="1" stop-color="#140504"/></radialGradient>
    <linearGradient id="eg-shard" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d5a8c"/><stop offset="1" stop-color="#241a33"/></linearGradient>
  </defs>
  <g class="shards" fill="url(#eg-shard)" stroke="#0c0604" stroke-width="2" stroke-linejoin="round">
    <polygon points="26,150 44,118 56,152"/>
    <polygon points="52,156 66,132 78,158"/>
    <polygon points="140,158 150,126 166,154"/>
    <polygon points="160,150 178,124 182,156"/>
    <polygon points="92,164 104,146 116,166"/>
  </g>
  <g class="skull" stroke="#1a0d04" stroke-width="3" stroke-linejoin="round">
    <path fill="url(#eg-bone)" d="M100 14 C60 14 40 44 42 76 C43 94 51 105 60 111 L62 128 C62 135 68 140 75 140 L125 140 C132 140 138 135 138 128 L140 111 C149 105 157 94 158 76 C160 44 140 14 100 14 Z"/>
    <ellipse cx="79" cy="78" rx="15" ry="17" fill="url(#eg-eye)"/>
    <ellipse cx="121" cy="78" rx="15" ry="17" fill="url(#eg-eye)"/>
    <path d="M100 96 L92 112 L108 112 Z" fill="#2a1408"/>
    <path d="M64 118 H136" fill="none"/>
    <path d="M76 118 V138 M88 118 V140 M100 118 V140 M112 118 V140 M124 118 V138" fill="none" stroke-width="2.4"/>
    <path d="M100 14 L106 30 L97 42 L104 54" fill="none" stroke-width="2.2"/>
    <path d="M141 50 L133 58 L138 66" fill="none" stroke-width="2"/>
  </g>
</svg>`;

/* ---------- confetti ---------- */
let anim = 0, parts = [], until = 0;
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } };
const COLORS = () => [...SEAT_CSS, "#f1cd6a", "#fff1bd", "#b48cff"];

function launch(canvas) {
  const W = canvas.clientWidth, H = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = COLORS(), add = (x, y, vx, vy) => parts.push({
    x, y, vx, vy, w: 6 + Math.random() * 6, h: 9 + Math.random() * 8, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.3,
    sway: Math.random() * 6.28, c: cols[(Math.random() * cols.length) | 0], round: Math.random() < 0.25,
  });
  // a burst from behind the sign, then a gentle fall from the top
  for (let i = 0; i < 140; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, s = 7 + Math.random() * 9; add(W / 2, H * 0.32, Math.cos(a) * s, Math.sin(a) * s); }
  let last = performance.now(), spawned = 0;
  until = last + 7000;
  cancelAnimationFrame(anim);
  const frame = now => {
    const dt = Math.min(2.5, (now - last) / 16.7); last = now;
    if (now < until - 2000 && spawned < 220) for (let k = 0; k < 2; k++, spawned++) add(Math.random() * W, -20, (Math.random() - 0.5) * 2, 1 + Math.random() * 2);
    g.clearRect(0, 0, W, H);
    parts = parts.filter(p => p.y < H + 30);
    for (const p of parts) {
      p.vy += 0.18 * dt; p.vx *= 0.985; p.vy *= 0.985;
      p.sway += 0.08 * dt;
      p.x += (p.vx + Math.sin(p.sway) * 0.8) * dt; p.y += p.vy * dt; p.a += p.va * dt;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.scale(1, Math.cos(p.sway * 1.3));
      g.fillStyle = p.c;
      if (p.round) { g.beginPath(); g.arc(0, 0, p.w / 2, 0, 6.28); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (parts.length || now < until) anim = requestAnimationFrame(frame);
    else g.clearRect(0, 0, W, H);
  };
  anim = requestAnimationFrame(frame);
}
function stopConfetti() { cancelAnimationFrame(anim); parts = []; const c = $("confetti"); c.getContext("2d").clearRect(0, 0, c.width, c.height); }

let shown = null;
/** Shows or hides the end screen; outcome is "win", "lose" or null. */
export function setEndScreen(outcome) {
  if (outcome === shown) return;
  shown = outcome;
  const ov = $("endOverlay");
  ov.hidden = !outcome;
  ov.classList.toggle("win", outcome === "win");
  ov.classList.toggle("lose", outcome === "lose");
  if (!outcome) { stopConfetti(); return; }
  $("endArt").innerHTML = outcome === "win" ? WIN_ART : LOSE_ART;
  if (outcome === "win" && !reduced()) requestAnimationFrame(() => launch($("confetti")));
  else stopConfetti();
}
