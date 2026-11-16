'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const M = require('../matching.js');
const { at } = require('./helpers.js');

// portais provisórios em posições irregulares numa área de ~1 km (pseudoaleatórias, determinísticas)
function grid() {
  let s = 99;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out = [];
  for (let n = 1; n <= 30; n++) {
    out.push(Object.assign({ id: 'p' + n, nome: 'BK ' + String(n).padStart(3, '0') + ' - R. Teste', nivel: 5, chaves: 0, observacao: '' }, at(rnd() * 1000, rnd() * 1000)));
  }
  return out;
}
// ruído determinístico
function noise(k, amp) { return amp * Math.sin(k * 12.9898) * 0.999; }

test('húngaro: atribuição mínima, retangular e com proibidos', () => {
  assert.deepEqual(M.hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);
  assert.deepEqual(M.hungarian([[1, 2], [1, 2], [1, 2]]).filter(x => x >= 0).length, 2);
  assert.deepEqual(M.hungarian([[Infinity, 5], [Infinity, 1]]), [-1, 1].length === 2 ? M.hungarian([[Infinity, 5], [Infinity, 1]]) : null);
  const r = M.hungarian([[Infinity, 5], [Infinity, 1]]);
  assert.equal(r.filter(x => x === 1).length, 1);
  assert.ok(!r.includes(0));
});

test('nome normalizado e rua compatível', () => {
  assert.equal(M.normName('  A Menina das Rosas! '), 'a menina das rosas');
  assert.equal(M.normName('Livraria Nóbel'), 'livraria nobel');
  assert.deepEqual(M.streetTokens('R. Dr. José de Souza, 120 - Brooklin'), ['jose', 'souza']);
  assert.equal(M.streetCompatible('Rua Arizona, 1000', { nome: 'BK 070 - R. Arizona' }), true);
  assert.equal(M.streetCompatible('Rua Michigan, 10', { nome: 'BK 070 - R. Arizona' }), false);
  assert.equal(M.streetCompatible(null, { nome: 'BK 070 - R. Arizona' }), null);
  assert.ok(M.isProvisional('BK 070 - R. Arizona') && M.isProvisional('Portal 07') && M.isProvisional('CB 12'));
  assert.ok(!M.isProvisional('Igreja Matriz'));
});

// pixel = (metros − translação) / escala, com y do pixel para baixo
function toPixels(portals, scale, ox, oy, F) {
  return portals.map((p, k) => {
    const m = F.to(p);
    const ex = noise(k + 1, 15), ey = noise(k + 7, 15); // ruído de até 15 m
    return { nome: p.nome.replace('BK', 'REAL'), x: (m.x + ex - ox) / scale, y: -(m.y + ey - oy) / scale };
  });
}

test('mapa: escala e translação conhecidas + ruído de 15 m + 1 ponto espúrio → casa certo e rejeita o espúrio', () => {
  const ps = grid();
  const F = M.localFrame(G.centroid(ps));
  const visible = ps.slice(5, 17); // parte da área aparece no print
  const pix = toPixels(visible, 2.18, -400, 600, F);
  pix.push({ nome: 'Espúrio', x: 5000, y: 5000 });
  for (const escala of [2.18, null]) {
    const r = M.matchMap({ tipo: 'mapa', portais: pix.map(p => Object.assign({ endereco: null, distancia_m: null, nivel: null, chaves: null }, p)), escala_m_por_px: escala, norte_para_cima: true }, ps, { seed: 7 });
    assert.equal(r.ok, true, 'escala ' + escala + ': ' + r.reason);
    assert.ok(Math.abs(r.transform.s - 2.18) < 0.1, 'escala ajustada ' + r.transform.s);
    assert.equal(r.matches.length, visible.length);
    for (const m of r.matches) assert.equal(m.portal, visible[m.idx].id, `${m.nome} → ${m.portal}`);
    assert.ok(r.unmatched.includes(pix.length - 1), 'espúrio rejeitado');
    assert.ok(r.matches.every(m => m.dist <= 25));
  }
});

