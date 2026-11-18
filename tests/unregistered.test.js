'use strict';
// Chaves sem portal no app (v1.11.0): nomes do inventário do dono, posições inventadas em volta da base genérica.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const M = require('../matching.js');
const { at } = require('./helpers.js');

const o0 = Object.assign(at(0, 0), { precisao: 10 });
const oN = Object.assign(at(0, 2500), { precisao: 10 });   // 2,5 km ao norte
const oE = Object.assign(at(2400, 800), { precisao: 10 });  // ~2,5 km a leste
const kmRound = (d) => d < 1000 ? Math.round(d * 10) / 10 : Math.round(d / 100) * 100; // como o jogo mostra
const obsAt = (nome, real, origem, chaves, nivel, ts) => ({ nome, endereco: null, distancia_m: kmRound(G.haversine(origem, real)), chaves, nivel, origem, ts: ts || 1 });

// portais do app: um provisório, um já com nome real
const portals = [
  Object.assign({ id: 'bk1', nome: 'BK 001 - R. Zeta', nivel: 1, chaves: 0, observacao: 'ESTIMADO do print do intel, NÃO CONFIRMADO.' }, at(300, 0)),
  Object.assign({ id: 'cv', nome: 'Cata-vento - Av. Beira', nivel: 7, chaves: 1, observacao: 'confirmado' }, at(-200, 150))
];

const guapituba = at(1500, 3800); // ponto real (inventado) do "Parque Guapituba"

test('1 observação: aparece em unregistered, com o anel e sem posição estimada', () => {
  const r = M.matchKeyList([obsAt('Igreja Mundial', at(-3000, 9000), o0, 1, 1)], portals);
  const u = r.unregistered.find(x => x.nome === 'Igreja Mundial');
  assert.ok(u, JSON.stringify(r.unregistered));
  assert.equal(u.estimate, undefined);
  assert.equal(u.rings.length, 1);
  assert.equal(u.rings[0].lat, o0.lat);
  assert.ok(u.rings[0].raio_m > 9000 && u.rings[0].tol_m >= 100, JSON.stringify(u.rings[0]));
  assert.equal(u.chaves, 1); assert.equal(u.nivel, 1);
});

test('3 observações de origens a ≥ 2 km entre si: posição estimada a < 150 m do ponto real', () => {
  const obs = [obsAt('Parque Guapituba', guapituba, o0, 3, 1, 1), obsAt('Parque Guapituba', guapituba, oN, 3, 1, 2), obsAt('Parque Guapituba', guapituba, oE, 3, 1, 3)];
  for (const a of [o0, oN, oE]) for (const b of [o0, oN, oE]) if (a !== b) assert.ok(G.haversine(a, b) >= 2000);
  const r = M.matchKeyList(obs, portals);
  const u = r.unregistered.find(x => x.nome === 'Parque Guapituba');
  assert.ok(u && u.estimate, JSON.stringify(u));
  const err = G.haversine(u.estimate, guapituba);
  assert.ok(err < 150, err + ' m');
  assert.ok(u.estimate.expectedError <= M.UNREG_MAX_ERR_M);
  assert.equal(u.chaves, 3); assert.equal(u.nivel, 1); assert.equal(u.origins, 3);
});

test('3 observações do mesmo lugar (origens a poucos metros): sem posição estimada', () => {
  const near = [o0, Object.assign(at(5, 0), { precisao: 10 }), Object.assign(at(0, 5), { precisao: 10 })];
  const r = M.matchKeyList(near.map((o, i) => obsAt('Joker', at(4000, 4000), o, 1, 1, i)), portals);
  const u = r.unregistered.find(x => x.nome === 'Joker');
  assert.ok(u && !u.estimate);
});

test('nome que casa com portal cadastrado não aparece em unregistered (mesmo com a posição do app errada)', () => {
  // "Cata-vento" existe no app, mas o anel do print não passa por ele: não vira portal potencial (seria duplicata)
  const r = M.matchKeyList([obsAt('Cata-vento', at(6000, -6000), o0, 1, 7)], portals);
  assert.ok(!r.unregistered.some(x => M.normName(x.nome) === M.normName('Cata-vento')));
});

test('pedaço do nome de um portal cadastrado não vira portal potencial', () => {
  const r = M.matchKeyList([obsAt('Cata-ve', at(6000, -6000), o0, 1, 7)], portals);
  assert.ok(!r.unregistered.some(x => x.nome === 'Cata-ve'));
});

