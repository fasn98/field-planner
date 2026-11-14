'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const { at } = require('./helpers.js');

const P = (x, y) => ({ x, y });

test('segmentos em X se cruzam', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(10, 10), P(0, 10), P(10, 0)), true);
});

test('segmentos paralelos não se cruzam', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(0, 5), P(10, 5)), false);
});

test('segmentos disjuntos alinhados em direções diferentes não se cruzam', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(4, 4), P(5, 0), P(9, -4)), false);
});

test('links que compartilham um portal não se cruzam', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(0, 0), P(0, 10)), false);
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(10, 0), P(20, 7)), false);
});

test('mesmo link (ordem invertida) não é tratado como cruzamento', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(10, 0), P(0, 0)), false);
});

test('ponta tocando o meio de outro link (T) conta como cruzamento', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(5, 0), P(5, 8)), true);
});

test('colineares sobrepostos contam como cruzamento; colineares separados não', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(5, 0), P(15, 0)), true);
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(11, 0), P(15, 0)), false);
});

test('colineares com portal comum e sobreposição contam como cruzamento', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(0, 0), P(5, 0)), true);
  assert.equal(G.segmentsCross(P(0, 0), P(10, 0), P(0, 0), P(-5, 0)), false);
});

test('quase-cruzamento (folga de 1 m) não cruza', () => {
  assert.equal(G.segmentsCross(P(0, 0), P(100, 0), P(50, 1), P(50, 100)), false);
});

test('versão lat/lng: cruzamento real em São Paulo (~200 m)', () => {
  assert.equal(G.linksCrossLL(at(0, 0), at(200, 200), at(0, 200), at(200, 0)), true);
  assert.equal(G.linksCrossLL(at(0, 0), at(200, 0), at(0, 50), at(200, 50)), false);
});

test('é simétrico na ordem dos segmentos e das pontas', () => {
  const a = P(0, 0), b = P(10, 3), c = P(2, 8), d = P(7, -4);
  const r = G.segmentsCross(a, b, c, d);
  assert.equal(G.segmentsCross(c, d, a, b), r);
  assert.equal(G.segmentsCross(b, a, d, c), r);
});

// --- links longos seguem a geodésica (grande círculo), não a reta do mapa plano ---

function gcMidpoint(a, b) {
  const D = Math.PI / 180, f1 = a.lat * D, l1 = a.lng * D, f2 = b.lat * D, l2 = b.lng * D;
  const bx = Math.cos(f2) * Math.cos(l2 - l1), by = Math.cos(f2) * Math.sin(l2 - l1);
  const f = Math.atan2(Math.sin(f1) + Math.sin(f2), Math.sqrt((Math.cos(f1) + bx) ** 2 + by ** 2));
  const l = l1 + Math.atan2(by, Math.cos(f1) + bx);
  return { lat: f / D, lng: l / D };
}

test('projeção: o ponto médio da geodésica cai sobre a reta projetada (link de ~60 km E–O)', () => {
  const a = { lat: -23.6, lng: -46.9 }, b = { lat: -23.6, lng: -46.3 };
  const m = gcMidpoint(a, b);
  const pr = G.makeProjection(G.centroid([a, b]));
  const A = pr.toXY(a), B = pr.toXY(b), M = pr.toXY(m);
  const dist = Math.abs(G.orient(A, B, M)) / Math.hypot(B.x - A.x, B.y - A.y);
  assert.ok(dist < 0.5, `geodésica a ${dist.toFixed(2)} m da reta`); // equiretangular dava ~30 m
});

test('cruzamento em escala de dezenas de km segue a geodésica', () => {
  // link E–O de 60 km; o outro link termina 10 m ao sul da reta "plana" mas ao norte da geodésica
  const a = { lat: -23.6, lng: -46.9 }, b = { lat: -23.6, lng: -46.3 };
  const m = gcMidpoint(a, b); // no hemisfério sul a geodésica E–O se curva para o sul (para o polo)
  const dLat = 10 / 111195;
  const above = { lat: m.lat + dLat, lng: m.lng }, below = { lat: m.lat - dLat, lng: m.lng };
  const north = { lat: -23.3, lng: -46.6 };
  assert.equal(G.linksCrossLL(a, b, north, above), false, 'termina antes da geodésica: não cruza');
  assert.equal(G.linksCrossLL(a, b, north, below), true, 'passa da geodésica: cruza');
});

test('portal do outro lado do planeta não entra na conta (projeção só vale até 90°)', () => {
  const O = require('../optimizer.js');
  const { at, portal } = require('./helpers.js');
  const ps = [portal('A', 0, 0), portal('B', 300, 0), portal('C', 150, 260),
    { id: 'JP', nome: 'Tóquio', lat: 35.68, lng: 139.76, nivel: 8, chaves: 5 }];
  const res = O.optimize({ portals: ps, position: at(0, 0),
    blockers: [{ portalA: 'A', portalB: 'JP', origem: 'inimigo' }], timeBudgetMs: 200 });
  assert.equal(res.fields.length, 1); // o link A–Tóquio não bloqueia nada aqui
  assert.ok(res.links.every(l => l.from !== 'JP' && l.to !== 'JP'));
});
