'use strict';
// Gera um "print do Intel" sintético (RGBA) com as cores fixas do mapa escuro, para os testes.
function canvas(w, h, bg) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
  const img = { width: w, height: h, data };
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; };
  img.disc = (cx, cy, r, c) => { for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, c); };
  img.ring = (cx, cy, r0, r1, c) => { for (let y = cy - r1 - 1; y <= cy + r1 + 1; y++) for (let x = cx - r1 - 1; x <= cx + r1 + 1; x++) { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d <= r1 * r1 && d > r0 * r0) put(x, y, c); } };
  img.line = (x1, y1, x2, y2, c, wd = 2) => { const L = Math.hypot(x2 - x1, y2 - y1); for (let t = 0; t <= L; t += 0.5) { const x = x1 + (x2 - x1) * t / L, y = y1 + (y2 - y1) * t / L; for (let a = -wd / 2; a <= wd / 2; a += 0.5) for (let b = -wd / 2; b <= wd / 2; b += 0.5) put(x + a, y + b, c); } };
  img.tri = (A, B, C, c) => { // preenche triângulo (sombra de campo)
    const minx = Math.min(A[0], B[0], C[0]), maxx = Math.max(A[0], B[0], C[0]), miny = Math.min(A[1], B[1], C[1]), maxy = Math.max(A[1], B[1], C[1]);
    const s = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) { const P = [x, y], a = s(A, B, P), b = s(B, C, P), d = s(C, A, P); if ((a >= 0 && b >= 0 && d >= 0) || (a <= 0 && b <= 0 && d <= 0)) put(x, y, c); }
  };
  return img;
}
const C = { bg: [20, 22, 25], gray: [86, 86, 86], white: [235, 235, 235], green: [40, 230, 60], blue: [30, 150, 240], fieldG: [24, 60, 30], fieldB: [22, 34, 70] };
function neutral(img, x, y) { img.disc(x, y, 12, C.white); img.disc(x, y, 9, C.gray); }
function faction(img, x, y, cor) { img.ring(x, y, 9, 12, cor === 'verde' ? C.green : C.blue); img.disc(x, y, 9, [15, 15, 15]); }
module.exports = { canvas, C, neutral, faction };
