'use strict';
// Máx. chaves por portal (settings.maxKeys): nenhum portal recebe mais links planejados que o limite.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../optimizer.js');
const Plan = require('../plan.js');
const OLD = require('./fixtures/optimizer-1.11.0.js'); // otimizador antes do limite (v1.11.0)
const { at, portal } = require('./helpers.js');

function incoming(res) {
  const m = {};
  res.links.forEach(l => { m[l.to] = (m[l.to] || 0) + 1; });
  return m;
}
function maxIn(res) { return Math.max(0, ...Object.values(incoming(res))); }
function outgoing(res) {
  const m = {};
  res.links.forEach(l => { m[l.from] = (m[l.from] || 0) + 1; });
  return Math.max(0, ...Object.values(m));
}
// 30 portais em leque: âncora no centro-sul e um arco de 29 portais
function leque(extra) {
  const ps = [portal('ANC', 0, 0, { chaves: 100 })];
  for (let i = 0; i < 29; i++) {
    const a = Math.PI * (0.1 + 0.8 * i / 28);
    ps.push(portal('P' + i, Math.cos(a) * 500, Math.sin(a) * 500, extra));
  }
  return ps;
}

for (const sim of [false, true]) {
  test(`30 portais em leque, maxKeys=8 (${sim ? 'simulação' : 'chaves reais'}): nenhum portal recebe mais de 8 links`, () => {
    const input = { portals: leque({ chaves: 100 }), position: at(0, -50), maxKeys: 8, ignoreKeys: sim, timeBudgetMs: 900 };
    for (const objective of ['campos', 'mu', 'ap']) {
      const res = O.optimize({ ...input, objective });
      assert.ok(res.links.length > 0);
      assert.ok(maxIn(res) <= 8, `${objective}: ${maxIn(res)} links chegando num portal`);
      assert.ok(outgoing(res) <= 8);
      assert.equal(res.maxKeys, 8);
      assert.ok(res.maxKeyDemand && res.maxKeyDemand.need <= 8);
      // lista de farm/“mais campos” nunca pede mais que 8 de um portal
      res.keysMissing.forEach(k => assert.ok(k.need <= 8, `${k.portal} pede ${k.need}`));
      const kn = Plan.keyNeeds(res, input.portals.map(p => ({ ...p, chaves: 0 })));
      kn.missing.forEach(k => assert.ok(k.need <= 8));
      assert.ok(kn.demand.need <= 8);
    }
  });
}

test('limite efetivo fora da simulação é min(maxKeys, chaves que tenho)', () => {
  const ps = leque({ chaves: 100 });
  ps[0].chaves = 3;
  const res = O.optimize({ portals: ps, position: at(0, -50), maxKeys: 8, timeBudgetMs: 600 });
  assert.ok((incoming(res).ANC || 0) <= 3);
  assert.ok(maxIn(res) <= 8);
});

test('com o limite, várias âncoras rendem mais que uma âncora só', () => {
  const input = { portals: leque(), position: at(0, -50), maxKeys: 8, ignoreKeys: true, strategy: 'fanfield', timeBudgetMs: 1500 };
  const res = O.optimize(input);
  assert.ok(res.anchors.length >= 2, 'esperava plano com 2+ âncoras, veio ' + JSON.stringify(res.anchors));
  // a melhor âncora única, sob o mesmo limite, rende menos campos
  const world = O._internal.buildWorld(input);
  world.objective = 'campos';
  let bestSingle = 0;
  world.candidates.forEach(a => {
    const ord = O._internal.angularOrder(world, a, world.candidates);
    [ord, ord.slice().reverse()].forEach(o => {
      bestSingle = Math.max(bestSingle, O._internal.simulate(world, o, { type: 'fan', anchor: a }).fields);
    });
  });
  assert.ok(res.fields.length > bestSingle, `multi ${res.fields.length} vs uma âncora ${bestSingle}`);
});

