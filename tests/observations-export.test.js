'use strict';
// v1.11.2: observações de listas de chaves no export/import do JSON, para juntar as leituras de dois aparelhos.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const M = require('../matching.js');
const FP = require('../plan.js');
const { at } = require('./helpers.js');

const db = { portals: [], blockers: [], done: [], excluded: [], coveredManual: [], settings: {}, plan: null };
const real = at(1500, 3800);
const kmRound = (d) => d < 1000 ? Math.round(d * 10) / 10 : Math.round(d / 100) * 100;
const ob = (e, n, ts, extra) => {
  const origem = Object.assign(at(e, n), { precisao: 10 });
  return Object.assign({ nome: 'Parque Guapituba', endereco: null, distancia_m: kmRound(G.haversine(origem, real)), nivel: 1, chaves: 3, origem, ts }, extra || {});
};

test('export sem escolha do usuário não leva observações (lista fechada de sempre)', () => {
  assert.equal(FP.exportPayload(db).observacoes, undefined);
  assert.equal(FP.exportPayload(db, 1, { observacoes: [] }).observacoes, undefined);
});

test('export com observações leva só os campos de uma observação', () => {
  const out = FP.exportPayload(db, 1, { observacoes: [ob(0, 0, 5, { foto: 'data:image/jpeg;base64,AAAA', apiKey: 'sk-ant-x' })] });
  assert.equal(out.observacoes.length, 1);
  assert.deepEqual(Object.keys(out.observacoes[0]).sort(), ['chaves', 'distancia_m', 'endereco', 'nivel', 'nome', 'origem', 'ts']);
  assert.deepEqual(Object.keys(out.observacoes[0].origem).sort(), ['lat', 'lng', 'precisao']);
  assert.ok(!JSON.stringify(out).includes('base64') && !JSON.stringify(out).includes('sk-ant'));
});

test('sanitizeObservation: recusa sem nome, sem origem, distância inválida, coordenada fora da faixa; limita campos', () => {
  assert.equal(M.sanitizeObservation(null), null);
  assert.equal(M.sanitizeObservation({ nome: '', distancia_m: 10, origem: at(0, 0) }), null);
  assert.equal(M.sanitizeObservation({ nome: 'X', distancia_m: -1, origem: at(0, 0) }), null);
  assert.equal(M.sanitizeObservation({ nome: 'X', distancia_m: 'abc', origem: at(0, 0) }), null);
  assert.equal(M.sanitizeObservation({ nome: 'X', distancia_m: 10 }), null);
  assert.equal(M.sanitizeObservation({ nome: 'X', distancia_m: 10, origem: { lat: 95, lng: 0 } }), null);
  const o = M.sanitizeObservation({ nome: '  ' + 'N'.repeat(200), distancia_m: '120.5', nivel: 12, chaves: -3, origem: Object.assign(at(0, 0), { precisao: 'x' }), ts: 'y', dono: 'agente' });
  assert.equal(o.nome.length, 80);
  assert.equal(o.distancia_m, 120.5);
  assert.equal(o.nivel, 8); assert.equal(o.chaves, 0);
  assert.equal(o.origem.precisao, 0); assert.equal(o.ts, 0);
  assert.equal(o.dono, undefined);
  assert.equal(M.sanitizeObservation({ nome: 'X', distancia_m: 10, nivel: null, chaves: '', origem: at(0, 0) }).nivel, null);
});

test('mergeObservations: junta sem repetir, conta inválidas e guarda as mais recentes até o limite', () => {
  const mine = [ob(0, 0, 1)];
  const r = M.mergeObservations(mine, [ob(0, 0, 9), ob(0, 2500, 2), { nome: 'lixo' }]);
  assert.equal(r.added, 1); assert.equal(r.invalid, 1); assert.equal(r.list.length, 2);
  assert.equal(mine.length, 1, 'não altera a lista original');
  const many = Array.from({ length: 10 }, (_, i) => ob(i * 100, 0, i + 10));
  const capped = M.mergeObservations([ob(5000, 0, 1)], many, 5);
  assert.equal(capped.list.length, 5);
  assert.deepEqual(capped.list.map(o => o.ts), [15, 16, 17, 18, 19]);
});

test('o objetivo: 2 leituras no computador + 1 no celular, juntas, dão a posição estimada', () => {
  const pc = [ob(0, 0, 1), ob(0, 2500, 2)], phone = [ob(2400, 800, 3)];
  assert.equal(M.matchKeyList(pc, []).unregistered[0].estimate, undefined, 'sozinho, o computador não estima');
  // o celular exporta, o computador importa
  const file = JSON.parse(JSON.stringify(FP.exportPayload(db, 1, { observacoes: phone })));
  const merged = M.mergeObservations(pc, file.observacoes).list;
  const u = M.matchKeyList(merged, []).unregistered.find(x => x.nome === 'Parque Guapituba');
  assert.ok(u && u.estimate, JSON.stringify(u));
  assert.equal(u.origins, 3);
  assert.ok(G.haversine(u.estimate, real) <= u.estimate.expectedError);
});

test('mergeObservations: hora no futuro vira agora; muitas observações terminam rápido', () => {
  const r = M.mergeObservations([], [ob(0, 0, 9e15)], 2000, 1000);
  assert.equal(r.list[0].ts, 1000);
  const many = Array.from({ length: 30000 }, (_, i) => Object.assign(ob(i % 50 * 40, 0, i + 1), { nome: 'Portal ' + (i % 3000) + ' Nome' }));
  const t0 = Date.now();
  const big = M.mergeObservations([], many, 2000);
  assert.ok(Date.now() - t0 < 3000, (Date.now() - t0) + ' ms');
  assert.equal(big.list.length, 2000);
  assert.ok(big.added <= 2000);
});