test('mapa: girado (norte_para_cima = false) também casa', () => {
  const ps = grid();
  const F = M.localFrame(G.centroid(ps));
  const th = 30 * Math.PI / 180, s = 1.5;
  const pix = ps.slice(0, 10).map(p => {
    const m = F.to(p); // m = s·R(th)·[x; −y] + t, com t = 0  →  [x; −y] = R(−th)·m / s
    const X = (Math.cos(-th) * m.x - Math.sin(-th) * m.y) / s, Y = (Math.sin(-th) * m.x + Math.cos(-th) * m.y) / s;
    return { nome: p.nome, x: X, y: -Y, endereco: null, distancia_m: null, nivel: null, chaves: null };
  });
  const r = M.matchMap({ tipo: 'mapa', portais: pix, escala_m_por_px: null, norte_para_cima: false }, ps, { seed: 3 });
  assert.equal(r.ok, true, r.reason);
  for (const m of r.matches) assert.equal(m.portal, ps[m.idx].id);
});

test('mapa: dois portais a 8 m um do outro → confiança baixa, sem auto-aceite', () => {
  const ps = grid();
  const twin = Object.assign({}, ps[12], { id: 'gemeo', nome: 'BK 999 - R. Teste' }, at(0, 0));
  const F0 = M.localFrame(G.centroid(ps));
  const m12 = F0.to(ps[12]);
  Object.assign(twin, F0.from({ x: m12.x + 8, y: m12.y }));
  const all = ps.concat([twin]);
  const F = M.localFrame(G.centroid(all));
  const pix = toPixels(ps.slice(8, 16), 2, 0, 0, F).map(p => Object.assign({ endereco: null, distancia_m: null, nivel: null, chaves: null }, p));
  const r = M.matchMap({ tipo: 'mapa', portais: pix, escala_m_por_px: 2, norte_para_cima: true }, all, { seed: 1 });
  assert.equal(r.ok, true, r.reason);
  const amb = r.matches.find(m => m.portal === ps[12].id || m.portal === 'gemeo');
  assert.ok(amb, 'o ponto ambíguo recebeu algum candidato');
  assert.ok(amb.confidence < M.AUTO_ACCEPT, 'confiança ' + amb.confidence + ' deveria ficar abaixo do auto-aceite');
  assert.ok(amb.second != null && amb.second - amb.dist <= 16);
});

test('mapa: menos de 3 pontos que batem → não casa nada', () => {
  const ps = grid();
  const r = M.matchMap({ tipo: 'mapa', portais: [{ nome: 'a', x: 0, y: 0 }, { nome: 'b', x: 100, y: 0 }], escala_m_por_px: 2, norte_para_cima: true }, ps);
  assert.equal(r.ok, false);
  assert.equal(r.matches.length, 0);
});

// ----- lista de chaves -----

function obs(nome, origin, portal, extra) {
  const d = G.haversine(origin, portal);
  return Object.assign({ nome, endereco: null, distancia_m: Math.round(d * 10) / 10, nivel: 6, chaves: 2,
    origem: { lat: origin.lat, lng: origin.lng, precisao: 5 }, ts: 1 }, extra || {});
}

test('lista de chaves: anel com um único portal → sugestão de confiança média (sem auto-aceite)', () => {
  const ps = grid();
  const o = at(-300, -300);
  const r = M.matchKeyList([obs('Retalhos', o, ps[0])], ps);
  const s = r.suggestions.find(x => x.nome === 'Retalhos');
  assert.ok(s, JSON.stringify(r.pending));
  assert.equal(s.portal, ps[0].id);
  assert.ok(s.confidence < M.AUTO_ACCEPT);
  assert.equal(s.keys, 2);
});

test('lista de chaves: dois portais no mesmo anel ficam pendentes com 1 obs. e se resolvem com uma 2ª de outra origem', () => {
  const A = Object.assign({ id: 'A', nome: 'BK 001 - R. Norte', nivel: 5, chaves: 0, observacao: '' }, at(0, 200));
  const B = Object.assign({ id: 'B', nome: 'BK 002 - R. Leste', nivel: 5, chaves: 0, observacao: '' }, at(200, 0));
  const ps = [A, B];
  const o1 = at(0, 0);
  const first = M.matchKeyList([obs('Vila', o1, A)], ps);
  assert.equal(first.suggestions.length, 0);
  assert.equal(first.pending.length, 1);
  assert.deepEqual(first.pending[0].candidates.sort(), ['A', 'B']);
  assert.match(first.pending[0].hint, /outro print/);
  const o2 = at(-150, 150); // a ~150 m de A e ~380 m de B
  const second = M.matchKeyList([obs('Vila', o1, A), obs('Vila', o2, A)], ps);
  assert.equal(second.pending.length, 0, JSON.stringify(second.pending));
  assert.equal(second.suggestions[0].portal, 'A');
  assert.equal(second.suggestions[0].origins, 2);
});

