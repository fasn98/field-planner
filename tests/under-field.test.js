'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const O = require('../optimizer.js');
const { at, portal } = require('./helpers.js');

const P = (x, y) => ({ x, y });
const A = P(0, 0), B = P(100, 0), C = P(50, 100);

test('ponto no interior do triângulo está sob o campo', () => {
  assert.equal(G.pointInTriangle(P(50, 30), A, B, C), true);
});

test('ponto fora do triângulo não está sob o campo', () => {
  assert.equal(G.pointInTriangle(P(150, 30), A, B, C), false);
  assert.equal(G.pointInTriangle(P(50, -1), A, B, C), false);
});

test('vértice do campo não está sob o campo', () => {
  assert.equal(G.pointInTriangle(P(0, 0), A, B, C), false);
  assert.equal(G.pointInTriangle(P(50, 100), A, B, C), false);
});

test('ponto sobre a aresta não está sob o campo', () => {
  assert.equal(G.pointInTriangle(P(50, 0), A, B, C), false);
});

test('triângulo degenerado não cobre nada', () => {
  assert.equal(G.pointInTriangle(P(5, 0), P(0, 0), P(10, 0), P(20, 0)), false);
});

test('independe da orientação dos vértices', () => {
  assert.equal(G.pointInTriangle(P(50, 30), C, B, A), true);
});

test('versão lat/lng', () => {
  assert.equal(G.portalUnderFieldLL(at(50, 30), at(0, 0), at(100, 0), at(50, 100)), true);
  assert.equal(G.portalUnderFieldLL(at(150, 30), at(0, 0), at(100, 0), at(50, 100)), false);
});

// --- a regra aplicada no otimizador ---

function triangleWithInside() {
  return [portal('A', 0, 0), portal('B', 300, 0), portal('C', 150, 300), portal('D', 150, 100)];
}

test('otimizador: portal sob campo aliado existente não gera link de saída', () => {
  const input = {
    portals: triangleWithInside(),
    blockers: [
      { portalA: 'A', portalB: 'B', origem: 'aliado' },
      { portalA: 'B', portalB: 'C', origem: 'aliado' },
      { portalA: 'C', portalB: 'A', origem: 'aliado' }
    ]
  };
  const world = O._internal.buildWorld(input);
  const st = new O._internal.State(world);
  const D = world.idx.D, A = world.idx.A;
  assert.equal(st.covered[D], true);
  assert.equal(st.whyNot(D, A), 'origem sob campo');
  // linkar PARA o portal coberto é permitido (só a saída é proibida)
  assert.equal(st.whyNot(A, D), null);
});

test('otimizador: campo inimigo também bloqueia saída', () => {
  const input = {
    portals: triangleWithInside(),
    blockers: [
      { portalA: 'A', portalB: 'B', origem: 'inimigo' },
      { portalA: 'B', portalB: 'C', origem: 'inimigo' },
      { portalA: 'C', portalB: 'A', origem: 'inimigo' }
    ]
  };
  const world = O._internal.buildWorld(input);
  const st = new O._internal.State(world);
  assert.equal(st.whyNot(world.idx.D, world.idx.A), 'origem sob campo');
});

test('otimizador: campo planejado cobre o portal e ele deixa de linkar', () => {
  const world = O._internal.buildWorld({ portals: triangleWithInside() });
  const st = new O._internal.State(world);
  const { A, B, C, D } = world.idx;
  assert.equal(st.whyNot(D, A), null);
  st.addLink(A, B);
  st.addLink(B, C);
  const f = st.addLink(C, A);
  assert.equal(f.length, 1);
  assert.equal(st.covered[D], true);
  assert.equal(st.whyNot(D, A), 'origem sob campo');
});

test('otimizador: nenhum passo do plano sai de portal coberto no momento do link', () => {
  const ps = [portal('A', 0, 0), portal('B', 400, 0), portal('C', 200, 350), portal('D', 200, 120), portal('E', 120, 60), portal('F', 600, 300)];
  const res = O.optimize({ portals: ps, position: at(0, -50), timeBudgetMs: 400 });
  // reproduz o plano e verifica a regra a cada link
  const world = O._internal.buildWorld({ portals: ps, position: at(0, -50) });
  const st = new O._internal.State(world);
  for (const l of res.links) {
    const s = world.idx[l.from], t = world.idx[l.to];
    assert.equal(st.covered[s], false, `link ${l.n} sai de portal sob campo`);
    assert.equal(st.whyNot(s, t), null, `link ${l.n} inválido: ${st.whyNot(s, t)}`);
    st.addLink(s, t);
  }
  assert.ok(res.fields.length > 0);
});
