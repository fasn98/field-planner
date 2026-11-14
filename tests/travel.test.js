'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');

test('a pé: 1 km em linha reta ≈ 1,3 km de rua a 4,5 km/h ≈ 17 min, +1 min parada +1 min link', () => {
  const t = G.travelTimes([1000], 1);
  assert.equal(t.walk, Math.round(1.3 / 4.5 * 60 + 2));
});

test('trechos curtos de carro e transporte são feitos a pé', () => {
  const t = G.travelTimes([300, 300], 0);
  assert.equal(t.car, t.walk);
  assert.equal(t.transit, t.walk);
});

test('trecho longo: carro < transporte < a pé', () => {
  const t = G.travelTimes([10000], 2);
  assert.ok(t.car < t.transit && t.transit < t.walk, JSON.stringify(t));
});

test('sem trechos: só o tempo dos links', () => {
  assert.deepEqual(G.travelTimes([], 3), { walk: 3, car: 3, transit: 3, action: 3 });
});
