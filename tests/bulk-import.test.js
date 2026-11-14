'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');

const close = (a, b) => Math.abs(a - b) < 1e-6;

test('nome antes do link do Google Maps', () => {
  const r = G.parseBulkLine('Praça da Sé https://www.google.com/maps/place/Pra%C3%A7a+da+S%C3%A9/@-23.5503,-46.6340,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-23.550520!4d-46.633308');
  assert.equal(r.nome, 'Praça da Sé');
  // usa o pino (!3d/!4d), não o centro da tela (@)
  assert.ok(close(r.lat, -23.55052) && close(r.lng, -46.633308), JSON.stringify(r));
});

test('nome depois do link, com separador', () => {
  const r = G.parseBulkLine('https://maps.google.com/?q=-23.561414,-46.655881 - Masp');
  assert.deepEqual([r.nome, r.lat, r.lng], ['Masp', -23.561414, -46.655881]);
});

test('nome e coordenadas soltas, separados por ponto e vírgula ou tab', () => {
  const a = G.parseBulkLine('Teatro Municipal; -23.545183, -46.638209');
  assert.deepEqual([a.nome, a.lat, a.lng], ['Teatro Municipal', -23.545183, -46.638209]);
  const b = G.parseBulkLine('Mural do Beco\thttps://www.google.com/maps/@-23.556,-46.690,18z');
  assert.deepEqual([b.nome, b.lat, b.lng], ['Mural do Beco', -23.556, -46.69]);
});

test('sem nome na linha: usa o nome do lugar no link /maps/place/', () => {
  const r = G.parseBulkLine('https://www.google.com/maps/place/Catedral+da+S%C3%A9/@-23.5510,-46.6345,17z');
  assert.equal(r.nome, 'Catedral da Sé');
});

test('sem nome em lugar nenhum: nome vazio, para o usuário preencher', () => {
  const r = G.parseBulkLine('https://maps.google.com/?q=-23.561414,-46.655881');
  assert.equal(r.nome, '');
  assert.ok(close(r.lat, -23.561414));
});

test('link curto do Google Maps é recusado com motivo (nunca é aberto)', () => {
  assert.deepEqual(G.parseBulkLine('https://maps.app.goo.gl/AbCdEf123 Banca'), { erro: 'link curto sem coordenadas' });
});

test('linha sem coordenadas vira erro; vazias e comentários são ignorados', () => {
  const rows = G.parseBulk('nome,link\n\n# comentário\n// outro\nFonte -23.5501, -46.6301\n');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].linha, rows[0].erro], [1, 'sem coordenadas']);
  assert.deepEqual([rows[1].linha, rows[1].nome], [5, 'Fonte']);
});

test('aceita quebras de linha do Windows', () => {
  const rows = G.parseBulk('A -23.5501, -46.6301\r\nB -23.5502, -46.6302\r\n');
  assert.deepEqual(rows.map(r => r.nome), ['A', 'B']);
});

test('nome é limitado a 80 caracteres', () => {
  const r = G.parseBulkLine('x'.repeat(200) + ' -23.5501, -46.6301');
  assert.equal(r.nome.length, 80);
});

// --- correções da revisão da v1.2.0 ---

test('pll= (posição do portal) tem prioridade sobre ll= (centro do mapa)', () => {
  const r = G.parseCoords('https://example.org/intel?ll=-23.50,-46.60&z=17&pll=-23.5503,-46.6340');
  assert.deepEqual(r, { lat: -23.5503, lng: -46.634 });
  const b = G.parseBulkLine('https://example.org/intel?ll=-23.50,-46.60&z=17&pll=-23.5503,-46.6340');
  assert.deepEqual([b.lat, b.lng], [-23.5503, -46.634]);
});

test('link sem esquema não vira nome', () => {
  const r = G.parseBulkLine('www.google.com/maps/@-23.5614,-46.6558,17z');
  assert.equal(r.nome, '');
  assert.deepEqual([r.lat, r.lng], [-23.5614, -46.6558]);
});

test('remove exatamente o par de coordenadas usado, não outro número do nome', () => {
  const r = G.parseBulkLine('Igreja 12.5, 3.4 -23.5503, -46.6340');
  assert.equal(r.nome, 'Igreja 12.5, 3.4');
  assert.deepEqual([r.lat, r.lng], [-23.5503, -46.634]);
});

test('linha patológica enorme é processada rápido', () => {
  const t0 = Date.now();
  G.parseBulkLine('?x=1' + '&lat=1'.repeat(20000));
  assert.ok(Date.now() - t0 < 200, `levou ${Date.now() - t0} ms`);
});

test('parseBulk para no limite de linhas', () => {
  const text = Array.from({ length: 50 }, (_, i) => `P${i} -23.55${String(i).padStart(2, '0')}1, -46.6301`).join('\n');
  assert.equal(G.parseBulk(text, 10).length, 10);
});
