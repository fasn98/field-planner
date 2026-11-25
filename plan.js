/*
 * Field Planner — plano fixo.
 * Funções puras sobre o plano salvo (db.plan): registro com as entradas usadas no cálculo, chaves ao vivo,
 * validação contra os dados atuais e passagem da simulação para o modo em campo, sem recalcular.
 * Sem DOM e sem rede. Roda na página e nos testes (Node).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'), require('./optimizer.js'));
  else root.FPPlan = factory(root.FPGeo, root.FPOptimizer);
})(typeof self !== 'undefined' ? self : this, function (G, O) {
  'use strict';

  var RECORD_V = 1;
  var MOVE_WARN_M = 30;   // portal do plano movido mais que isso desde o cálculo → aviso
  var MAX_LINKS = 2000;   // limite de sanidade para planos vindos de arquivo
  var MOVE_RECALC_M = 100;              // em campo, plano solto recalcula ao andar isso
  var PERIODIC_RECALC_MS = 5 * 60 * 1000; // e a cada 5 min
  var ID_RE = /^[^\u0000-\u001f\u007f]{1,64}$/;

  function isId(x) { return typeof x === 'string' && ID_RE.test(x); }
  function num(x, def) { var n = Number(x); return isFinite(n) ? n : def; }
  function ll(p) { return p && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 ? { lat: +p.lat, lng: +p.lng } : null; }

  /** Ids de portais que o plano usa (passos, links e vértices de campos). */
  function planPortalIds(result) {
    var ids = Object.create(null);
    (result.steps || []).forEach(function (s) { ids[s.portal] = true; });
    (result.links || []).forEach(function (l) { ids[l.from] = ids[l.to] = true; });
    (result.fields || []).forEach(function (f) { f.portals.forEach(function (id) { ids[id] = true; }); });
    return Object.keys(ids);
  }

  /**
   * Registro persistido: resultado completo + entradas do cálculo.
   * meta: { origin, settings, appVersion, pinned, portals (db.portals no momento do cálculo), ts }
   */
  function makeRecord(result, meta) {
    var byId = Object.create(null);
    (meta.portals || []).forEach(function (p) { byId[p.id] = p; });
    var positions = Object.create(null);
    planPortalIds(result).forEach(function (id) { var p = byId[id]; if (p) positions[id] = [p.lat, p.lng]; });
    var s = meta.settings || {};
    return {
      v: RECORD_V,
      ts: num(meta.ts, Date.now()),
      appVersion: String(meta.appVersion || ''),
      pinned: !!meta.pinned,
      origin: ll(meta.origin),
      settings: { radius: s.radius, maxOut: s.maxOut, maxKeys: O.normMaxKeys(s.maxKeys), objective: s.objective, strategy: s.strategy, simulate: !!s.simulate },
      candidates: (result.candidateIds || []).slice(),
      positions: positions,
      result: result
    };
  }

  function sanitizeLink(l) {
    if (!l || !isId(l.from) || !isId(l.to) || l.from === l.to) return null;
    var n = Math.round(num(l.n, NaN));
    if (!(n >= 1)) return null;
    return { n: n, from: l.from, to: l.to, fields: Math.max(0, Math.round(num(l.fields, 0))), area: Math.max(0, Math.round(num(l.area, 0))) };
  }

  /** Valida um registro lido do localStorage ou de um arquivo. Devolve null se não serve. */
  function sanitizeRecord(raw) {
    if (!raw || typeof raw !== 'object' || !raw.result || typeof raw.result !== 'object') return null;
    var r = raw.result;
    if (!Array.isArray(r.steps)) return null;
    var links = [], seen = Object.create(null), bad = false;
    var steps = r.steps.map(function (s) {
      if (!s || !isId(s.portal) || !Array.isArray(s.links)) { bad = true; return null; }
      var sl = s.links.map(sanitizeLink);
      for (var i = 0; i < sl.length; i++) {
        var l = sl[i];
        if (!l || l.from !== s.portal || seen[l.n]) { bad = true; return null; }
        seen[l.n] = true;
        links.push(Object.assign({}, l));
      }
      return { portal: s.portal, walk: Math.max(0, Math.round(num(s.walk, 0))), links: sl };
    }).filter(function (s) { return s && s.links.length; });
    if (bad || links.length > MAX_LINKS) return null;
    var fields = (Array.isArray(r.fields) ? r.fields : []).filter(function (f) {
      return f && Array.isArray(f.portals) && f.portals.length === 3 && f.portals.every(isId);
    }).slice(0, 2 * MAX_LINKS).map(function (f) { return { link: Math.round(num(f.link, 0)), portals: f.portals.slice(), area: Math.max(0, Math.round(num(f.area, 0))) }; });
    var keyRows = function (list, withMissing) {
      return (Array.isArray(list) ? list : []).filter(function (k) { return k && isId(k.portal); }).slice(0, MAX_LINKS).map(function (k) {
        var o = { portal: k.portal, need: Math.max(0, Math.round(num(k.need, 0))), have: Math.max(0, Math.round(num(k.have, 0))) };
        if (withMissing) o.missing = Math.max(0, Math.round(num(k.missing, 0)));
        else { o.used = Math.max(0, Math.round(num(k.used, 0))); delete o.need; }
        return o;
      });
    };
    var result = {
      ok: true,
      strategy: ['fanfield', 'triangulacao', 'multicamada'].indexOf(r.strategy) >= 0 ? r.strategy : null,
      anchor: isId(r.anchor) ? r.anchor : null,
      anchors: Array.isArray(r.anchors) && r.anchors.length && r.anchors.length <= 10 && r.anchors.every(isId) ? r.anchors.slice() : null,
      maxKeys: O.normMaxKeys(r.maxKeys),
      base: Array.isArray(r.base) && r.base.length === 2 && r.base.every(isId) ? r.base.slice() : null,
      layers: Math.max(0, Math.round(num(r.layers, 0))),
      candidates: Math.max(0, Math.round(num(r.candidates, 0))),
      inRadius: Math.max(0, Math.round(num(r.inRadius, 0))),
      candidateIds: (Array.isArray(r.candidateIds) ? r.candidateIds : []).filter(isId).slice(0, MAX_LINKS),
      steps: steps, links: links, fields: fields,
      distance: Math.max(0, Math.round(num(r.distance, 0))),
      ap: Math.max(0, Math.round(num(r.ap, 0))),
      area: Math.max(0, Math.round(num(r.area, 0))),
      simulation: !!r.simulation,
      keysUsed: keyRows(r.keysUsed, false),
      keysMissing: keyRows(r.keysMissing, true),
      potentialFields: Math.max(0, Math.round(num(r.potentialFields, 0))),
      maxKeyDemand: r.maxKeyDemand && isId(r.maxKeyDemand.portal) ? { portal: r.maxKeyDemand.portal, need: Math.max(0, Math.round(num(r.maxKeyDemand.need, 0))) } : null,
      elapsedMs: Math.max(0, Math.round(num(r.elapsedMs, 0))),
      reason: '',
      origin: ll(r.origin) || ll(raw.origin)
    };
    var positions = Object.create(null);
    if (raw.positions && typeof raw.positions === 'object') Object.keys(raw.positions).slice(0, 2 * MAX_LINKS).forEach(function (id) {
      var v = raw.positions[id];
      if (isId(id) && Array.isArray(v) && ll({ lat: v[0], lng: v[1] })) positions[id] = [+v[0], +v[1]];
    });
    var s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    return {
      v: RECORD_V,
      ts: Math.max(0, num(raw.ts, 0)),
      appVersion: String(raw.appVersion || '').slice(0, 20),
      pinned: !!raw.pinned,
      origin: result.origin,
      settings: {
        radius: Math.round(num(s.radius, 0)) || null, maxOut: Math.round(num(s.maxOut, 0)) || null, maxKeys: O.normMaxKeys(s.maxKeys),
        objective: typeof s.objective === 'string' ? s.objective.slice(0, 20) : null,
        strategy: typeof s.strategy === 'string' ? s.strategy.slice(0, 20) : null, simulate: !!s.simulate
      },
      candidates: (Array.isArray(raw.candidates) ? raw.candidates : []).filter(isId).slice(0, MAX_LINKS),
      positions: positions,
      result: result
    };
  }

  /**
   * Chaves ao vivo, a partir das chaves atuais dos portais (não do retrato do cálculo).
   * used: quantos links restantes do plano chegam em cada portal (= chaves que o plano gasta).
   * missing: portais com menos chaves que o necessário. extra: chaves para os campos a mais que o
   * otimizador apontou num plano real (retrato de need, chaves de agora).
   */
  function keyNeeds(result, portals) {
    var have = Object.create(null);
    (portals || []).forEach(function (p) { have[p.id] = Math.max(0, Math.floor(Number(p.chaves) || 0)); });
    var order = [], used = Object.create(null);
    (result.links || []).forEach(function (l) {
      if (!(l.to in used)) { used[l.to] = 0; order.push(l.to); }
      used[l.to]++;
    });
    var rows = order.map(function (id) { return { portal: id, used: used[id], have: have[id] || 0 }; });
    var missing = rows.filter(function (r) { return r.used > r.have; })
      .map(function (r) { return { portal: r.portal, need: r.used, have: r.have, missing: r.used - r.have }; });
    var extra = result.simulation ? [] : (result.keysMissing || []).map(function (k) {
      var h = have[k.portal] || 0;
      return { portal: k.portal, need: k.need, have: h, missing: k.need - h };
    }).filter(function (k) { return k.missing > 0; });
    var total = missing.reduce(function (a, k) { return a + k.missing; }, 0);
    // maior demanda de chaves de um único portal (links do plano ou da lista "mais campos")
    var demand = null;
    rows.forEach(function (r) { if (!demand || r.used > demand.need) demand = { portal: r.portal, need: r.used }; });
    extra.forEach(function (k) { if (!demand || k.need > demand.need) demand = { portal: k.portal, need: k.need }; });
    return { used: rows, missing: missing, totalMissing: total, extra: extra, demand: demand };
  }

  /** Número do passo (1…) de cada link restante. */
  function stepOfLink(result) {
    var m = Object.create(null);
    (result.steps || []).forEach(function (s, i) { s.links.forEach(function (l) { m[l.n] = i + 1; }); });
    return m;
  }

  /**
   * Valida o plano salvo contra os dados atuais, sem recalcular: refaz os links restantes, na mesma ordem,
   * sobre o estado atual (bloqueadores, links feitos, pares falhos, portais sob campo, limite de saída).
   * data: { portals, blockers, done, excluded, coveredManual, maxOut, maxKeys }
   * opts.useKeys: true confere também as chaves de agora (para executar em campo); senão só a geometria.
   * Devolve { ok, issues: [{ n, step, kind, text }], steps: [passos afetados] }.
   */
  function validate(rec, data, opts) {
    var result = rec.result, useKeys = !!(opts && opts.useKeys);
    var issues = [], stepOf = stepOfLink(result);
    var byId = Object.create(null);
    (data.portals || []).forEach(function (p) { byId[p.id] = p; });
    var name = function (id) { return byId[id] ? byId[id].nome : '(removido)'; };
    var add = function (l, kind, text) { issues.push({ n: l ? l.n : null, step: l ? stepOf[l.n] || null : null, kind: kind, text: text }); };

    // portais do plano excluídos ou movidos
    var gone = Object.create(null), moved = Object.create(null);
    planPortalIds(result).forEach(function (id) {
      var p = byId[id];
      if (!p) { gone[id] = true; return; }
      var was = rec.positions && rec.positions[id];
      if (was) {
        var d = G.haversine({ lat: was[0], lng: was[1] }, p);
        if (d > MOVE_WARN_M) moved[id] = Math.round(d);
      }
    });

    var world = O._internal.buildWorld({
      portals: data.portals || [], blockers: data.blockers, done: data.done, excluded: data.excluded,
      coveredManual: data.coveredManual, position: rec.origin || result.origin || null,
      radius: 1e9, maxOut: data.maxOut, maxKeys: data.maxKeys, ignoreKeys: !useKeys, maxCandidates: 3
    });
    var st = new O._internal.State(world), P = world.pts;

    (result.steps || []).forEach(function (s) {
      s.links.forEach(function (l) {
        var lost = [l.from, l.to].filter(function (id) { return gone[id]; });
        if (lost.length) { add(l, 'removido', 'portal excluído: ' + lost.join(', ')); return; }
        [l.from, l.to].forEach(function (id) {
          if (moved[id] != null) add(l, 'movido', name(id) + ' foi movido ' + moved[id] + ' m');
        });
        var a = world.idx[l.from], b = world.idx[l.to];
        var why = st.whyNot(a, b);
        if (why === 'cruza link') {
          var hit = null;
          for (var i = 0; i < st.links.length && !hit; i++) {
            var x = st.links[i];
            if (G.segmentsCross(P[a], P[b], P[x.a], P[x.b])) hit = x;
          }
          var what = !hit ? 'um link' : hit.kind === 'enemy' ? 'o bloqueador inimigo ' : hit.kind === 'ally' ? 'o bloqueador aliado ' :
            hit.kind === 'own' ? 'o link feito ' : 'o link do plano ';
          add(l, hit && (hit.kind === 'enemy' || hit.kind === 'ally') ? 'bloqueador' : 'cruza',
            'cruza ' + what + (hit ? P[hit.a].nome + ' – ' + P[hit.b].nome : ''));
          return;
        }
        if (why === 'cruza segmento') { add(l, 'bloqueador', 'cruza um bloqueador de print (segmento com ponta fora do print)'); return; }
        if (why === 'limite de chaves por portal') { add(l, 'chave', name(l.to) + ' passaria de ' + world.maxKeys + ' chaves por portal (Máx. chaves por portal)'); return; }
        if (why === 'sem chave do destino') { add(l, 'chave', 'sem chave de ' + name(l.to) + ' para este link'); return; }
        if (why) { add(l, 'invalido', why); return; }
        var made = st.addLink(a, b).length;
        if (made < l.fields) add(l, 'campos', 'fecha ' + made + ' campo(s) em vez de ' + l.fields);
      });
    });
    var steps = [];
    issues.forEach(function (x) { if (x.step && steps.indexOf(x.step) < 0) steps.push(x.step); });
    steps.sort(function (x, y) { return x - y; });
    return { ok: !issues.length, issues: issues, steps: steps };
  }

  /**
   * Sai da simulação sem recalcular: mesma ordem e mesmos links, revalidados com as chaves reais.
   * Só converte se tudo passa; senão devolve os problemas e não mexe no registro.
   */
  function toFieldPlan(rec, data) {
    var v = validate(rec, data, { useKeys: true });
    // portal movido sem quebrar nenhum link continua executável: o replay já usa as posições de agora
    var blocking = v.issues.filter(function (x) { return x.kind !== 'movido'; });
    if (blocking.length) return { ok: false, issues: blocking, steps: v.steps };
    var r = rec.result;
    r.simulation = false;
    r.keysMissing = [];
    r.potentialFields = r.fields.length;
    var k = keyNeeds(r, data.portals);
    r.keysUsed = k.used.map(function (x) { return { portal: x.portal, used: x.used, have: x.have }; });
    rec.settings.simulate = false;
    return { ok: true, issues: v.issues, steps: v.steps };
  }

  /**
   * Motivo de um recálculo automático, ou null se não deve recalcular. Plano fixado: sempre null.
   * ev.type: 'gps' { fieldMode, lastPos, moved }, 'timer' { fieldMode, elapsedMs },
   * ou qualquer outro gatilho automático ('dados', 'simulacao', 'campo', 'link'…) com ev.reason.
   */
  function autoRecalcReason(rec, ev) {
    if (!rec || !rec.result || rec.pinned) return null;
    if (ev.type === 'gps') {
      if (!ev.fieldMode) return null;
      if (!ev.lastPos) return 'GPS disponível';
      return ev.moved > MOVE_RECALC_M ? 'você se moveu mais de ' + MOVE_RECALC_M + ' m' : null;
    }
    if (ev.type === 'timer') return ev.fieldMode && ev.elapsedMs >= PERIODIC_RECALC_MS ? '5 minutos desde o último cálculo' : null;
    return ev.reason || ev.type;
  }

  /**
   * Conteúdo do JSON exportado. Lista fechada de campos: chave da API, preferências de "Nomear por print" e
   * qualquer outra coisa fora do db nunca entram. As observações de prints (lista de chaves) só entram quando o
   * usuário escolhe na hora de exportar (opts.observacoes), para juntar as leituras de dois aparelhos.
   */
  function exportPayload(db, now, opts) {
    var out = {
      app: 'field-planner', version: 1, exportedAt: new Date(now || Date.now()).toISOString(),
      portals: db.portals, blockers: db.blockers, done: db.done, excluded: db.excluded, coveredManual: db.coveredManual,
      settings: db.settings, plan: db.plan
    };
    if (opts && Array.isArray(opts.observacoes) && opts.observacoes.length) {
      // só os campos de uma observação, nunca outro dado que esteja pendurado nela
      out.observacoes = opts.observacoes.map(function (o) {
        return { nome: o.nome, endereco: o.endereco == null ? null : o.endereco, distancia_m: o.distancia_m, nivel: o.nivel == null ? null : o.nivel,
          chaves: o.chaves == null ? null : o.chaves, origem: { lat: o.origem.lat, lng: o.origem.lng, precisao: o.origem.precisao || 0 }, ts: o.ts || 0 };
      });
    }
    return out;
  }

  function clampInt(v, lo, hi, def) {
    var n = Math.round(Number(v));
    if (v === null || v === '' || !isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
  }

  /** Ajustes vindos de um JSON importado, sobre os atuais. maxKeys ausente → 8 (padrão), não o valor atual. */
  function importSettings(st, cur) {
    st = st && typeof st === 'object' ? st : {};
    return {
      radius: clampInt(st.radius, 100, 100000, cur.radius),
      maxOut: clampInt(st.maxOut, 1, 40, cur.maxOut),
      maxKeys: clampInt(st.maxKeys, 1, O.MAX_KEYS_HI, O.MAX_KEYS),
      objective: ['campos', 'ap', 'distancia', 'mu'].indexOf(st.objective) >= 0 ? st.objective : cur.objective,
      simulate: typeof st.simulate === 'boolean' ? st.simulate : cur.simulate,
      strategy: ['auto', 'fanfield', 'triangulacao', 'multicamada'].indexOf(st.strategy) >= 0 ? st.strategy : cur.strategy
    };
  }

  return {
    exportPayload: exportPayload,
    importSettings: importSettings,
    RECORD_V: RECORD_V, MOVE_WARN_M: MOVE_WARN_M, MOVE_RECALC_M: MOVE_RECALC_M, PERIODIC_RECALC_MS: PERIODIC_RECALC_MS,
    autoRecalcReason: autoRecalcReason,
    makeRecord: makeRecord, sanitizeRecord: sanitizeRecord, keyNeeds: keyNeeds,
    validate: validate, toFieldPlan: toFieldPlan, planPortalIds: planPortalIds
  };
});
