'use strict';
// Caso real de 25/11/2026: prints do Intel do dono (zona sul). Os arquivos ficam só no computador dele
// (tests/fixtures-local/intel-25112026/, fora do git). Sem eles, ou sem o Chromium do Playwright para
// decodificar a imagem do mesmo jeito que o navegador, os testes são pulados.
//   print-1138.png (ou .jpg) — print das 11:38
//   meta.json (opcional) — { "zoom": 15, "dpr": 2 }
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const G = require('../geo.js');
const I = require('../intelprint.js');

const dir = path.join(__dirname, 'fixtures-local', 'intel-25112026');
const file = ['print-1138.png', 'print-1138.jpg', 'print-1138.jpeg'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
let pw = null;
try { pw = require('playwright'); } catch (e) { /* sem playwright: pula */ }
const SKIP = !file ? 'prints reais só no computador do dono (tests/fixtures-local/intel-25112026/)' : !pw ? 'sem playwright para decodificar a imagem' : false;
const meta = file && fs.existsSync(path.join(dir, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) : {};
const OPTS = { zoom: meta.zoom || 15, dpr: meta.dpr || 2 };

const REFS = [
  { nome: 'Playground do Fascination', lat: -23.6213, lng: -46.6764 },
  { nome: 'AMRAP', lat: -23.621817, lng: -46.67238 },
  { nome: 'Pet Shop Amigão', lat: -23.631709, lng: -46.682322 }
];

let an = null;
async function load() {
  if (an) return an;
  const b = await pw.chromium.launch();
  try {
    const page = await b.newPage();
    const b64 = fs.readFileSync(file).toString('base64'), mime = /\.png$/.test(file) ? 'image/png' : 'image/jpeg';
    const img = await page.evaluate(async ([b64, mime]) => {
      const im = new Image(); im.src = 'data:' + mime + ';base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      return { width: d.width, height: d.height, data: Array.from(d.data) };
    }, [b64, mime]);
    an = I.analyze({ width: img.width, height: img.height, data: Uint8ClampedArray.from(img.data) }, OPTS);
  } finally { await b.close(); }
  return an;
}

test('25/11 11:38: 75±3 neutros', { skip: SKIP, timeout: 120000 }, async () => {
  const a = await load();
  const n = a.portals.filter(p => p.faccao === 'neutro').length;
  assert.ok(Math.abs(n - 75) <= 3, n + ' neutros');
});

test('25/11 11:38: 3 referências → resíduo ≤ 25 m e escala 2,19 ±3% m/px', { skip: SKIP, timeout: 120000 }, async () => {
  const a = await load();
  const m = I.autoMatchRefs(a.portals, REFS, OPTS);
  assert.ok(m, 'referências não encontradas no print');
  assert.ok(m.tr.maxResidual <= 25, 'resíduos ' + m.tr.residuals.join(', ') + ' m');
  assert.ok(Math.abs(m.tr.scale - 2.19) / 2.19 <= 0.03, 'escala ' + m.tr.scale.toFixed(3));
});

test('25/11 11:38: link verde do oeste até o grupo do AMRAP vira bloqueador', { skip: SKIP, timeout: 120000 }, async () => {
  const a = await load();
  const m = I.autoMatchRefs(a.portals, REFS, OPTS);
  let k = 0;
  const out = I.buildImport(a, m.tr, [], { now: Date.now(), newId: () => 'n' + (++k) });
  const all = out.novos;
  const ll = (b) => b.tipo === 'segmento' ? [b.a, b.b] : [all.find(p => p.id === b.portalA), all.find(p => p.id === b.portalB)];
  const amrap = REFS[1];
  const greens = out.blockers.concat(out.segments).filter(b => b.cor === 'verde'); // a cor não é gravada no app
  const hit = greens.some(b => {
    const [p, q] = ll(b);
    if (!p || !q) return false;
    const [near, far] = G.haversine(p, amrap) < G.haversine(q, amrap) ? [p, q] : [q, p];
    return G.haversine(near, amrap) <= 150 && far.lng < amrap.lng && G.haversine(far, amrap) >= 300;
  });
  assert.ok(hit, 'nenhum bloqueador do oeste chegando a ≤150 m do AMRAP');
});