function strip(r) {
  const o = { ...r };
  ['elapsedMs', 'maxKeys', 'anchors', 'maxKeyDemand'].forEach(k => delete o[k]);
  return o;
}
test('maxKeys=50 dá o mesmo resultado de antes do limite', () => {
  const cases = [
    { portals: leque({ chaves: 100 }), position: at(0, -50), strategy: 'fanfield', ignoreKeys: true },
    { portals: leque({ chaves: 2 }), position: at(0, -50), strategy: 'fanfield' },
    { portals: leque({ chaves: 100 }), position: at(0, -50), strategy: 'multicamada', objective: 'mu', ignoreKeys: true },
    { portals: leque({ chaves: 1 }).slice(0, 6), position: at(0, -50), strategy: 'auto' } // 6 portais: busca exaustiva
  ];
  for (const c of cases) {
    const input = { ...c, timeBudgetMs: 20000 };
    assert.deepEqual(strip(O.optimize({ ...input, maxKeys: 50 })), strip(OLD.optimize(input)));
  }
});

test('JSON importado sem maxKeys assume 8; com valor, respeita a faixa 1–50', () => {
  const cur = { radius: 1500, maxOut: 8, maxKeys: 20, objective: 'campos', strategy: 'auto', simulate: false };
  assert.equal(Plan.importSettings({ radius: 900 }, cur).maxKeys, 8);
  assert.equal(Plan.importSettings({}, cur).maxKeys, 8);
  assert.equal(Plan.importSettings({ maxKeys: 12 }, cur).maxKeys, 12);
  assert.equal(Plan.importSettings({ maxKeys: 0 }, cur).maxKeys, 1);
  assert.equal(Plan.importSettings({ maxKeys: 99 }, cur).maxKeys, 50);
  assert.equal(Plan.importSettings({ maxKeys: 'x' }, cur).maxKeys, 8);
  assert.equal(O.optimize({ portals: leque(), ignoreKeys: true, timeBudgetMs: 100 }).maxKeys, 8);
});

test('registro do plano guarda maxKeys e export inclui settings.maxKeys', () => {
  const res = O.optimize({ portals: leque(), position: at(0, -50), maxKeys: 6, ignoreKeys: true, timeBudgetMs: 300 });
  const rec = Plan.makeRecord(res, { settings: { radius: 1500, maxOut: 8, maxKeys: 6 }, portals: leque() });
  assert.equal(rec.settings.maxKeys, 6);
  const back = Plan.sanitizeRecord(JSON.parse(JSON.stringify(rec)));
  assert.equal(back.settings.maxKeys, 6);
  assert.equal(back.result.maxKeys, 6);
  assert.deepEqual(back.result.anchors, res.anchors);
  const old = Plan.sanitizeRecord({ ...JSON.parse(JSON.stringify(rec)), settings: { radius: 1500 } });
  assert.equal(old.settings.maxKeys, 8);
  const db = { portals: [], blockers: [], done: [], excluded: [], coveredManual: [], settings: { maxKeys: 6 }, plan: rec };
  assert.equal(JSON.parse(JSON.stringify(Plan.exportPayload(db))).settings.maxKeys, 6);
});

test('export com observações (v1.11.2) leva settings.maxKeys junto; arquivo v1.11.2 sem maxKeys importa como 8', () => {
  const o = { nome: 'Praça', endereco: null, distancia_m: 120, nivel: 3, chaves: 2, origem: { ...at(0, 0), precisao: 10 }, ts: 5 };
  const db = { portals: [], blockers: [], done: [], excluded: [], coveredManual: [], plan: null,
    settings: { radius: 1500, maxOut: 8, maxKeys: 12, objective: 'mu', strategy: 'auto', simulate: true } };
  const file = JSON.parse(JSON.stringify(Plan.exportPayload(db, 1, { observacoes: [o] })));
  assert.equal(file.settings.maxKeys, 12);
  assert.equal(file.observacoes.length, 1);
  const cur = { ...db.settings, maxKeys: 30 };
  assert.equal(Plan.importSettings(file.settings, cur).maxKeys, 12);
  // arquivo da v1.11.2: settings sem maxKeys, com observações
  const v1112 = { ...file, settings: { radius: 1500, maxOut: 8, objective: 'mu', strategy: 'auto', simulate: true } };
  assert.equal(Plan.importSettings(v1112.settings, cur).maxKeys, 8);
  assert.equal(v1112.observacoes[0].nome, 'Praça');
});