test('nomes que hoje vão para far também aparecem em unregistered', () => {
  const obs = [obsAt('Igreja Mundial', at(0, 438000), o0, 1, 1), obsAt('Joker', at(29000, 0), o0, 1, 1)];
  const r = M.matchKeyList(obs, portals);
  assert.deepEqual(r.far.map(f => f.nome).sort(), ['Igreja Mundial', 'Joker']);
  for (const f of r.far) assert.ok(r.unregistered.some(u => u.key === f.key && u.far), f.nome);
});

test('nome com candidato provisório no anel fica em Pendentes (renomear), não em unregistered', () => {
  const r = M.matchKeyList([obsAt('Grafite Novo', portals[0], o0, 1, 1)], portals);
  assert.ok(r.suggestions.some(s => s.portal === 'bk1') || r.pending.some(p => p.candidates.includes('bk1')));
  assert.ok(!r.unregistered.some(u => u.nome === 'Grafite Novo'));
});

test('nome que é começo de outro da lista fica marcado como cortado (cutOf)', () => {
  const obs = [obsAt('Parque Guapit', at(0, 300000), o0, 3, 1), obsAt('Parque Guapituba', at(0, 300400), o0, 3, 1)];
  const r = M.matchKeyList(obs, portals);
  const cut = r.unregistered.find(u => u.nome === 'Parque Guapit');
  assert.equal(cut.cutOf, 'Parque Guapituba');
  assert.equal(r.unregistered.find(u => u.nome === 'Parque Guapituba').cutOf, undefined);
});

test('inventário do dono: 4 nomes, cada um com chaves e nível do print', () => {
  const obs = [
    obsAt('Parque Guapituba', guapituba, o0, 3, 1, 1), obsAt('Parque Guapituba', guapituba, oN, 3, 1, 2), obsAt('Parque Guapituba', guapituba, oE, 3, 1, 3),
    obsAt('Igreja Mundial', at(-2000, 7000), o0, 1, 1), obsAt('Joker', at(5000, 1000), o0, 1, 1),
    obsAt('Cata-vento', at(-200, 150), o0, 1, 7) // já cadastrado: "Já cadastrados"
  ];
  const r = M.matchKeyList(obs, portals);
  assert.deepEqual(r.unregistered.map(u => [u.nome, u.chaves, u.nivel, !!u.estimate]),
    [['Parque Guapituba', 3, 1, true], ['Igreja Mundial', 1, 1, false], ['Joker', 1, 1, false]]);
  assert.ok(r.registered.some(x => x.portal === 'cv'));
});

test('trilateração padrão (sem opts.all) continua ignorando anéis de 1 km ou mais', () => {
  const obs = [o0, oN, oE].map((o, i) => obsAt('X', guapituba, o, 1, 1, i));
  assert.equal(M.trilaterate(obs), null);
  assert.ok(M.trilaterate(obs, { all: true }));
});

// ---- bordas (scalpel, v1.11.0) ----
const tres = (nome, real, origens, extra) => origens.map((o, i) => Object.assign(obsAt(nome, real, o, 1, 1, i + 1), extra || {}));
const uOf = (r, nome) => r.unregistered.find(x => x.nome === nome);

test('3 origens alinhadas (triângulo sem área): sem posição estimada, mas continua em unregistered', () => {
  const linha = [o0, oN, Object.assign(at(0, 5000), { precisao: 10 })];
  const u = uOf(M.matchKeyList(tres('Alinhado', guapituba, linha), portals), 'Alinhado');
  assert.ok(u);
  assert.equal(u.estimate, undefined);
  assert.equal(u.origins, 3);
});

test('3 origens, uma observação com distância 1500 m errada (resíduo alto): sem posição estimada', () => {
  const obs = tres('Incoerente', guapituba, [o0, oN, oE]);
  obs[2].distancia_m += 1500;
  assert.equal(uOf(M.matchKeyList(obs, portals), 'Incoerente').estimate, undefined);
});

test('estimativa aceita com uma observação 300 m errada: o erro mostrado cobre o erro real', { todo: 'defeito: expectedError (matching.js:522) vem só da geometria e ignora o resíduo; com +300 m numa observação o app mostra "erro ~83 m" e o erro real é ~284 m' }, () => {
  const obs = tres('Torta', guapituba, [o0, oN, oE]);
  obs[2].distancia_m += 300;
  const u = uOf(M.matchKeyList(obs, portals), 'Torta');
  if (!u.estimate) return; // rejeitar também é honesto
  const err = G.haversine(u.estimate, guapituba);
  assert.ok(err <= u.estimate.expectedError, 'erro real ' + Math.round(err) + ' m > mostrado ' + u.estimate.expectedError + ' m');
});

