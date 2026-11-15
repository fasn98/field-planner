'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');

const pts = n => Array.from({ length: n }, (_, i) => ({ lat: -23.98 + i * 0.001, lng: -46.2 - i * 0.0005 }));
const params = url => new URL(url).searchParams;

test('rota curta: um link, sem origem (parte da posição atual), destino = última parada', () => {
  const r = G.mapsRouteUrls(pts(3), 'walk');
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].from, r[0].to], [1, 3]);
  const q = params(r[0].url);
  assert.equal(new URL(r[0].url).origin + new URL(r[0].url).pathname, 'https://www.google.com/maps/dir/');
  assert.equal(q.get('api'), '1');
  assert.equal(q.get('origin'), null);
  assert.equal(q.get('destination'), '-23.978000,-46.201000');
  assert.equal(q.get('waypoints'), '-23.980000,-46.200000|-23.979000,-46.200500');
  assert.equal(q.get('travelmode'), 'walking');
});

test('uma parada só: sem waypoints', () => {
  const q = params(G.mapsRouteUrls(pts(1))[0].url);
  assert.equal(q.get('waypoints'), null);
  assert.equal(q.get('destination'), '-23.980000,-46.200000');
});

test('rota longa: trechos de até 9 intermediárias + destino, encadeados', () => {
  const p = pts(23), r = G.mapsRouteUrls(p, 'car');
  assert.deepEqual(r.map(x => [x.from, x.to]), [[1, 10], [11, 20], [21, 23]]);
  r.forEach((x, i) => {
    const q = params(x.url);
    assert.ok(q.get('waypoints').split('|').length <= G.MAPS_MAX_WAYPOINTS);
    assert.equal(q.get('travelmode'), 'driving');
    if (i > 0) assert.equal(q.get('origin'), params(r[i - 1].url).get('destination')); // começa onde o anterior terminou
  });
  // todas as paradas aparecem, na ordem, exatamente uma vez como intermediária ou destino
  const visited = r.flatMap(x => { const q = params(x.url); return (q.get('waypoints') || '').split('|').filter(Boolean).concat(q.get('destination')); });
  assert.equal(visited.length, 23);
  assert.equal(visited[22], '-23.958000,-46.211000');
});

test('modo desconhecido vira a pé; pontos inválidos são ignorados', () => {
  const r = G.mapsRouteUrls([{ lat: NaN, lng: 1 }, null, { lat: -23.9, lng: -46.2 }], 'teleporte');
  assert.equal(r.length, 1);
  assert.equal(params(r[0].url).get('travelmode'), 'walking');
  assert.deepEqual(G.mapsRouteUrls([]), []);
});

test('link não aponta para domínios da Niantic', () => {
  G.mapsRouteUrls(pts(12)).forEach(x => assert.doesNotMatch(x.url, /ingress|niantic/i));
});
