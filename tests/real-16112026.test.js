'use strict';
// Caso real de 16/11/2026: 4 prints da lista de chaves (posição digitada, ±10 m) contra o arquivo de portais do
// Brooklin daquele dia. As leituras simulam a resposta da IA e passam pela
// mesma validação do app (printread.js) antes do casamento.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('../matching.js');
const R = require('../printread.js');

// Os arquivos ficam só no computador do dono (tests/fixtures-local/, fora do git): têm a posição de onde os prints
// foram tirados. Sem eles, estes testes são pulados; o cenário equivalente publicado está em keylist-scenario.test.js.
const dir = path.join(__dirname, 'fixtures-local');
const HAVE = fs.existsSync(path.join(dir, 'prints-16112026.json')) && fs.existsSync(path.join(dir, 'brooklin-16112026.json'));
const fx = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const portals = HAVE ? fx('brooklin-16112026.json').portals : [];
const prints = HAVE ? fx('prints-16112026.json') : { leituras: [], origem: null };
const SKIP = HAVE ? false : 'caso real só no computador do dono (tests/fixtures-local/)';

// mesma regra do app (applyReading): sem distância não vira observação; repetida (mesmo nome, origem < 5 m,
// mesma distância) não conta de novo — "Las Patitas" e "Metas em mente" aparecem em dois prints
function observationsFrom(leituras) {
  const out = [];
  for (const raw of leituras) {
    const v = R.validateReading(raw);
    assert.equal(v.ok, true, v.error);
    for (const p of v.value.portais) {
      if (p.distancia_m == null) continue;
      const o = { nome: p.nome, endereco: p.endereco, distancia_m: p.distancia_m, nivel: p.nivel, chaves: p.chaves, origem: prints.origem, ts: 1 };
      if (out.some(x => M.isDuplicateObs(x, o))) continue;
      out.push(o);
    }
  }
  return out;
}
const obs = HAVE ? observationsFrom(prints.leituras) : [];
const r = M.matchKeyList(obs, portals);
const byName = (n) => M.normName(n);

test('16/11: dois portais diferentes com nome parecido na mesma lista não viram um grupo só', { skip: SKIP }, () => {
  const o = prints.origem;
  const g = M.matchKeyList([
    { nome: 'Mural 1', distancia_m: 120, origem: o, ts: 1 }, { nome: 'Mural 2', distancia_m: 300, origem: o, ts: 1 }], portals);
  const keys = [...g.pending, ...g.suggestions, ...g.registered].map(x => x.key).sort();
  assert.deepEqual(keys, ['mural 1', 'mural 2']);
});

test('16/11: observações repetidas entre prints não contam duas vezes', { skip: SKIP }, () => {
  assert.equal(obs.filter(o => byName(o.nome) === byName('Metas em mente')).length, 1);
  // 20 linhas lidas: 2 sem distância (Las Patitas no 1º print, Mural Estrelado no 2º) e Metas em mente repetida
  assert.equal(obs.length, 17);
  assert.equal(obs.filter(o => byName(o.nome) === byName('Las Patitas')).length, 1);
});

test('16/11: portais já cadastrados com o nome real ficam "✓ já cadastrado", sem sugestão de renomear', { skip: SKIP }, () => {
  const expected = {
    'Retalhos De Metal': 'bk-067', 'Vila da Ladrilhos': 'bk-059', 'A menina das rosas': 'cb-035', 'Las Patitas': 'cb-052',
    'Livraria Nobel': 'cb-053', 'Estatua Da Liberdade Manhathan': 'cb-047', 'Mural Estrelado': 'cb-041',
    'Mural Casa Da Arte': 'cb-042', 'Fonte Dois Irmãos': 'cb-027', 'Metas em mente': 'cb-029'
  };
  for (const [nome, id] of Object.entries(expected)) {
    const reg = r.registered.find(x => x.key === byName(nome));
    assert.ok(reg, nome + ' deveria estar em "já cadastrado"');
    assert.equal(reg.portal, id, nome);
    assert.ok(!r.suggestions.some(s => s.key === byName(nome)), nome + ' não pode virar sugestão de renomear');
    assert.ok(!r.pending.some(s => s.key === byName(nome)), nome + ' não pode ficar pendente');
  }
});

