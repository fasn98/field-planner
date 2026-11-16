'use strict';
// Cenário sintético com a mesma estrutura do teste real de 16/11 (que fica só no computador do dono, porque tem a
// posição de onde os prints foram tirados): nomes e lugares inventados em volta de uma base genérica.
// - portais já nomeados à mão, com sufixo de rua e posição estimada, que o print escreve um pouco diferente;
// - um nome novo com dois provisórios no anel;
// - nomes sem portal no app, perto e a ≥ 1 km;
// - a mesma linha em dois prints.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const M = require('../matching.js');
const R = require('../printread.js');
const { at } = require('./helpers.js');

const EST = 'ESTIMADO do print do intel, NÃO CONFIRMADO.';
const origem = Object.assign(at(0, 0), { precisao: 10 });
let n = 0;
const P = (nome, e, no, extra) => Object.assign({ id: 'x' + (++n), nome, nivel: 1, chaves: 0, observacao: EST }, at(e, no), extra || {});
const portals = [
  P('Escultura Aurora - R. Alfa', 182, 0),
  P('Vila de Azulejos - R. Beta', 0, 271),
  P('Estátua Cometa Dourado - Av. Gama', -500, 600),
  P('Fonte Três Corujas - Av. Delta', 0, -1025),
  P('Metas no Céu- Viaduto Épsilon', 1130, 0),
  P('BK 001 - R. Zeta', 0, -597),
  P('BK 002 - R. Zeta', -560, -200),
  P('BK 003 - Av. Eta', 600, 603),
  P('BK 004 - R. Teta', -300, -300),
  // no anel de "Papagaio Festivo" (852,7 m, Av. Eta): o BK 003 fica na Av. Eta; estes dois, em outras ruas
  P('CB 026 - R. Iota', -852, 30),
  P('BW 078 - R. Kapa', 30, 855),
  // no anel de "Leão de Pedra" (Av. Lambda, 420 m) só há provisórios de outras ruas
  P('BK 005 - R. Mi', 420, 0), P('BK 006 - R. Ni', -415, 40),
  // provisório sem rua no nome: a rua do print não pode descartá-lo
  P('Portal 07', 0, 640)
];
const id = (nome) => portals.find(p => p.nome === nome).id;

// distâncias como o jogo mostra (até 1 km com decimal; acima, arredondado)
const d = (nome, extra) => { const p = portals.find(q => q.nome === nome); return Math.round(G.haversine(origem, p) * 10) / 10 + (extra || 0); };
const L = (nome, endereco, distancia_m, nivel, chaves) => ({ nome, x: null, y: null, endereco, distancia_m, nivel, chaves });
const leituras = [
  { tipo: 'lista_chaves', escala_m_por_px: null, norte_para_cima: null, portais: [
    L('Escultura da Aurora', 'R. Alfa, 10 - Centro', d('Escultura Aurora - R. Alfa', 8), 6, 1),
    L('Vila da Azulejos', 'R. Beta, 20 - Centro', d('Vila de Azulejos - R. Beta', 5), 4, 1),
    L('Grafite Sol Nascente', 'R. Zeta, 300 - Centro', 575.2, 5, 1),
    L('Vila da Azulejos', 'R. Beta, 20 - Centro', null, 4, 1)] },
  { tipo: 'lista_chaves', escala_m_por_px: null, norte_para_cima: null, portais: [
    L('Estatua Do Cometa Dourrado', 'Av. Gama, 300', d('Estátua Cometa Dourado - Av. Gama', -6), 6, 2),
    L('Papagaio Festivo', 'Av. Eta, 3214', 852.7, 7, 1),
    L('Fonte Três Corujas', 'Av. Delta, 2954', 1000, 5, 2),
    L('Metas no céu', 'Av. Épsilon, 588', 1100, 4, 1)] },
  { tipo: 'lista_chaves', escala_m_por_px: null, norte_para_cima: null, portais: [
    L('Metas no céu', 'Av. Épsilon, 588', 1100, 4, 1),
    L('Coruja Tropical', 'Av. Épsilon, 2893', 1100, 1, 1),
    L('Girafa Azul', 'R. Kapa, 124', 1800, 1, 1),
    L('Leão de Pedra', 'Av. Lambda, 77 - Centro', 420, 5, 1),
    L('Coruja Branca', 'Av. Lambda, 900', 640, 4, 1),
    L('Fonte do Shopping', 'Shopping Ômega, Av. Lambda, 10', 420, 4, 1)] }
];

