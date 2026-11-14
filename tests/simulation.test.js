'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const O = require('../optimizer.js');
const { at, portal } = require('./helpers.js');

function replay(input, res) {
  const world = O._internal.buildWorld(input);
  const st = new O._internal.State(world);
  for (const l of res.links) {
    const s = world.idx[l.from], t = world.idx[l.to];
    const why = st.whyNot(s, t);
    assert.equal(why, null, `link ${l.n} ${l.from}->${l.to} inválido: ${why}`);
    st.addLink(s, t);
  }
}

test('simulação ignora chaves e devolve a lista de farm', () => {
  const ps = [portal('A', 0, 0, { chaves: 0 }), portal('B', 300, 0, { chaves: 1 }), portal('C', 150, 260, { chaves: 0 }), portal('D', 150, 90, { chaves: 0 })];
  const input = { portals: ps, position: at(0, 0), ignoreKeys: true, timeBudgetMs: 300 };
  const res = O.optimize(input);
  assert.equal(res.simulation, true);
  assert.ok(res.fields.length >= 1, 'simulação deveria fechar campos mesmo sem chaves');
  replay(input, res); // válido geometricamente (o replay também ignora chaves)
  // farm: para cada destino, precisa = usado; faltam = precisa - tem
  const used = {};
  for (const l of res.links) used[l.to] = (used[l.to] || 0) + 1;
  for (const k of res.keysMissing) {
    assert.equal(k.need, used[k.portal]);
    assert.equal(k.missing, k.need - k.have);
    assert.ok(k.missing > 0);
  }
  // B tem 1 chave: só aparece no farm se o plano usar 2 ou mais
  const b = res.keysMissing.find(k => k.portal === 'B');
  if (b) assert.ok(b.need >= 2);
});

test('sem simulação e sem chaves: nenhum link (comportamento anterior preservado)', () => {
  const ps = [portal('A', 0, 0, { chaves: 0 }), portal('B', 300, 0, { chaves: 0 }), portal('C', 150, 260, { chaves: 0 })];
  const res = O.optimize({ portals: ps, position: at(0, 0), timeBudgetMs: 200 });
  assert.equal(res.links.length, 0);
  assert.equal(res.simulation, false);
});

test('área do campo é calculada corretamente (triângulo 300 × 260 m)', () => {
  const ps = [portal('A', 0, 0), portal('B', 300, 0), portal('C', 150, 260)];
  const res = O.optimize({ portals: ps, position: at(0, 0), timeBudgetMs: 200 });
  assert.equal(res.fields.length, 1);
  assert.ok(Math.abs(res.fields[0].area - 39000) < 100, `área ${res.fields[0].area}`);
  assert.equal(res.area, res.fields[0].area);
  const closing = res.links.find(l => l.fields > 0);
  assert.equal(closing.area, res.fields[0].area);
});

test('objetivo MU (área) nunca rende menos área que o objetivo campos', () => {
  // âncora longe + portais próximos: muitos campos pequenos versus poucos campos grandes
  const ps = [portal('X', 0, 0), portal('Y', 900, 0), portal('Z', 450, 800)];
  for (let i = 0; i < 6; i++) ps.push(portal('I' + i, 380 + i * 25, 120 + (i % 3) * 30));
  const base = { portals: ps, position: at(450, -100), ignoreKeys: true, timeBudgetMs: 600 };
  const byFields = O.optimize({ ...base, objective: 'campos' });
  const byArea = O.optimize({ ...base, objective: 'mu' });
  assert.ok(byArea.area >= byFields.area, `mu ${byArea.area} < campos ${byFields.area}`);
  replay(base, byArea);
});

test('simulação corta candidatos só por distância (chaves não contam)', () => {
  const ps = [];
  for (let i = 0; i < 60; i++) ps.push(portal('P' + i, i * 20, (i % 7) * 15, { chaves: i >= 50 ? 5 : 0 }));
  const res = O.optimize({ portals: ps, position: at(0, 0), ignoreKeys: true, timeBudgetMs: 300 });
  assert.equal(res.candidates, 30);
  // os 30 mais próximos de (0,0) são P0..P29; nenhum dos com chave (P50+) deve ter entrado
  const usados = new Set(res.links.flatMap(l => [l.from, l.to]));
  for (const id of usados) assert.ok(+id.slice(1) < 30, `${id} não está entre os 30 mais próximos`);
});