test('3 observações acima de 10 km (arredondamento de 500 m): sem posição estimada', () => {
  const longe = at(1500, 15000);
  const origens = [o0, Object.assign(at(5000, 0), { precisao: 10 }), Object.assign(at(2500, 4300), { precisao: 10 })];
  const r = M.matchKeyList(tres('Muito Longe', longe, origens), portals);
  assert.ok(r.unregistered.some(u => u.nome === 'Muito Longe' && u.far));
  assert.equal(uOf(r, 'Muito Longe').estimate, undefined);
});

test('anéis acima de 10 km guardam a tolerância do arredondamento (>= 500 m)', () => {
  const u = uOf(M.matchKeyList(tres('Anel Grande', at(0, 12000), [o0]), portals), 'Anel Grande');
  assert.ok(u.rings[0].tol_m >= 500, JSON.stringify(u.rings[0]));
});

test('notRegistered: rua do print não bate com o provisório do anel -> fica em Pendentes e também em unregistered', () => {
  const r = M.matchKeyList([Object.assign(obsAt('Padaria Nova', portals[0], o0, 1, 1), { endereco: 'R. Outra, 10' })], portals);
  const p = r.pending.find(x => x.nome === 'Padaria Nova');
  assert.ok(p && p.notRegistered && p.candidates.length === 0, JSON.stringify(p));
  assert.ok(uOf(r, 'Padaria Nova'));
});

test('rua do print bate com o provisório do anel: é renomeação, não entra em unregistered', () => {
  const r = M.matchKeyList([Object.assign(obsAt('Padaria Nova', portals[0], o0, 1, 1), { endereco: 'R. Zeta, 10' })], portals);
  assert.ok(r.suggestions.some(s => s.portal === 'bk1'));
  assert.equal(uOf(r, 'Padaria Nova'), undefined);
});

test('cutOf com 3 níveis: cada pedaço aponta para um nome mais longo e o inteiro não tem cutOf', () => {
  const obs = [obsAt('Par', at(0, 300000), o0, 1, 1), obsAt('Parque Gua', at(0, 300400), o0, 1, 1), obsAt('Parque Guapituba', at(0, 300800), o0, 1, 1)];
  const r = M.matchKeyList(obs, portals);
  assert.equal(uOf(r, 'Parque Guapituba').cutOf, undefined);
  assert.equal(uOf(r, 'Parque Gua').cutOf, 'Parque Guapituba');
  assert.ok(['Parque Gua', 'Parque Guapituba'].includes(uOf(r, 'Par').cutOf));
});

test('cutOf com 3 níveis: o pedaço mais curto aponta para o nome inteiro, não para o intermediário', { todo: 'matching.js:726 pega o primeiro mais longo na ordem da lista: "Par" aponta para "Parque Gua" (também cortado) e não para "Parque Guapituba"' }, () => {
  const obs = [obsAt('Par', at(0, 300000), o0, 1, 1), obsAt('Parque Gua', at(0, 300400), o0, 1, 1), obsAt('Parque Guapituba', at(0, 300800), o0, 1, 1)];
  assert.equal(uOf(M.matchKeyList(obs, portals), 'Par').cutOf, 'Parque Guapituba');
});

test('nome provisório lido do print, sem portal no app: não vira portal potencial', { todo: 'a confirmar com o dono: "BK 009 - R. Foo" (nome gerado pelo app, não do jogo) sem portal igual entra em unregistered e pode ser cadastrado com nome provisório (matching.js:703 só compara com portais existentes)' }, () => {
  const r = M.matchKeyList([obsAt('BK 009 - R. Foo', at(900, 900), o0, 1, 1)], portals);
  assert.equal(uOf(r, 'BK 009 - R. Foo'), undefined);
});

test('nome provisório lido do print que já existe no app (mesmo longe do anel): nunca em unregistered', () => {
  const r = M.matchKeyList([obsAt('BK 001 - R. Zeta', at(-5000, 900), o0, 1, 1)], portals);
  assert.equal(r.unregistered.length, 0);
  const r2 = M.matchKeyList([obsAt('BK 001', at(300, 0), o0, 1, 1)], portals);
  assert.equal(r2.unregistered.length, 0);
});