const obs = [];
for (const raw of leituras) {
  const v = R.validateReading(raw);
  assert.equal(v.ok, true, v.error);
  for (const p of v.value.portais) {
    if (p.distancia_m == null) continue;
    const o = { nome: p.nome, endereco: p.endereco, distancia_m: p.distancia_m, nivel: p.nivel, chaves: p.chaves, origem, ts: 1 };
    if (!obs.some(x => M.isDuplicateObs(x, o))) obs.push(o);
  }
}
const r = M.matchKeyList(obs, portals);
const key = M.normName;

test('cenário: linha repetida entre prints conta uma vez só', () => {
  assert.equal(obs.filter(o => key(o.nome) === key('Metas no céu')).length, 1);
  assert.equal(obs.length, 12);
});

test('cenário: portais já nomeados ficam "já cadastrado" (acento, artigo, erro de digitação, sufixo de rua, ≥ 1 km)', () => {
  const expected = {
    'Escultura da Aurora': 'Escultura Aurora - R. Alfa', 'Vila da Azulejos': 'Vila de Azulejos - R. Beta',
    'Estatua Do Cometa Dourrado': 'Estátua Cometa Dourado - Av. Gama', 'Fonte Três Corujas': 'Fonte Três Corujas - Av. Delta',
    'Metas no céu': 'Metas no Céu- Viaduto Épsilon'
  };
  for (const [nome, portal] of Object.entries(expected)) {
    const reg = r.registered.find(x => x.key === key(nome));
    assert.ok(reg, nome + ' deveria estar em "já cadastrado"');
    assert.equal(reg.portal, id(portal), nome);
    assert.ok(!r.suggestions.some(s => s.key === key(nome)) && !r.pending.some(s => s.key === key(nome)), nome);
  }
});

test('cenário: nome novo com dois provisórios no anel tem o certo entre os candidatos', () => {
  const k = key('Grafite Sol Nascente');
  const ids = [...r.suggestions.filter(s => s.key === k).map(s => s.portal), ...r.pending.filter(p => p.key === k).flatMap(p => p.candidates)];
  assert.ok(ids.includes(id('BK 001 - R. Zeta')), ids.join(', '));
});

test('cenário: nomes sem portal no app nunca viram renomear com confiança ≥ 50%', () => {
  for (const nome of ['Papagaio Festivo', 'Coruja Tropical', 'Girafa Azul']) {
    const s = r.suggestions.find(x => x.key === key(nome));
    assert.ok(!s || s.confidence < 0.5, nome + ' com ' + (s && s.confidence));
  }
  const far = r.pending.find(p => p.key === key('Girafa Azul'));
  assert.match(far.hint, /km .*não decide/);
});

test('cenário: nenhuma sugestão aceitável deixa dois portais com o mesmo nome', () => {
  const after = new Map(portals.map(p => [p.id, p.nome]));
  for (const s of r.suggestions) if (!s.nameTakenBy) after.set(s.portal, s.nome);
  const ks = [...after.values()].map(M.normName);
  assert.deepEqual(ks.filter((k, i) => ks.indexOf(k) !== i), []);
});

test('cenário: rua do print desempata o anel (Papagaio Festivo fica só com o BK 003 da Av. Eta)', () => {
  const k = key('Papagaio Festivo');
  const ids = [...r.suggestions.filter(s => s.key === k).map(s => s.portal), ...r.pending.filter(p => p.key === k).flatMap(p => p.candidates)];
  assert.deepEqual(ids, [id('BK 003 - Av. Eta')]);
});

test('cenário: nenhum candidato do anel na rua do print → "provavelmente não cadastrado", sem "É este"', () => {
  const pd = r.pending.find(p => p.key === key('Leão de Pedra'));
  assert.ok(pd && pd.notRegistered, JSON.stringify(pd));
  assert.deepEqual(pd.candidates, []);
  // BK 004 (R. Teta, a 424 m) também cai no anel; todos de outras ruas
  assert.deepEqual(pd.otherStreet.sort(), [id('BK 004 - R. Teta'), id('BK 005 - R. Mi'), id('BK 006 - R. Ni')].sort());
  assert.match(pd.hint, /provavelmente não cadastrado.*Av\. Lambda.*link do portal/);
  assert.ok(!r.suggestions.some(s => s.key === key('Leão de Pedra')));
});

test('cenário: endereço que não começa por rua ("Shopping …") não descarta candidatos', () => {
  const pd = r.pending.find(p => p.key === key('Fonte do Shopping'));
  assert.ok(pd && !pd.notRegistered, JSON.stringify(pd));
  assert.ok(pd.candidates.includes(id('BK 005 - R. Mi')));
  assert.equal(M.addressHasStreet('Shopping Morumbi, Av. Roque Petroni Jr'), false);
  assert.equal(M.addressHasStreet('Brooklin, São Paulo'), false);
  assert.equal(M.addressHasStreet('Avenida Santo Amaro, 3214 - Br..'), true);
  assert.equal(M.addressHasStreet('R. Nova York, 245'), true);
});

