'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const I = require('../intelprint.js');
const { canvas, C, neutral, faction } = require('./intel-synth.js');

function scene() {
  const img = canvas(800, 1200, C.bg);
  // campo verde entre três portais verdes, com um neutro dentro
  img.tri([150, 400], [450, 380], [300, 650], C.fieldG);
  img.line(150, 400, 450, 380, C.green); img.line(450, 380, 300, 650, C.green); img.line(300, 650, 150, 400, C.green);
  faction(img, 150, 400, 'verde'); faction(img, 450, 380, 'verde'); faction(img, 300, 650, 'verde');
  neutral(img, 300, 480);                         // dentro do campo
  neutral(img, 600, 800); neutral(img, 650, 300); // fora
  faction(img, 520, 950, 'azul');
  img.line(520, 950, 0, 1000, C.blue);            // link azul que sai pela borda esquerda
  neutral(img, 100, 30);                          // na barra de busca: ignorado
  return img;
}

test('detecta neutros (miolo 86,86,86 + anel branco) e facções pelo anel, fora da interface', () => {
  const ps = I.detectPortals(scene());
  const by = f => ps.filter(p => p.faccao === f);
  assert.equal(by('neutro').length, 3);
  assert.equal(by('verde').length, 3);
  assert.equal(by('azul').length, 1);
  const n = by('neutro').find(p => Math.abs(p.x - 600) < 2);
  assert.ok(n && Math.abs(n.y - 800) < 2, 'centro = centroide do miolo');
});

test('links: triângulo verde vira 3 links entre portais; azul com ponta fora do print vai até a borda', () => {
  const an = I.analyze(scene());
  const g = an.links.filter(l => l.cor === 'verde');
  assert.equal(g.length, 3);
  g.forEach(l => assert.ok(l.a.portal != null && l.b.portal != null));
  const b = an.links.filter(l => l.cor === 'azul');
  assert.equal(b.length, 1);
  const fora = [b[0].a, b[0].b].find(e => e.fora);
  assert.ok(fora && fora.x < 2, 'prolongado até a borda esquerda');
  const n = an.portals.find(p => p.faccao === 'neutro' && Math.abs(p.x - 300) < 2);
  assert.equal(n.coberto, 'verde');
  an.portals.filter(p => p !== n && p.faccao === 'neutro').forEach(p => assert.equal(p.coberto, null));
});

test('escala padrão: 156543.03·cos(lat)/2^z/DPR', () => {
  const s = I.defaultScale(-23.62, 15, 2);
  assert.ok(Math.abs(s - 2.19) / 2.19 < 0.01, String(s));
});

const BASE = { lat: -23.62, lng: -46.67 };
const s0 = 2.2, kx = 6378137 * Math.cos(BASE.lat * Math.PI / 180) * Math.PI / 180, ky = 6378137 * Math.PI / 180;
const llOf = (x, y) => ({ lat: BASE.lat - (y - 600) * s0 / ky, lng: BASE.lng + (x - 400) * s0 / kx });

test('georreferência: 1 ponto só translada; 2+ ajustam a escala e dão resíduo por ponto', () => {
  const t1 = I.fitTransform([{ x: 400, y: 600, ...llOf(400, 600) }]);
  assert.equal(t1.residuals[0], 0);
  assert.ok(Math.abs(t1.scale - I.defaultScale(BASE.lat, 15, 2)) < 1e-9);
  const refs = [[100, 200], [700, 300], [300, 1100]].map(([x, y]) => ({ x, y, ...llOf(x, y) }));
  const t3 = I.fitTransform(refs);
  assert.ok(Math.abs(t3.scale - s0) < 0.01);
  assert.ok(t3.maxResidual < 1 && t3.ok);
  const p = t3.toLL(555, 777), q = llOf(555, 777);
  assert.ok(G.haversine(p, q) < 1);
  // referência errada (portal trocado) → resíduo > 30 m → não importa
  const bad = refs.slice(); bad[2] = { ...bad[2], lat: bad[2].lat + 0.001 };
  const tb = I.fitTransform(bad);
  assert.ok(tb.maxResidual > 30 && !tb.ok);
});

test('import: Print NN estimado, duplicata a < 15 m só atualiza facção, bloqueadores, segmento fora do print, sob campo', () => {
  const img = scene(), an = I.analyze(img);
  const refs = [[150, 400], [450, 380], [300, 650]].map(([x, y]) => ({ x, y, ...llOf(x, y) }));
  const tr = I.fitTransform(refs);
  const existente = { id: 'old', nome: 'Praça', ...llOf(603, 804), nivel: 5, chaves: 2, observacao: '', faccao: 'verde' }; // ~10 m do neutro
  let k = 0;
  const now = new Date(2026, 10, 25, 11, 38).getTime();
  const out = I.buildImport(an, tr, [existente], { now, myFaction: 'azul', newId: () => 'n' + (++k) });
  assert.equal(out.novos.length, an.portals.length - 1);
  assert.ok(out.novos.every(p => /^Print \d\d$/.test(p.nome) && p.observacao === 'ESTIMADO pelo print 25/11 11:38'));
  assert.deepEqual(out.updates, [{ id: 'old', faccao: 'neutro' }]);
  assert.equal(out.blockers.length, 3);
  assert.ok(out.blockers.every(b => b.origem === 'inimigo' && b.fonte === 'print' && b.ts === now));
  assert.equal(out.segments.length, 1);
  assert.equal(out.segments[0].origem, 'aliado');
  assert.equal(out.segments[0].nota, 'ponta fora do print');
  assert.equal(out.covered.length, 1);
});

test('autoMatchRefs acha os portais das referências pela escala padrão', () => {
  const img = scene(), an = I.analyze(img);
  const refs = [[150, 400], [600, 800], [520, 950]].map(([x, y]) => llOf(x, y));
  const m = I.autoMatchRefs(an.portals, refs, { zoom: 15, dpr: 2 });
  assert.ok(m && m.tr.maxResidual < 2, JSON.stringify(m && m.tr.residuals));
});

test('idade do bloqueador de print', () => {
  assert.equal(I.printAgeDays({ fonte: 'print', ts: 0 }, 10), null);
  assert.equal(I.printAgeDays({ fonte: 'print', ts: 1 }, 1 + 3 * 86400000), 3);
  assert.equal(I.printAgeDays({ origem: 'inimigo' }, 5), null);
});

test('bloqueador "segmento" (ponta fora do print) impede link que o cruza', () => {
  const O = require('../optimizer.js');
  const { at, portal } = require('./helpers.js');
  const ps = [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 150)];
  const seg = { tipo: 'segmento', a: at(100, -100), b: at(100, 60), origem: 'inimigo', fonte: 'print', ts: 1, nota: 'ponta fora do print' };
  const w = O._internal.buildWorld({ portals: ps, blockers: [seg] });
  const st = new O._internal.State(w);
  assert.equal(st.whyNot(w.idx.A, w.idx.B), 'cruza segmento');
  assert.equal(st.whyNot(w.idx.A, w.idx.C), null);
  const res = O.optimize({ portals: ps, blockers: [seg], timeBudgetMs: 200 });
  assert.ok(!res.links.some(l => [l.from, l.to].sort().join() === 'A,B'));
});
