'use strict';
// Caso real de 25/11/2026: 23 portais da zona sul (export do app do dono), Simulação, maxKeys=8, objetivo MU.
// Referência: às 12:12 o app (sem limite de chaves) gerou 12 campos / 19 links com esses portais.
// O arquivo fica só no computador do dono (tests/fixtures-local/, fora do git); sem ele, é pulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const O = require('../optimizer.js');
const Plan = require('../plan.js');

const file = path.join(__dirname, 'fixtures-local', 'zona-sul-25112026.json');
const HAVE = fs.existsSync(file);
const SKIP = HAVE ? false : 'caso real só no computador do dono (tests/fixtures-local/zona-sul-25112026.json)';
const data = HAVE ? JSON.parse(fs.readFileSync(file, 'utf8')) : { portals: [], settings: {} };

test('25/11 zona sul: MU, Simulação, maxKeys=8 → farm ≤ 8 por portal e ≥ 12 campos', { skip: SKIP, timeout: 60000 }, () => {
  assert.equal(data.portals.length, 23);
  // o app usa 1500 ms; repete para cobrir a variação da busca por tempo
  for (let run = 0; run < 3; run++) {
    const res = O.optimize({ portals: data.portals, blockers: data.blockers, radius: data.settings.radius, maxOut: data.settings.maxOut,
      maxKeys: 8, objective: 'mu', strategy: 'auto', ignoreKeys: true, timeBudgetMs: 1500 });
    const kn = Plan.keyNeeds(res, data.portals);
    kn.missing.forEach(k => assert.ok(k.need <= 8, `${k.portal} pede ${k.need}`));
    res.keysMissing.forEach(k => assert.ok(k.need <= 8, `${k.portal} pede ${k.need}`));
    assert.ok(res.maxKeyDemand.need <= 8);
    assert.ok(res.fields.length >= 12, `rodada ${run}: ${res.fields.length} campos / ${res.links.length} links (${res.strategy})`);
    console.log(`rodada ${run}: ${res.fields.length} campos, ${res.links.length} links, área ${res.area} m², ${res.strategy}` +
      (res.anchors ? ' âncoras ' + res.anchors.join(',') : '') + `, maior demanda ${res.maxKeyDemand.need} (${res.maxKeyDemand.portal})`);
  }
});
