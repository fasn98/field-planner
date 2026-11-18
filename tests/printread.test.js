'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../printread.js');
const FP = require('../plan.js');

const GOOD = {
  tipo: 'lista_chaves', escala_m_por_px: null, norte_para_cima: null,
  portais: [{ nome: 'Retalhos', x: null, y: null, endereco: 'R. Arizona, 1100', distancia_m: 190.8, nivel: 6, chaves: 2 }]
};
function apiBody(obj, extra) {
  return Object.assign({ type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, extra || {});
}
function fakeFetch(status, body, headers) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init });
    if (status === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: { get: (k) => (headers || {})[k.toLowerCase()] || null },
      json: () => Promise.resolve(body) });
  };
  fn.calls = calls;
  return fn;
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('leitura válida passa e é normalizada', () => {
  const r = R.parseResponse(apiBody(GOOD));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.value.portais[0].nome, 'Retalhos');
  assert.equal(r.value.portais[0].distancia_m, 190.8);
});

test('JSON inválido ou fora do formato é recusado (nada é devolvido para aplicar)', () => {
  const bad = [
    'não é json',
    '{"tipo":"mapa"}',
    { ...GOOD, tipo: 'outro' },
    { ...GOOD, extra: 1 },
    { ...GOOD, portais: [{ ...GOOD.portais[0], dono: 'AgenteX' }] }, // campo de jogador: recusado
    { ...GOOD, portais: [{ ...GOOD.portais[0], nivel: 9 }] },
    { ...GOOD, portais: [{ ...GOOD.portais[0], nivel: 5.5 }] },
    { ...GOOD, portais: [{ ...GOOD.portais[0], chaves: -1 }] },
    { ...GOOD, portais: [{ ...GOOD.portais[0], nome: '' }] },
    { ...GOOD, portais: [{ ...GOOD.portais[0], distancia_m: 'perto' }] },
    { ...GOOD, tipo: 'mapa', portais: [{ ...GOOD.portais[0], x: 10, y: null }] },
    { ...GOOD, portais: Array(201).fill(GOOD.portais[0]) }
  ];
  for (const b of bad) {
    const r = R.parseResponse(apiBody(b));
    assert.equal(r.ok, false, 'deveria recusar: ' + JSON.stringify(b).slice(0, 80));
    assert.equal(r.value, undefined);
    assert.match(r.error, /formato|JSON/);
  }
  assert.equal(R.parseResponse(apiBody(GOOD, { stop_reason: 'refusal' })).ok, false);
  assert.equal(R.parseResponse(apiBody(GOOD, { stop_reason: 'max_tokens' })).ok, false);
  assert.equal(R.parseResponse({ content: [] }).ok, false);
});

test('pedido: chamada direta do navegador, visão, JSON estrito, modelo configurável', () => {
  const rq = R.buildRequest('sk-ant-teste-1234', 'claude-sonnet-5-5', 'QUJD', 'image/jpeg');
  assert.equal(rq.url, 'https://api.anthropic.com/v1/messages');
  const h = rq.init.headers;
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(h['x-api-key'], 'sk-ant-teste-1234');
  assert.equal(h['anthropic-version'], '2023-06-01');
  const body = JSON.parse(rq.init.body);
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.deepEqual(body.output_config.format.schema, R.SCHEMA);
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.messages[0].content[0].source.data, 'QUJD');
  assert.match(R.SYSTEM, /IGNORE nomes de agentes, donos de portal, mensagens do COMM/);
  assert.match(R.SYSTEM, /Não invente/);
  assert.equal(JSON.parse(R.buildRequest('k', '', 'x', 'image/png').init.body).model, R.DEFAULT_MODEL);
});