test('cenário: candidato sem rua no nome não é descartado pela rua do print', () => {
  const k = key('Coruja Branca');
  const pd = r.pending.find(p => p.key === k), s = r.suggestions.find(x => x.key === k);
  const ids = s ? [s.portal] : pd.candidates;
  assert.ok(ids.includes(id('Portal 07')), JSON.stringify(pd || s));
  assert.ok(!(pd && pd.notRegistered));
  assert.equal(M.portalStreetKnown({ nome: 'Portal 07' }), false);
  assert.equal(M.portalStreetKnown({ nome: 'CB 026 - R. Nova York' }), true);
  assert.equal(M.portalStreetKnown({ nome: 'Metas em Mente- Viaduto Santo Amaro' }), true);
  assert.equal(M.portalStreetKnown({ nome: 'Portal 07', observacao: 'perto da rua de trás' }), false);
  assert.equal(M.portalStreetKnown({ nome: 'Portal 07', observacao: 'Rua: Alameda dos Anapurus' }), true);
});

test('cenário: dois portais diferentes com nome parecido na mesma lista não viram um grupo só', () => {
  const g = M.matchKeyList([{ nome: 'Mural 1', distancia_m: 120, origem, ts: 1 }, { nome: 'Mural 2', distancia_m: 300, origem, ts: 1 }], portals);
  assert.deepEqual([...g.pending, ...g.suggestions, ...g.registered].map(x => x.key).sort(), ['mural 1', 'mural 2']);
});

test('nome cortado: a mesma linha lida inteira no mesmo ponto vira o nome inteiro', () => {
  const full = d('Escultura Aurora - R. Alfa', 8);
  const o = [
    { nome: 'Escultura da Aurora', endereco: 'R. Alfa, 10', distancia_m: full, origem, ts: 1 },
    { nome: 'Escultura d', endereco: null, distancia_m: full, origem, ts: 2 },
    // mesmo prefixo, distância diferente: outro portal, não junta
    { nome: 'Escultura', distancia_m: 300, origem, ts: 3 }
  ];
  const m = M.mergeTruncated(o);
  assert.deepEqual(m.map(x => x.nome), ['Escultura da Aurora', 'Escultura']);
  const g = M.matchKeyList(o, portals);
  assert.ok(g.registered.some(x => x.portal === id('Escultura Aurora - R. Alfa')));
  assert.ok(![...g.pending, ...g.suggestions].some(x => x.key === key('Escultura d')));
});

test('nome cortado acima de 1 km (distância arredondada) não junta: podem ser portais diferentes', () => {
  const o = [{ nome: 'Mural', distancia_m: 1100, origem, ts: 1 }, { nome: 'Mural Natural', distancia_m: 1100, origem, ts: 1 }];
  assert.equal(M.mergeTruncated(o).length, 2);
});

test('nome cortado de outro ponto (origem a mais de 5 m) não junta', () => {
  const o = [{ nome: 'Escultura d', distancia_m: 200, origem, ts: 1 },
    { nome: 'Escultura da Aurora', distancia_m: 200, origem: Object.assign(at(50, 0), { precisao: 10 }), ts: 2 }];
  assert.equal(M.mergeTruncated(o).length, 2);
});

test('chaves a mais de 5 km ficam fora dos pendentes, no grupo "longe"; já cadastrado longe continua reconhecido', () => {
  const longe = Object.assign({ id: 'longe1', nome: 'Pier do Mar - Av. Litoral', nivel: 1, chaves: 0, observacao: 'confirmado' }, at(0, 80000));
  const o = [
    { nome: 'Praça Distante', distancia_m: 438000, origem, ts: 1 },
    { nome: 'Pizzaria Longe', distancia_m: 29300, origem, ts: 1 },
    { nome: 'Pier do Mar', distancia_m: Math.round(G.haversine(origem, longe)), origem, ts: 1 },
    { nome: 'Grafite Sol Nascente', distancia_m: 575.2, origem, ts: 1 }
  ];
  const g = M.matchKeyList(o, portals.concat([longe]));
  assert.deepEqual(g.far.map(f => f.nome), ['Pizzaria Longe', 'Praça Distante']);
  assert.ok(!g.pending.some(p => /Distante|Longe/.test(p.nome)));
  assert.ok(g.registered.some(r => r.portal === 'longe1'));
  assert.ok(g.pending.some(p => p.key === key('Grafite Sol Nascente')) || g.suggestions.some(s => s.key === key('Grafite Sol Nascente')));
});