test('lista de chaves: endereço com a rua desempata o anel', () => {
  const A = Object.assign({ id: 'A', nome: 'BK 001 - R. Arizona', nivel: 5, chaves: 0, observacao: '' }, at(0, 200));
  const B = Object.assign({ id: 'B', nome: 'BK 002 - R. Michigan', nivel: 5, chaves: 0, observacao: '' }, at(200, 0));
  const r = M.matchKeyList([obs('Retalhos', at(0, 0), A, { endereco: 'R. Arizona, 1100 - Brooklin' })], [A, B]);
  assert.equal(r.suggestions.length, 1);
  assert.equal(r.suggestions[0].portal, 'A');
});

test('lista de chaves: dois nomes não ficam com o mesmo portal', () => {
  const A = Object.assign({ id: 'A', nome: 'BK 001', nivel: 5, chaves: 0, observacao: '' }, at(0, 200));
  const B = Object.assign({ id: 'B', nome: 'BK 002', nivel: 5, chaves: 0, observacao: '' }, at(200, 0));
  const C = Object.assign({ id: 'C', nome: 'BK 003', nivel: 5, chaves: 0, observacao: '' }, at(0, -500));
  const o = at(0, 0);
  // "Um" só pode ser A ou B; "Dois" só pode ser A (anel de 200 m de outra origem também) → "Um" fica com B
  const o2 = at(0, 400);
  const r = M.matchKeyList([obs('Um', o, B), obs('Dois', o, A), obs('Dois', o2, A)], [A, B, C]);
  const got = Object.fromEntries(r.suggestions.map(s => [s.nome, s.portal]));
  assert.equal(got.Dois, 'A');
  assert.equal(got.Um, 'B');
});

test('lista de chaves: dois nomes com o mesmo candidato único → os dois pendentes, com conflito (ninguém ganha sozinho)', () => {
  const A = Object.assign({ id: 'A', nome: 'BK 010 - R. Arizona', nivel: 5, chaves: 0, observacao: '' }, at(0, 200));
  const far = Object.assign({ id: 'Z', nome: 'BK 011', nivel: 5, chaves: 0, observacao: '' }, at(0, -800));
  const o1 = at(0, 0), o2 = at(150, 200), o3 = at(-150, 200);
  // "Alfa" com 3 origens e rua (antes chegava a 0,95 e entrava no lote); "Beta" com 1 origem, mesmo portal
  const list = [obs('Alfa', o1, A, { endereco: 'R. Arizona, 10' }), obs('Alfa', o2, A), obs('Alfa', o3, A),
    Object.assign(obs('Beta', o1, A), { distancia_m: G.haversine(o1, A) + 5 })];
  const r = M.matchKeyList(list, [A, far]);
  assert.equal(r.suggestions.length, 0, JSON.stringify(r.suggestions));
  const names = r.pending.map(p => p.nome).sort();
  assert.deepEqual(names, ['Alfa', 'Beta']);
  for (const p of r.pending) {
    assert.deepEqual(p.candidates, ['A']);
    assert.match(p.hint, /conflito/);
    assert.ok(p.conflict.length === 1);
  }
});

test('lista de chaves: ≥ 1 km arredondado nunca decide sozinho', () => {
  const A = Object.assign({ id: 'A', nome: 'BK 001', nivel: 5, chaves: 0, observacao: '' }, at(0, 1200));
  const r = M.matchKeyList([Object.assign(obs('Longe', at(0, 0), A), { distancia_m: 1200 })], [A]);
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.pending.length, 1);
});