test('erros 401, 429 (com retry-after), 5xx e rede viram mensagens claras', async () => {
  let r = await R.readImage(fakeFetch(401, {}), 'k', null, 'x', 'image/png');
  assert.equal(r.ok, false); assert.match(r.error, /Chave da API inválida/);
  r = await R.readImage(fakeFetch(429, {}, { 'retry-after': '30' }), 'k', null, 'x', 'image/png');
  assert.match(r.error, /Limite de uso.*30 s/);
  r = await R.readImage(fakeFetch(529, {}), 'k', null, 'x', 'image/png');
  assert.match(r.error, /sobrecarregada/);
  r = await R.readImage(fakeFetch('network'), 'k', null, 'x', 'image/png');
  assert.match(r.error, /Sem conexão/);
  r = await R.readImage(fakeFetch(200, apiBody(GOOD)), 'k', null, 'x', 'image/png');
  assert.equal(r.ok, true);
  r = await R.readImage(fakeFetch(200, apiBody('{quebrado')), 'k', null, 'x', 'image/png');
  assert.equal(r.ok, false);
  r = await R.readImage(fakeFetch(200, apiBody(GOOD)), '', null, 'x', 'image/png');
  assert.match(r.error, /sem chave/);
});

test('a chave da API nunca aparece em mensagem de erro nem em log', async () => {
  const KEY = 'sk-ant-SEGREDO-987654';
  const logs = [];
  const orig = {};
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) { orig[k] = console[k]; console[k] = (...a) => logs.push(a.join(' ')); }
  try {
    for (const st of [400, 401, 403, 404, 413, 429, 500, 529, 'network']) {
      const r = await R.readImage(fakeFetch(st, { error: { message: 'x' } }), KEY, null, 'x', 'image/png');
      assert.ok(!JSON.stringify(r).includes(KEY), 'erro ' + st + ' vazou a chave');
    }
  } finally { Object.assign(console, orig); }
  assert.ok(!logs.join('\n').includes(KEY));
  assert.equal(R.maskKey(KEY), '••••7654');
});

test('a chave da API nunca aparece no export JSON', () => {
  const st = memStorage();
  R.saveKey(st, 'sk-ant-SEGREDO-123');
  R.savePrefs(st, { enabled: true, model: 'claude-sonnet-5-5', autoPct: 85 });
  const db = { portals: [{ id: 'a', nome: 'A', lat: 0, lng: 0, nivel: 5, chaves: 1, observacao: '' }], blockers: [], done: [], excluded: [], coveredManual: [],
    settings: { radius: 1500 }, plan: null, lastImport: null };
  // mesmo que algo tente pendurar a chave no db, o export é uma lista fechada de campos
  db.apiKey = R.loadKey(st);
  const out = JSON.stringify(FP.exportPayload(db));
  assert.ok(!out.includes('SEGREDO'));
  assert.ok(!/apikey|api_key|apiKey/i.test(out));
  assert.deepEqual(Object.keys(FP.exportPayload(db)).sort(), ['app', 'blockers', 'coveredManual', 'done', 'excluded', 'exportedAt', 'plan', 'portals', 'settings', 'version']);
  // observações só com escolha explícita; nem assim a chave entra
  const withObs = JSON.stringify(FP.exportPayload(db, 1, { observacoes: [{ nome: 'P', distancia_m: 10, origem: { lat: 0, lng: 0 }, ts: 1, apiKey: R.loadKey(st) }] }));
  assert.ok(!withObs.includes('SEGREDO'));
  R.clearKey(st);
  assert.equal(R.loadKey(st), '');
});

test('preferências: recurso desligado por padrão, modelo padrão claude-sonnet-5-5', () => {
  const st = memStorage();
  assert.deepEqual(R.loadPrefs(st), { enabled: false, model: 'claude-sonnet-5-5', autoPct: 80 });
  st.setItem(R.PREFS_STORE, JSON.stringify({ enabled: 'sim', model: 'x y<script>', autoPct: 5 }));
  assert.deepEqual(R.loadPrefs(st), { enabled: false, model: 'claude-sonnet-5-5', autoPct: 80 }); // lote nunca abaixo de 80%
});

test('pedido manda pular portal com nome cortado (não transcrever pedaço de nome)', () => {
  assert.match(R.SYSTEM, /cortado.*pule esse portal/);
  assert.doesNotMatch(R.SYSTEM, /copie só a parte visível/);
});
