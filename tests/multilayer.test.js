'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const O = require('../optimizer.js');
const { at, portal } = require('./helpers.js');

// base A–B de 1 km e 5 portais "centrais" encaixados, cada um dentro do triângulo do anterior
function nested() {
  const ps = [portal('A', 0, 0), portal('B', 1000, 0)];
  [900, 600, 400, 250, 120].forEach((h, i) => ps.push(portal('C' + (i + 1), 500 + (i % 2 ? 15 : -15), h)));
  return ps;
}

function replay(input, res) {
  const world = O._internal.buildWorld(input);
  const st = new O._internal.State(world);
  for (const l of res.links) {
    const s = world.idx[l.from], t = world.idx[l.to];
    assert.equal(st.whyNot(s, t), null, `link ${l.n} ${l.from}->${l.to}: ${st.whyNot(s, t)}`);
    st.addLink(s, t);
  }
}

test('multicamada empilha uma camada por portal central encaixado', () => {
  const input = { portals: nested(), position: at(500, -50), ignoreKeys: true, strategy: 'multicamada', timeBudgetMs: 500 };
  const res = O.optimize(input);
  assert.equal(res.strategy, 'multicamada');
  assert.deepEqual([...res.base].sort(), ['A', 'B']);
  assert.equal(res.fields.length, 5);
  assert.equal(res.layers, 5);
  replay(input, res);
});

test('ordem do miolo para fora: nenhum portal central linka estando sob campo', () => {
  const input = { portals: nested(), position: at(500, -50), ignoreKeys: true, strategy: 'multicamada', timeBudgetMs: 500 };
  const res = O.optimize(input);
  const visits = res.steps.map(s => s.portal);
  // depois da base, os centrais vêm do mais interno (C5) para o mais externo (C1)
  assert.deepEqual(visits.slice(1), ['C5', 'C4', 'C3', 'C2', 'C1']);
});

test('camadas se sobrepõem: o portal mais interno fica sob todas as camadas externas', () => {
  const ps = nested();
  const pos = Object.fromEntries(ps.map(p => [p.id, p]));
  const res = O.optimize({ portals: ps, position: at(500, -50), ignoreKeys: true, strategy: 'multicamada', timeBudgetMs: 500 });
  const c5 = pos.C5;
  const cover = res.fields.filter(f => !f.portals.includes('C5') && G.portalUnderFieldLL(c5, ...f.portals.map(id => pos[id])));
  assert.equal(cover.length, 4);
});

test('portal fora do triângulo principal não entra na cadeia da base A–B', () => {
  const ps = nested().concat([portal('FORA', 1600, 300)]);
  const world = O._internal.buildWorld({ portals: ps, position: at(500, -50), ignoreKeys: true });
  const chain = O._internal.layerChain(world, world.idx.A, world.idx.B, 1).map(i => world.pts[i].id);
  assert.deepEqual(chain, ['C5', 'C4', 'C3', 'C2', 'C1']); // FORA está do mesmo lado, mas fora de A-B-C1
  // e com ele no conjunto o plano continua válido e não piora
  const input = { portals: ps, position: at(500, -50), ignoreKeys: true, strategy: 'multicamada', timeBudgetMs: 500 };
  const res = O.optimize(input);
  assert.ok(res.fields.length >= 5);
  replay(input, res);
});

test('no modo automático, com portais encaixados, o plano tem pelo menos as camadas da multicamada', () => {
  const input = { portals: nested(), position: at(500, -50), ignoreKeys: true, timeBudgetMs: 900 };
  const res = O.optimize(input);
  assert.ok(res.fields.length >= 5, `veio ${res.fields.length} campos (${res.strategy})`);
  replay(input, res);
});

test('objetivo MU soma a área de todas as camadas', () => {
  const ps = nested();
  const pos = Object.fromEntries(ps.map(p => [p.id, p]));
  const res = O.optimize({ portals: ps, position: at(500, -50), ignoreKeys: true, strategy: 'multicamada', objective: 'mu', timeBudgetMs: 500 });
  const pr = G.makeProjection(G.centroid(ps));
  const soma = res.fields.reduce((a, f) => { const [p, q, r] = f.portals.map(id => pr.toXY(pos[id])); return a + G.triangleArea(p, q, r); }, 0);
  assert.ok(Math.abs(res.area - soma) / soma < 0.01, `${res.area} vs ${Math.round(soma)}`);
});