test('lista de chaves: 3 observações bem espalhadas com ruído de 10 m → posição estimada a ≤ 15 m da real', () => {
  const real = at(120, 260);
  const P = Object.assign({ id: 'P', nome: 'BK 050 - R. Teste', nivel: 5, chaves: 0, observacao: '' }, at(124, 257)); // portal do app ~5 m fora
  // origens em volta do portal, a ~120° uma da outra (como andar em volta do quarteirão)
  const origins = [0, 120, 240].map(a => at(120 + 250 * Math.cos(a * Math.PI / 180), 260 + 250 * Math.sin(a * Math.PI / 180)));
  const errs = [10, -10, 7];
  const list = origins.map((o, k) => Object.assign(obs('Las Patitas', o, real), { distancia_m: Math.round((G.haversine(o, real) + errs[k]) * 10) / 10 }));
  const tri = M.trilaterate(list);
  assert.ok(tri, 'trilateração deveria rodar');
  assert.ok(G.haversine(tri.pos, real) <= 15, 'erro ' + G.haversine(tri.pos, real).toFixed(1) + ' m');
  const r = M.matchKeyList(list, [P]);
  const s = r.suggestions[0];
  assert.ok(s && s.estimate, JSON.stringify(r));
  assert.ok(s.estimate.residual <= M.TRILAT_MAX_RES_M);
  assert.ok(Math.abs(s.estimate.shift - G.haversine(P, tri.pos)) <= 1);
});

test('lista de chaves: origens mal espalhadas não sugerem "ajustar posição" (resíduo baixo engana)', () => {
  const real = at(120, 260);
  const P = Object.assign({ id: 'P', nome: 'BK 050 - R. Teste', nivel: 5, chaves: 0, observacao: '' }, at(130, 255));
  const origins = [at(0, 0), at(300, 50), at(60, 450)];
  const errs = [10, -10, 7];
  const list = origins.map((o, k) => Object.assign(obs('Vila', o, real), { distancia_m: G.haversine(o, real) + errs[k] }));
  const tri = M.trilaterate(list);
  assert.ok(G.haversine(tri.pos, real) > 15, 'cenário deveria ter erro real acima de 15 m');
  assert.ok(tri.residual <= 15, 'e mesmo assim resíduo baixo');
  assert.equal(M.trustedTri(tri), false);
  const s = M.matchKeyList(list, [P]).suggestions[0];
  assert.ok(s && !s.estimate);
});

test('mapa: grade de ruas regular (quarteirões iguais) não pode casar deslocada de uma quadra', () => {
  const ps = [];
  let n = 1;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
    ps.push(Object.assign({ id: 'q' + n, nome: 'BK ' + String(n).padStart(3, '0'), nivel: 5, chaves: 0, observacao: '' }, at(i * 170 + ((j * 37) % 50), j * 190 + ((i * 53) % 60))));
    n++;
  }
  const F = M.localFrame(G.centroid(ps));
  const visible = ps.slice(5, 17);
  const pix = toPixels(visible, 2.18, -400, 600, F).map(p => Object.assign({ endereco: null, distancia_m: null, nivel: null, chaves: null }, p));
  const r = M.matchMap({ tipo: 'mapa', portais: pix, escala_m_por_px: 2.18, norte_para_cima: true }, ps, { seed: 7 });
  const wrong = r.matches.filter(m => m.portal !== visible[m.idx].id);
  // ou acerta tudo, ou o que errar não pode ter confiança de auto-aceite
  for (const m of wrong) assert.ok(m.confidence < M.AUTO_ACCEPT, `${m.nome} → ${m.portal} com ${m.confidence}`);
});

test('lista de chaves: portal já com o nome real não é sugerido de novo', () => {
  const A = Object.assign({ id: 'A', nome: 'Retalhos', nivel: 5, chaves: 0, observacao: '' }, at(0, 200));
  const r = M.matchKeyList([obs('RETALHOS', at(0, 0), A)], [A]);
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.named[0].portal, 'A');
});

test('portal único: candidatos pela rua, confiança nunca acima de 0,5', () => {
  const A = Object.assign({ id: 'A', nome: 'BK 001 - R. Arizona', nivel: 5, chaves: 0, observacao: '' }, at(0, 100));
  const B = Object.assign({ id: 'B', nome: 'BK 002 - R. Michigan', nivel: 5, chaves: 0, observacao: '' }, at(50, 100));
  const r = M.matchSingle({ tipo: 'portal_unico', portais: [{ nome: 'Retalhos', endereco: 'Rua Arizona, 1000', distancia_m: null, x: null, y: null, nivel: null, chaves: null }] }, [A, B], null);
  assert.equal(r.candidates[0].portal, 'A');
  assert.ok(r.confidence <= 0.5);
});

// caso real de 16/11: tests/real-16112026.test.js