// ---- bordas de nome cortado e do grupo "longe" (v1.10.2) ----
test('borda: pedaço com menos de 3 letras não junta com nome inteiro, mesmo no mesmo ponto e distância', () => {
  const o = [{ nome: 'Es', distancia_m: 200, origem, ts: 1 }, { nome: 'Escultura da Aurora', distancia_m: 200, origem, ts: 2 }];
  assert.deepEqual(M.mergeTruncated(o).map(x => x.nome), ['Es', 'Escultura da Aurora']);
});

test('borda: pedaço com exatamente 3 letras junta', () => {
  const o = [{ nome: 'Esc', distancia_m: 200, origem, ts: 1 }, { nome: 'Escultura da Aurora', distancia_m: 200, origem, ts: 2 }];
  assert.deepEqual(M.mergeTruncated(o).map(x => x.nome), ['Escultura da Aurora']);
});

test('borda: dois nomes inteiros com o mesmo prefixo — o pedaço vira o mais longo e os inteiros continuam separados', () => {
  const o = [
    { nome: 'Ninhos Dourados', distancia_m: 150, origem, ts: 1 },
    { nome: 'Ninhos De Pássaro', distancia_m: 150, origem, ts: 2 },
    { nome: 'Ninhos D', distancia_m: 150, origem, ts: 3 }
  ];
  assert.deepEqual(M.mergeTruncated(o).map(x => x.nome).sort(), ['Ninhos De Pássaro', 'Ninhos Dourados']);
  // ordem inversa dá o mesmo resultado
  assert.deepEqual(M.mergeTruncated(o.slice().reverse()).map(x => x.nome).sort(), ['Ninhos De Pássaro', 'Ninhos Dourados']);
});

test('borda: nome inteiro idêntico ao pedaço (mesma linha duas vezes) vira uma observação só', () => {
  const o = [{ nome: 'Mural Azul', distancia_m: 90, origem, ts: 1 }, { nome: 'Mural Azul', distancia_m: 90, origem, ts: 2 }];
  assert.equal(M.mergeTruncated(o).length, 1);
});

test('borda: distância 0,05 m de diferença não junta; 0,04 m junta', () => {
  const mk = (dd) => [{ nome: 'Mural Az', distancia_m: 90, origem, ts: 1 }, { nome: 'Mural Azul', distancia_m: dd, origem, ts: 2 }];
  assert.equal(M.mergeTruncated(mk(90.04)).length, 1);
  assert.equal(M.mergeTruncated(mk(90.5)).length, 2);
});

test('borda: exatamente 5000 m não vai para "longe"; 5001 m vai', () => {
  const g = M.matchKeyList([
    { nome: 'Cidade Vizinha A', distancia_m: 5000, origem, ts: 1 },
    { nome: 'Cidade Vizinha B', distancia_m: 5001, origem, ts: 1 }
  ], portals);
  assert.deepEqual(g.far.map(f => f.nome), ['Cidade Vizinha B']);
  assert.ok(g.pending.some(p => p.key === key('Cidade Vizinha A')));
});

test('borda: nome com uma observação longe e outra perto não vai para "longe"', () => {
  const g = M.matchKeyList([
    { nome: 'Totem Misto', distancia_m: 30000, origem, ts: 1 },
    { nome: 'Totem Misto', distancia_m: 300, origem, ts: 2 }
  ], portals);
  assert.equal(g.far.length, 0);
  assert.ok([...g.pending, ...g.suggestions, ...g.registered].some(x => x.key === key('Totem Misto')));
});

test('borda: lista vazia e observação sem distância não quebram nem criam "longe"', () => {
  assert.deepEqual(M.matchKeyList([], portals).far, []);
  assert.deepEqual(M.mergeTruncated(null), []);
  const g = M.matchKeyList([{ nome: 'Sem Distância', origem, ts: 1 }], portals);
  assert.equal(g.far.length, 0);
});

test('borda: "longe" ordenado do mais perto ao mais distante e usa a menor distância do nome', () => {
  const g = M.matchKeyList([
    { nome: 'Longe B', distancia_m: 90000, origem, ts: 1 },
    { nome: 'Longe A', distancia_m: 20000, origem, ts: 1 },
    { nome: 'Longe A', distancia_m: 7000, origem: Object.assign(at(0, 50), { precisao: 10 }), ts: 2 }
  ], portals);
  assert.deepEqual(g.far.map(f => [f.nome, f.distancia_m]), [['Longe A', 7000], ['Longe B', 90000]]);
});
