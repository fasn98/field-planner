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
