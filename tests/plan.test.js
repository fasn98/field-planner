'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../optimizer.js');
const FP = require('../plan.js');
const { at, portal } = require('./helpers.js');

const SETTINGS = { radius: 1500, maxOut: 8, objective: 'campos', strategy: 'auto', simulate: true };

// Triângulo grande com 3 portais dentro: rende vários campos (fan ou multicamada).
function world(keys) {
  return [
    portal('A', 0, 0, { chaves: keys }), portal('B', 600, 0, { chaves: keys }), portal('C', 300, 520, { chaves: keys }),
    portal('D', 300, 170, { chaves: keys }), portal('E', 260, 120, { chaves: keys }), portal('F', 350, 140, { chaves: keys })
  ];
}
function calc(portals, extra) {
  const input = Object.assign({ portals, position: at(0, -50), ignoreKeys: true, strategy: 'auto', timeBudgetMs: 300 }, extra || {});
  return O.optimize(input);
}
function record(portals, res, meta) {
  return FP.makeRecord(res, Object.assign({ origin: at(0, -50), settings: SETTINGS, appVersion: '1.8.0', pinned: true, portals, ts: 1763300000000 }, meta || {}));
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const data = (portals, extra) => Object.assign({ portals, blockers: [], done: [], excluded: [], coveredManual: [], maxOut: 8 }, extra || {});

test('otimizador devolve os ids dos candidatos usados no cálculo', () => {
  const ps = world(0);
  const res = calc(ps);
  assert.equal(res.candidateIds.length, res.candidates);
  assert.deepEqual(new Set(res.candidateIds), new Set(ps.map(p => p.id)));
});

test('registro guarda resultado e entradas, e volta igual do JSON (persistência e restauração)', () => {
  const ps = world(0);
  const res = calc(ps);
  res.origin = at(0, -50);
  assert.ok(res.links.length >= 3, 'cenário deveria render vários links');
  const rec = record(ps, res);
  const back = FP.sanitizeRecord(JSON.parse(JSON.stringify(rec))); // = localStorage / arquivo exportado
  assert.ok(back);
  assert.equal(back.pinned, true);
  assert.equal(back.ts, 1763300000000);
  assert.equal(back.appVersion, '1.8.0');
  assert.deepEqual(back.origin, rec.origin);
  assert.deepEqual(back.settings, rec.settings);
  assert.deepEqual(back.candidates, res.candidateIds);
  assert.deepEqual(back.result.steps, res.steps);
  assert.deepEqual(back.result.links, res.links);
  assert.deepEqual(back.result.fields, res.fields);
  assert.equal(back.result.simulation, true);
  // posições do momento do cálculo, para detectar portal movido depois
  for (const id of FP.planPortalIds(res)) {
    const p = ps.find(x => x.id === id);
    assert.deepEqual(back.positions[id], [p.lat, p.lng]);
  }
  // restaurar não recalcula: o mesmo registro serve para restaurar de novo, idêntico
  assert.deepEqual(FP.sanitizeRecord(clone(back)), back);
});

test('registro inválido ou adulterado é descartado', () => {
  assert.equal(FP.sanitizeRecord(null), null);
  assert.equal(FP.sanitizeRecord({}), null);
  assert.equal(FP.sanitizeRecord({ result: { steps: 'x' } }), null);
  const ps = world(0);
  const rec = clone(record(ps, calc(ps)));
  rec.result.steps[0].links[0].from = 'outro'; // link que não sai do portal do passo
  assert.equal(FP.sanitizeRecord(rec), null);
  const rec2 = clone(record(ps, calc(ps)));
  rec2.result.steps[0].links.push(Object.assign({}, rec2.result.steps[0].links[0])); // número de link repetido
  assert.equal(FP.sanitizeRecord(rec2), null);
});

test('plano fixado nunca recalcula sozinho (GPS, 5 min, dados, simulação); solto continua como antes', () => {
  const ps = world(0);
  const pinned = record(ps, calc(ps), { pinned: true });
  const loose = record(ps, calc(ps), { pinned: false });
  const evs = [
    { type: 'gps', fieldMode: true, lastPos: at(0, 0), moved: 5000 },
    { type: 'gps', fieldMode: true, lastPos: null, moved: 0 },
    { type: 'timer', fieldMode: true, elapsedMs: 60 * 60 * 1000 },
    { type: 'auto', reason: 'dados alterados' },
    { type: 'auto', reason: 'simulação desligada' },
    { type: 'auto', reason: 'link #1 concluído' }
  ];
  for (const ev of evs) assert.equal(FP.autoRecalcReason(pinned, ev), null, JSON.stringify(ev));
  assert.match(FP.autoRecalcReason(loose, evs[0]), /se moveu mais de 100 m/);
  assert.equal(FP.autoRecalcReason(loose, evs[1]), 'GPS disponível');
  assert.match(FP.autoRecalcReason(loose, evs[2]), /5 minutos/);
  assert.equal(FP.autoRecalcReason(loose, evs[3]), 'dados alterados');
  // solto: GPS só recalcula em campo e andando mais de 100 m; timer só depois de 5 min
  assert.equal(FP.autoRecalcReason(loose, { type: 'gps', fieldMode: false, lastPos: at(0, 0), moved: 5000 }), null);
  assert.equal(FP.autoRecalcReason(loose, { type: 'gps', fieldMode: true, lastPos: at(0, 0), moved: 80 }), null);
  assert.equal(FP.autoRecalcReason(loose, { type: 'timer', fieldMode: true, elapsedMs: 4 * 60 * 1000 }), null);
  assert.equal(FP.autoRecalcReason(null, evs[3]), null);
});

test('editar chaves não muda o plano fixado, mas "tem", farm e faltantes acompanham as chaves de agora', () => {
  const ps = world(0);
  const res = calc(ps);
  const rec = record(ps, res);
  const before = clone(rec);
  const k0 = FP.keyNeeds(rec.result, ps);
  assert.ok(k0.totalMissing > 0);
  // retrato do cálculo: tem 0 em tudo
  assert.ok(k0.used.every(k => k.have === 0));
  assert.equal(k0.totalMissing, res.links.length);
  // o jogador farma: 1 chave de cada portal (o caso do PDF de 16/11: "Tem 0" com 1 chave na mão)
  const ps1 = ps.map(p => Object.assign({}, p, { chaves: 1 }));
  const k1 = FP.keyNeeds(rec.result, ps1);
  assert.ok(k1.used.every(k => k.have === 1));
  assert.equal(k1.totalMissing, k0.totalMissing - k0.missing.length);
  for (const m of k1.missing) assert.equal(m.missing, m.need - 1);
  // com chaves suficientes a lista de farm some
  const ps9 = ps.map(p => Object.assign({}, p, { chaves: 9 }));
  const k9 = FP.keyNeeds(rec.result, ps9);
  assert.equal(k9.totalMissing, 0);
  assert.equal(k9.missing.length, 0);
  // nada disso mexe no plano salvo
  FP.validate(rec, data(ps9));
  assert.deepEqual(clone(rec), before);
});

test('chaves usadas contam só os links que faltam fazer (progresso em campo)', () => {
  const ps = world(5);
  const res = calc(ps, { ignoreKeys: false });
  const rec = record(ps, res);
  const total = FP.keyNeeds(rec.result, ps).used.reduce((a, k) => a + k.used, 0);
  assert.equal(total, res.links.length);
  const first = rec.result.steps[0].links.shift();
  rec.result.links = rec.result.links.filter(l => l.n !== first.n);
  const after = FP.keyNeeds(rec.result, ps).used.reduce((a, k) => a + k.used, 0);
  assert.equal(after, total - 1);
});

test('validação: dados iguais não acusam nada', () => {
  const ps = world(0);
  const rec = record(ps, calc(ps));
  const v = FP.validate(rec, data(ps));
  assert.deepEqual(v.issues, []);
  assert.equal(v.ok, true);
});

test('validação detecta portal movido mais de 30 m (e ignora ajuste pequeno), sem recalcular', () => {
  const ps = world(0);
  const rec = record(ps, calc(ps));
  const before = clone(rec);
  const target = rec.result.steps[rec.result.steps.length - 1].portal;
  const small = ps.map(p => p.id === target ? Object.assign({}, p, { lat: p.lat + 15 / 111320 }) : p);
  assert.equal(FP.validate(rec, data(small)).issues.filter(x => x.kind === 'movido').length, 0);
  const moved = ps.map(p => p.id === target ? Object.assign({}, p, { lat: p.lat + 45 / 111320 }) : p);
  const v = FP.validate(rec, data(moved));
  const mv = v.issues.filter(x => x.kind === 'movido');
  assert.ok(mv.length >= 1, 'deveria acusar o portal movido');
  assert.match(mv[0].text, new RegExp(target + ' foi movido 4[0-9] m'));
  assert.ok(mv.every(x => x.step >= 1 && x.n >= 1));
  assert.ok(v.steps.includes(rec.result.steps.length), 'passo do portal movido entre os afetados');
  assert.deepEqual(clone(rec), before); // validar não muda o plano
});

test('validação detecta portal excluído e link que passou a cruzar um bloqueador', () => {
  const ps = world(0).concat([portal('X1', 300, -300), portal('X2', 300, 900)]); // linha N–S pelo meio de tudo
  const plan = calc(world(0));
  const rec = record(ps, plan);
  const blk = data(ps, { blockers: [{ id: 'b1', portalA: 'X1', portalB: 'X2', origem: 'inimigo' }] });
  const v = FP.validate(rec, blk);
  const cross = v.issues.filter(x => x.kind === 'bloqueador');
  assert.ok(cross.length >= 1, 'algum link do plano cruza a linha X1–X2');
  assert.match(cross[0].text, /cruza o bloqueador inimigo X1 – X2/);
  assert.ok(cross[0].step >= 1);

  const gone = ps.filter(p => p.id !== plan.links[0].to);
  const v2 = FP.validate(rec, data(gone));
  assert.ok(v2.issues.some(x => x.kind === 'removido' && x.n === plan.links[0].n));
});

test('simulação fixada vai para o campo sem recalcular só com todas as chaves', () => {
  const ps = world(0);
  const res = calc(ps);
  const rec = record(ps, res);
  const steps = clone(rec.result.steps);
  // sem chaves: não converte e não mexe no registro
  const before = clone(rec);
  const fail = FP.toFieldPlan(rec, data(ps));
  assert.equal(fail.ok, false);
  assert.ok(fail.issues.some(x => x.kind === 'chave'));
  assert.deepEqual(clone(rec), before);
  // com as chaves da lista de farm: mesma ordem, mesmos links, agora plano real
  const need = Object.fromEntries(FP.keyNeeds(rec.result, ps).used.map(k => [k.portal, k.used]));
  const ok = ps.map(p => Object.assign({}, p, { chaves: need[p.id] || 0 }));
  const v = FP.toFieldPlan(rec, data(ok));
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.equal(rec.result.simulation, false);
  assert.equal(rec.settings.simulate, false);
  assert.deepEqual(rec.result.steps, steps);
  assert.deepEqual(rec.result.keysMissing, []);
  assert.equal(FP.keyNeeds(rec.result, ok).totalMissing, 0);
});

test('chave a menos em um único portal impede a ida para o campo e diz qual link', () => {
  const ps = world(0);
  const rec = record(ps, calc(ps));
  const used = FP.keyNeeds(rec.result, ps).used;
  const need = Object.fromEntries(used.map(k => [k.portal, k.used]));
  const short = used[used.length - 1].portal;
  const almost = ps.map(p => Object.assign({}, p, { chaves: (need[p.id] || 0) - (p.id === short ? 1 : 0) }));
  const v = FP.toFieldPlan(rec, data(almost));
  assert.equal(v.ok, false);
  assert.equal(v.issues.filter(x => x.kind === 'chave').length, 1);
  assert.match(v.issues[0].text, new RegExp('sem chave de ' + short));
});
