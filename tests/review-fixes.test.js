'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../optimizer.js');
const { at, portal } = require('./helpers.js');

const HOSTILE = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

function touches(res, ids) {
  return res.links.filter(l => ids.includes(l.from) || ids.includes(l.to));
}

test('I2: portal com id "__proto__" não lança e funciona como portal normal', () => {
  const input = { portals: [portal('__proto__', 0, 0), portal('B', 200, 0), portal('C', 100, 180)], position: at(0, 0), timeBudgetMs: 200 };
  let res;
  assert.doesNotThrow(() => { res = O.optimize(input); });
  assert.equal(res.links.length, 3);
});

test('I2: bloqueador com portalA "constructor" sem portal correspondente é ignorado', () => {
  const input = {
    portals: [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 180)],
    blockers: [{ portalA: 'constructor', portalB: 'toString', origem: 'inimigo' }, { portalA: '__proto__', portalB: 'A', origem: 'inimigo' }],
    position: at(0, 0), timeBudgetMs: 200
  };
  let res;
  assert.doesNotThrow(() => { res = O.optimize(input); });
  assert.equal(res.links.length, 3, 'bloqueadores fantasmas não devem impedir links');
  assert.equal(touches(res, HOSTILE).length, 0);
});

test('I2: done {from:"toString"} sem portal correspondente não gera link nem lança', () => {
  const input = {
    portals: [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 180)],
    done: [{ from: 'toString', to: 'A' }, { from: 'A', to: 'constructor' }],
    position: at(0, 0), timeBudgetMs: 200
  };
  let res;
  assert.doesNotThrow(() => { res = O.optimize(input); });
  assert.equal(touches(res, HOSTILE).length, 0);
  assert.equal(res.links.length, 3);
});

test('I2: excluded com ids de protótipo não lança nem bloqueia pares reais', () => {
  const input = {
    portals: [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 180)],
    excluded: [{ from: 'constructor', to: 'toString' }, { from: '__proto__', to: 'A' }],
    position: at(0, 0), timeBudgetMs: 200
  };
  let res;
  assert.doesNotThrow(() => { res = O.optimize(input); });
  assert.equal(res.links.length, 3);
});

test('I2: portais com ids de protótipo juntos com bloqueador/done/excluded reais', () => {
  const ids = HOSTILE;
  const ps = ids.map((id, i) => portal(id, i * 150, (i % 2) * 120));
  const input = {
    portals: ps,
    blockers: [{ portalA: 'constructor', portalB: 'toString', origem: 'aliado' }],
    done: [{ from: '__proto__', to: 'hasOwnProperty' }],
    excluded: [{ from: '__proto__', to: 'toString' }],
    position: at(0, 0), timeBudgetMs: 200
  };
  let res;
  assert.doesNotThrow(() => { res = O.optimize(input); });
  const same = (l, a, b) => (l.from === a && l.to === b) || (l.from === b && l.to === a);
  assert.ok(!res.links.some(l => same(l, '__proto__', 'toString')), 'par excluído foi linkado');
  assert.ok(!res.links.some(l => same(l, 'constructor', 'toString')), 'par já fixo foi relinkado');
  assert.ok(!res.links.some(l => same(l, '__proto__', 'hasOwnProperty')), 'par já feito foi relinkado');
});

test('I2: portal sem id string é ignorado em vez de lançar', () => {
  const input = { portals: [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 180), Object.assign(portal('X', 50, 50), { id: 42 }), null], position: at(0, 0), timeBudgetMs: 200 };
  let res;
  assert.doesNotThrow(() => { res = O.optimize(input); });
  assert.equal(res.links.length, 3);
});

test('M8: portais na mesma coordenada nunca recebem link entre si', () => {
  const input = { portals: [portal('A', 0, 0), portal('A2', 0, 0), portal('B', 200, 0), portal('C', 100, 180)], position: at(0, 0), timeBudgetMs: 300 };
  const res = O.optimize(input);
  assert.ok(!res.links.some(l => (l.from === 'A' && l.to === 'A2') || (l.from === 'A2' && l.to === 'A')));
});

test('M8: whyNot informa "portais na mesma posição" para pontos coincidentes', () => {
  const world = O._internal.buildWorld({ portals: [portal('A', 0, 0), portal('A2', 0.3, 0), portal('B', 200, 0)], position: at(0, 0) });
  const st = new O._internal.State(world);
  assert.equal(st.whyNot(world.idx.A, world.idx.A2), 'portais na mesma posição');
  assert.equal(st.whyNot(world.idx.A, world.idx.B), null);
});

test('M5: portal visitado sem links vira destino do fan (via visitOrder)', () => {
  const world = O._internal.buildWorld({
    portals: [portal('ANC', 0, 0), portal('V', 300, 0), portal('S', 150, 260)],
    excluded: [{ from: 'V', to: 'ANC' }], // V não consegue linkar a âncora: fica visitado sem links
    position: at(0, 0)
  });
  const { ANC, V, S } = world.idx;
  const res = O._internal.simulate(world, [V, S], { type: 'fan', anchor: ANC });
  const links = res.state.planLinks.map(l => [world.pts[l.from].id, world.pts[l.to].id].sort().join('-'));
  assert.ok(links.includes('S-V'), 'S deveria linkar V, visitado sem links; obtido: ' + links.join(','));
});
