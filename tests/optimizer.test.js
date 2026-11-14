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
  return st;
}

test('triângulo simples gera 1 campo e 3 links', () => {
  const input = { portals: [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 180)], position: at(0, 0), timeBudgetMs: 300 };
  const res = O.optimize(input);
  assert.equal(res.links.length, 3);
  assert.equal(res.fields.length, 1);
  assert.equal(res.ap, 3 * O.AP_LINK + O.AP_FIELD);
  replay(input, res);
});

test('fanfield: âncora + 5 portais em arco gera 2n-3 links e n-2 campos', () => {
  const ps = [portal('ANC', 0, 0)];
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI / 2) * (i / 4) + 0.1;
    ps.push(portal('P' + i, 400 * Math.cos(a), 400 * Math.sin(a)));
  }
  const input = { portals: ps, position: at(0, 0), strategy: 'fanfield', timeBudgetMs: 300 };
  const res = O.optimize(input);
  assert.equal(res.strategy, 'fanfield');
  assert.equal(res.fields.length, 4); // 6 portais → 4 campos
  replay(input, res);
});

test('nenhum link planejado cruza bloqueador inimigo', () => {
  const ps = [portal('A', 0, 0), portal('B', 300, 0), portal('C', 150, 260), portal('X', 150, -100), portal('Y', 150, 400)];
  const input = { portals: ps, blockers: [{ portalA: 'X', portalB: 'Y', origem: 'inimigo' }], position: at(0, 0), timeBudgetMs: 300 };
  const res = O.optimize(input);
  const pos = Object.fromEntries(ps.map(p => [p.id, p]));
  for (const l of res.links) {
    assert.equal(G.linksCrossLL(pos[l.from], pos[l.to], pos.X, pos.Y), false, `${l.from}->${l.to} cruza X-Y`);
  }
  replay(input, res);
});

test('links planejados não se cruzam entre si', () => {
  const ps = [];
  for (let i = 0; i < 9; i++) ps.push(portal('P' + i, (i % 3) * 180 + (i * 37) % 50, Math.floor(i / 3) * 170 + (i * 53) % 40));
  const input = { portals: ps, position: at(-50, -50), timeBudgetMs: 600 };
  const res = O.optimize(input);
  const pos = Object.fromEntries(ps.map(p => [p.id, p]));
  for (let i = 0; i < res.links.length; i++) for (let j = i + 1; j < res.links.length; j++) {
    const a = res.links[i], b = res.links[j];
    assert.equal(G.linksCrossLL(pos[a.from], pos[a.to], pos[b.from], pos[b.to]), false, `#${a.n} cruza #${b.n}`);
  }
  assert.ok(res.fields.length >= 5, `esperava ≥5 campos, veio ${res.fields.length}`);
});

test('destino sem chave não recebe link; chaves faltantes são reportadas', () => {
  const ps = [portal('A', 0, 0, { chaves: 0 }), portal('B', 200, 0, { chaves: 0 }), portal('C', 100, 180, { chaves: 0 })];
  const input = { portals: ps, position: at(0, 0), timeBudgetMs: 200 };
  const res = O.optimize(input);
  assert.equal(res.links.length, 0);
  assert.ok(res.keysMissing.length > 0);
  assert.ok(res.potentialFields >= 1);
});

test('chaves consumidas nunca excedem as chaves que o usuário tem', () => {
  const ps = [portal('A', 0, 0, { chaves: 1 }), portal('B', 200, 0, { chaves: 1 }), portal('C', 100, 180, { chaves: 1 }), portal('D', 100, 60, { chaves: 1 })];
  const res = O.optimize({ portals: ps, position: at(0, 0), timeBudgetMs: 300 });
  for (const k of res.keysUsed) assert.ok(k.used <= k.have, `${k.portal}: ${k.used} > ${k.have}`);
});

test('respeita limite de links de saída', () => {
  const ps = [portal('S', 0, 0)];
  for (let i = 0; i < 10; i++) ps.push(portal('T' + i, 300 * Math.cos(i / 3), 300 * Math.sin(i / 3)));
  const res = O.optimize({ portals: ps, position: at(0, 0), maxOut: 3, timeBudgetMs: 400 });
  const out = {};
  for (const l of res.links) out[l.from] = (out[l.from] || 0) + 1;
  for (const k in out) assert.ok(out[k] <= 3, `${k} com ${out[k]} links de saída`);
});

test('respeita alcance pelo nível (L1 = 160 m)', () => {
  assert.equal(G.linkRange(1), 160);
  assert.equal(G.linkRange(8), 160 * 4096);
  const ps = [portal('A', 0, 0, { nivel: 1 }), portal('B', 500, 0, { nivel: 1 }), portal('C', 250, 400, { nivel: 1 })];
  const res = O.optimize({ portals: ps, position: at(0, 0), timeBudgetMs: 200 });
  assert.equal(res.links.length, 0);
});

test('portais fora do raio a pé são ignorados', () => {
  const ps = [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 180), portal('LONGE', 5000, 0)];
  const res = O.optimize({ portals: ps, position: at(0, 0), radius: 1500, timeBudgetMs: 200 });
  assert.equal(res.candidates, 3);
  assert.ok(res.links.every(l => l.from !== 'LONGE' && l.to !== 'LONGE'));
});

test('par marcado como falho não é replanejado', () => {
  const ps = [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 180)];
  const res = O.optimize({ portals: ps, position: at(0, 0), excluded: [{ from: 'A', to: 'B' }], timeBudgetMs: 200 });
  assert.ok(res.links.every(l => !((l.from === 'A' && l.to === 'B') || (l.from === 'B' && l.to === 'A'))));
});

test('rota: 2-opt nunca piora o vizinho mais próximo', () => {
  const ps = [];
  for (let i = 0; i < 10; i++) ps.push(portal('P' + i, (i * 137) % 700, (i * 211) % 600));
  const world = O._internal.buildWorld({ portals: ps, position: at(0, 0) });
  const nn = O._internal.nearestNeighbor(world, world.candidates);
  const opt = O._internal.twoOpt(world, nn);
  assert.ok(O._internal.routeLength(world, opt) <= O._internal.routeLength(world, nn) + 1e-6);
  assert.deepEqual([...opt].sort((a, b) => a - b), [...world.candidates].sort((a, b) => a - b));
});

test('centenas de portais no raio: limita candidatos, respeita o prazo e o plano é válido', () => {
  const ps = [];
  for (let i = 0; i < 300; i++) ps.push(portal('P' + i, (i * 137) % 1400 - 700, (i * 211) % 1300 - 650, { chaves: i % 4 === 0 ? 3 : 0, nivel: 4 }));
  const input = { portals: ps, position: at(0, 0), radius: 1500, timeBudgetMs: 800 };
  const t0 = Date.now();
  const res = O.optimize(input);
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `levou ${ms} ms`);
  assert.equal(res.inRadius, 300);
  assert.equal(res.candidates, 30);
  assert.ok(res.links.length > 0);
  replay(input, res);
});

test('com poucos portais nada é cortado', () => {
  const ps = [portal('A', 0, 0), portal('B', 200, 0), portal('C', 100, 180)];
  const res = O.optimize({ portals: ps, position: at(0, 0), timeBudgetMs: 200 });
  assert.equal(res.inRadius, 3);
  assert.equal(res.candidates, 3);
});
