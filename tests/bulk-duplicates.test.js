'use strict';
// Regra de duplicata da importação por lista de links (v1.11.1): a mesma de todos os cadastros.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../matching.js');
const { at } = require('./helpers.js');

const portals = [
  Object.assign({ id: 'cv', nome: 'Cata-vento - Av. Beira', nivel: 7, chaves: 1, observacao: '' }, at(0, 0)),
  Object.assign({ id: 'p07', nome: 'Portal 07', nivel: 1, chaves: 0, observacao: '' }, at(5000, 0))
];
let n = 0;
const row = (nome, e, no, extra) => Object.assign({ nome, linha: ++n }, at(e, no), extra || {});
const types = (w) => (w || []).map(x => x.type).sort();

test('nome igual ao de um portal do app (em outro lugar): nameApp', () => {
  const w = M.bulkDuplicates([row('Cata-vento', 3000, 3000)], portals);
  assert.deepEqual(types(w[0]), ['nameApp']);
  assert.equal(w[0][0].portal.id, 'cv');
});

test('mesmo nome de uma linha anterior: nameRow aponta a linha', () => {
  const a = row('Torre Nova', 2000, 0), b = row('Torre Nova', 4000, 0);
  const w = M.bulkDuplicates([a, b], portals);
  assert.equal(w[0], null);
  assert.deepEqual(w[1], [{ type: 'nameRow', linha: a.linha }]);
});

test('"Portal NN" (automático ou digitado, mesmo igual a um do app) não conta como nome repetido', () => {
  const w = M.bulkDuplicates([row('Portal 07', 9000, 0), row('Portal 08', 9000, 2000), row('Portal 08', 9000, 4000), row('', 9000, 6000)], portals);
  assert.deepEqual(w, [null, null, null, null]);
});

test('portal do app a menos de 30 m: nearApp; a 35 m: nada', () => {
  const w = M.bulkDuplicates([row('', 20, 0)], portals);
  assert.deepEqual(types(w[0]), ['nearApp']);
  assert.ok(w[0][0].d > 19 && w[0][0].d < 21);
  assert.deepEqual(M.bulkDuplicates([row('', 35, 0)], portals), [null]);
});

test('linha anterior a menos de 30 m: nearRow; linhas sem nome também', () => {
  const a = row('', 2000, 2000), b = row('', 2020, 2000);
  const w = M.bulkDuplicates([a, b], portals);
  assert.equal(w[0], null);
  assert.equal(w[1][0].type, 'nearRow');
  assert.equal(w[1][0].linha, a.linha);
});

test('linha já marcada como o mesmo portal (dup, < 10 m) não recebe aviso de distância, mas o nome conta', () => {
  const w = M.bulkDuplicates([row('Cata-vento', 3, 0, { dup: 'já cadastrado' })], portals);
  assert.deepEqual(types(w[0]), ['nameApp']);
});

test('consider: linhas desmarcadas não entram nem servem de referência', () => {
  const a = row('Torre Azul', 2000, 0, { use: false }), b = row('Torre Azul', 4000, 0, { use: true });
  const w = M.bulkDuplicates([a, b], portals, r => r.use);
  assert.deepEqual(w, [null, null]);
});

test('linhas com erro são ignoradas; lista vazia ou nula não quebra', () => {
  assert.deepEqual(M.bulkDuplicates([{ erro: 'sem coordenadas', linha: 1 }], portals), [null]);
  assert.deepEqual(M.bulkDuplicates([], portals), []);
  assert.deepEqual(M.bulkDuplicates(null, portals), []);
});

test('nome e distância juntos na mesma linha', () => {
  const w = M.bulkDuplicates([row('Cata-vento', 15, 0)], portals);
  assert.deepEqual(types(w[0]), ['nameApp', 'nearApp']);
});