test('16/11: Graffiti O Sol E As Rosas tem cb-039 entre os candidatos', { skip: SKIP }, () => {
  const k = byName('Graffiti O Sol E As Rosas');
  const ids = [...r.suggestions.filter(s => s.key === k).map(s => s.portal), ...r.pending.filter(p => p.key === k).flatMap(p => p.candidates)];
  assert.ok(ids.includes('cb-039'), 'candidatos: ' + ids.join(', '));
});

test('16/11: nomes sem portal cadastrado nunca viram renomear com confiança ≥ 50%', { skip: SKIP }, () => {
  for (const nome of ['Estatua Loro Mania', 'Coala Tropical', 'Playground do Fascination', 'Girafas no Safari', 'Grafite Mercedes-Benz', 'Mulheres do Salão']) {
    const s = r.suggestions.find(x => x.key === byName(nome));
    assert.ok(!s || s.confidence < 0.5, nome + ' sugerido com ' + (s && s.confidence));
  }
});

test('16/11: Estatua Loro Mania (Av. Santo Amaro) sem candidato na mesma rua → provavelmente não cadastrado', { skip: SKIP }, () => {
  const pd = r.pending.find(p => p.key === byName('Estatua Loro Mania'));
  assert.ok(pd && pd.notRegistered, JSON.stringify(pd));
  assert.deepEqual(pd.candidates, []);
  assert.deepEqual(pd.otherStreet.sort(), ['bw-078', 'cb-026']);
  assert.match(pd.hint, /provavelmente não cadastrado.*Avenida Santo Amaro/);
});

test('16/11: Graffiti O Sol E As Rosas continua com os candidatos da R. Guararapes', { skip: SKIP }, () => {
  const pd = r.pending.find(p => p.key === byName('Graffiti O Sol E As Rosas'));
  assert.ok(pd && !pd.notRegistered && pd.candidates.includes('cb-039'));
});

test('16/11: nenhuma sugestão aceitável deixa dois portais com o mesmo nome', { skip: SKIP }, () => {
  const after = new Map(portals.map(p => [p.id, p.nome]));
  for (const s of r.suggestions) if (!s.nameTakenBy) after.set(s.portal, s.nome);
  const keys = [...after.values()].map(M.nameKey).filter(Boolean);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dup, [], 'nomes repetidos: ' + dup.join(', '));
  // portais distintos em todas as sugestões
  const ps = r.suggestions.map(s => s.portal);
  assert.equal(new Set(ps).size, ps.length);
});

test('nomes: normalização e similaridade dos casos do teste real', () => {
  assert.ok(M.nameSimilarity('Estatua Da Liberdade Manhathan', 'Estátua Liberdade Manhattan - Av. Portugal') >= 0.85);
  assert.ok(M.nameSimilarity('Vila da Ladrilhos', 'Vila de Ladrilhos - R. Califórnia') >= 0.85);
  assert.ok(M.nameSimilarity('Metas em mente', 'Metas em Mente- Viaduto Santo Amaro') >= 0.85);
  assert.ok(M.nameSimilarity('Mural Estrelado', 'Mural Casa da Arte - Av. Portugal') < 0.85);
  assert.ok(M.nameSimilarity('Grafite Mercedes-Benz', 'Grafite Mercedes') < 0.85);
  // letra ou número solto diferente separa os nomes ("Bloco A"/"Bloco B", "Mural 1"/"Mural 2")
  assert.equal(M.nameSimilarity('Bloco A', 'Bloco B'), 0);
  assert.equal(M.nameSimilarity('Mural 1', 'Mural 2 - R. X'), 0);
  assert.ok(M.nameSimilarity('Mural 2', 'Mural 2 - R. X') >= 0.85);
  // nomes reais com sigla e número não são provisórios
  for (const n of ['UBS 2 Brooklin', 'CEU 3', 'EMEF 12 de Outubro']) assert.equal(M.isProvisional(n), false, n);
  for (const n of ['BK 070 - R. Arizona', 'cb-039', 'CB 039', 'GJ 3', 'ENS 05', 'Portal 07', 'Enseada 03 - R. 13']) assert.equal(M.isProvisional(n.replace('cb-039', 'CB039')), true, n);
  assert.deepEqual(M.nameTokens('A menina das rosas - R. Califórnia'), ['menina', 'rosas']);
  assert.equal(M.portalUncertainty({ observacao: 'ESTIMADO do print, NÃO CONFIRMADO.' }), 20);
  assert.equal(M.portalUncertainty({ observacao: 'posição confirmada em campo' }), 5);
  assert.equal(M.portalUncertainty({ observacao: '' }), 20);
});
