/*
 * Field Planner — otimizador.
 * Função pura optimize(input) → plano. Roda dentro do Web Worker (worker.js) e nos testes (Node).
 * Sem DOM, sem rede, sem relógio externo além de Date.now() para o orçamento de tempo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'));
  else root.FPOptimizer = factory(root.FPGeo);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var AP_LINK = 313;
  var AP_FIELD = 1250;
  var INF_KEYS = 1e6;
  var MAX_CAND = 30;
  var FAR_M = 8.9e6; // ~80° de arco // portais considerados por cálculo (os demais ficam de fora do plano)

  function pairKey(i, j) { return i < j ? i + '|' + j : j + '|' + i; }

  /* ------------------------------------------------------------------ */
  /* Mundo: portais projetados, links existentes e campos já presentes. */
  /* ------------------------------------------------------------------ */

  function buildWorld(input) {
    var portals = (input.portals || []).filter(function (p) { return p && typeof p.id === 'string'; });
    var ref = input.position || (portals.length ? G.centroid(portals) : { lat: 0, lng: 0 });
    var proj = G.makeProjection(ref);
    var idx = Object.create(null); // sem protótipo: ids como "constructor" não colidem
    var pts = portals.map(function (p, i) {
      idx[p.id] = i;
      var xy = proj.toXY(p);
      return {
        id: p.id, nome: p.nome, lat: p.lat, lng: p.lng, x: xy.x, y: xy.y,
        level: Math.max(1, Math.min(8, Math.round(Number(p.nivel) || 1))),
        keys: Math.max(0, Math.floor(Number(p.chaves) || 0))
      };
    });

    // Links fixos: bloqueadores inimigos/aliados + links que o próprio usuário já fez.
    pts.forEach(function (p) {
      p.dist0 = G.haversine(ref, p);
      // a projeção gnomônica só vale até 90° da referência: além de ~80° o portal fica fora da conta
      p.far = p.dist0 > FAR_M;
    });

    var fixed = [];
    (input.blockers || []).forEach(function (b) {
      if (idx[b.portalA] === undefined || idx[b.portalB] === undefined || b.portalA === b.portalB) return;
      if (pts[idx[b.portalA]].far || pts[idx[b.portalB]].far) return;
      fixed.push({ a: idx[b.portalA], b: idx[b.portalB], kind: b.origem === 'aliado' ? 'ally' : 'enemy' });
    });
    (input.done || []).forEach(function (d) {
      if (idx[d.from] === undefined || idx[d.to] === undefined || d.from === d.to) return;
      if (pts[idx[d.from]].far || pts[idx[d.to]].far) return;
      fixed.push({ a: idx[d.from], b: idx[d.to], kind: 'own' });
    });

    var excluded = Object.create(null);
    (input.excluded || []).forEach(function (e) {
      if (idx[e.from] !== undefined && idx[e.to] !== undefined) excluded[pairKey(idx[e.from], idx[e.to])] = true;
    });

    var radius = Number(input.radius) > 0 ? Number(input.radius) : 1500;
    var candidates = [];
    pts.forEach(function (p, i) {
      if (!p.far && (!input.position || p.dist0 <= radius)) candidates.push(i);
    });
    // Muitos portais no raio (ex.: lista importada com centenas de pontos) deixariam a busca
    // impraticável. Fica com os MAX_CAND mais úteis: primeiro os que têm chave, depois os mais próximos.
    var inRadius = candidates.length;
    var maxCand = Math.max(3, Math.floor(Number(input.maxCandidates) || MAX_CAND));
    if (candidates.length > maxCand) {
      candidates.sort(function (a, b) {
        var ka = !input.ignoreKeys && pts[a].keys > 0 ? 0 : 1, kb = !input.ignoreKeys && pts[b].keys > 0 ? 0 : 1;
        return ka - kb || pts[a].dist0 - pts[b].dist0;
      });
      candidates = candidates.slice(0, maxCand);
    }

    // Portais que o usuário marcou em campo como "sob campo" (campo desconhecido pelo app).
    var forcedCovered = (input.coveredManual || []).map(function (id) { return idx[id]; })
      .filter(function (i) { return i !== undefined; });

    return {
      pts: pts, idx: idx, fixed: fixed, excluded: excluded, candidates: candidates, forcedCovered: forcedCovered, inRadius: inRadius,
      position: input.position || null,
      maxOut: Math.max(1, Math.floor(Number(input.maxOut) || 8)),
      ignoreKeys: !!input.ignoreKeys
    };
  }

  /* Estado mutável de uma simulação. */
  function State(world) {
    var n = world.pts.length;
    this.w = world;
    this.links = [];               // {a,b,kind}
    this.pairs = Object.create(null); // pairKey -> true
    this.friendAdj = [];           // vizinhos via links da nossa facção (ally/own/plan)
    this.out = new Array(n).fill(0);
    this.keysLeft = world.pts.map(function (p) { return world.ignoreKeys ? INF_KEYS : p.keys; });
    this.keysUsed = new Array(n).fill(0);
    this.cover = [];               // triângulos que cobrem portais (todas as facções)
    this.covered = new Array(n).fill(false);
    this.planLinks = [];           // {from,to,fields:[[i,j,k]]}
    this.planFields = [];
    this.area = 0;                 // soma das áreas dos campos planejados (m²) — proxy de MU
    for (var i = 0; i < n; i++) this.friendAdj.push({});
    for (i = 0; i < world.forcedCovered.length; i++) this.covered[world.forcedCovered[i]] = true;

    var self = this;
    world.fixed.forEach(function (l) { self._pushLink(l.a, l.b, l.kind); if (l.kind === 'own') self.out[l.a]++; });
    // Campos pré-existentes: triângulos fechados por links da mesma facção (aproximação).
    var enemyAdj = [];
    for (i = 0; i < n; i++) enemyAdj.push({});
    world.fixed.forEach(function (l) { if (l.kind === 'enemy') { enemyAdj[l.a][l.b] = 1; enemyAdj[l.b][l.a] = 1; } });
    [this.friendAdj, enemyAdj].forEach(function (adj) {
      for (var a = 0; a < n; a++) for (var b in adj[a]) {
        b = +b; if (b <= a) continue;
        for (var c in adj[b]) { c = +c; if (c <= b) continue; if (adj[a][c]) self._addCover([a, b, c]); }
      }
    });
  }

  State.prototype._pushLink = function (a, b, kind) {
    this.links.push({ a: a, b: b, kind: kind });
    this.pairs[pairKey(a, b)] = true;
    if (kind !== 'enemy') { this.friendAdj[a][b] = 1; this.friendAdj[b][a] = 1; }
  };

  State.prototype._addCover = function (tri) {
    this.cover.push(tri);
    var P = this.w.pts, A = P[tri[0]], B = P[tri[1]], C = P[tri[2]];
    for (var i = 0; i < P.length; i++) {
      if (!this.covered[i] && G.pointInTriangle(P[i], A, B, C)) this.covered[i] = true;
    }
  };

  /** Motivo pelo qual s→t é inválido, ou null se o link é possível. */
  State.prototype.whyNot = function (s, t) {
    var w = this.w, P = w.pts;
    if (s === t) return 'mesmo portal';
    if (this.covered[s]) return 'origem sob campo';
    if (this.pairs[pairKey(s, t)]) return 'link já existe';
    if (w.excluded[pairKey(s, t)]) return 'par marcado como falho';
    if (this.out[s] >= w.maxOut) return 'limite de links de saída';
    if (this.keysLeft[t] <= 0) return 'sem chave do destino';
    var d = G.haversine(P[s], P[t]); // distância real (a projeção estica longe do centro)
    if (d < 1) return 'portais na mesma posição';
    if (d > G.linkRange(P[s].level)) return 'fora do alcance';
    for (var i = 0; i < this.links.length; i++) {
      var l = this.links[i];
      if (G.segmentsCross(P[s], P[t], P[l.a], P[l.b])) return 'cruza link';
    }
    return null;
  };

  /** Campos que o link s–t fecharia: o maior de cada lado (comportamento do jogo). */
  State.prototype.fieldsFor = function (s, t) {
    var P = this.w.pts, best = { 1: null, '-1': null }, bestA = { 1: 0, '-1': 0 };
    var adjS = this.friendAdj[s], adjT = this.friendAdj[t];
    for (var c in adjS) {
      c = +c;
      if (!adjT[c]) continue;
      var o = G.orient(P[s], P[t], P[c]);
      if (o === 0) continue;
      var side = o > 0 ? 1 : -1, area = Math.abs(o) / 2;
      if (area > bestA[side]) { bestA[side] = area; best[side] = [s, t, c]; }
    }
    var res = [];
    if (best[1]) res.push(best[1]);
    if (best['-1']) res.push(best['-1']);
    return res;
  };

  State.prototype.addLink = function (s, t) {
    var fields = this.fieldsFor(s, t);
    this._pushLink(s, t, 'plan');
    this.out[s]++;
    this.keysLeft[t]--;
    this.keysUsed[t]++;
    var self = this;
    var P = this.w.pts;
    fields.forEach(function (f) {
      self._addCover(f);
      self.planFields.push(f);
      self.area += G.triangleArea(P[f[0]], P[f[1]], P[f[2]]);
    });
    this.planLinks.push({ from: s, to: t, fields: fields });
    return fields;
  };

  /* ------------------------------------------------------------------ */
  /* Simulação de uma ordem de visitas sob uma política de links.        */
  /* ------------------------------------------------------------------ */

  function simulate(world, order, policy) {
    var st = new State(world);
    var P = world.pts;
    var visited = {};
    var visitOrder = [];
    var steps = [];
    order.forEach(function (s) {
      var made = [];
      if (!st.covered[s]) {
        if (policy.type === 'layers') {
          // multicamada: cada visita tem destinos fixos (A→B na base; Ci→A e Ci→B nas camadas)
          (policy.targets[s] || []).forEach(function (t) {
            if (st.whyNot(s, t) === null) made.push({ to: t, fields: st.addLink(s, t) });
          });
        } else if (policy.type === 'fan') {
          var prio = [policy.anchor];
          for (var k = steps.length - 1; k >= 0; k--) prio.push(steps[k].portal);
          // portais visitados sem links também servem como destino
          for (var vi = visitOrder.length - 1; vi >= 0; vi--) if (prio.indexOf(visitOrder[vi]) < 0) prio.push(visitOrder[vi]);
          prio.forEach(function (t) {
            if (t !== s && st.whyNot(s, t) === null) made.push({ to: t, fields: st.addLink(s, t) });
          });
        } else {
          // gulosa: a cada iteração escolhe o melhor link válido a partir de s
          for (;;) {
            var bestT = -1, bestScore = -Infinity;
            for (var ci = 0; ci < world.candidates.length; ci++) {
              var t = world.candidates[ci];
              if (t === s || st.whyNot(s, t) !== null) continue;
              var ff = st.fieldsFor(s, t), nf = ff.length;
              if (nf === 0 && !visited[t]) continue; // evita links "soltos" para portais ainda não visitados
              var len = Math.hypot(P[s].x - P[t].x, P[s].y - P[t].y);
              var gain = nf * 1e6;
              if (world.objective === 'mu') {
                gain = 0;
                for (var fi = 0; fi < nf; fi++) gain += G.triangleArea(P[ff[fi][0]], P[ff[fi][1]], P[ff[fi][2]]) * 10 + 1;
              }
              var score = gain + (visited[t] ? 1e3 : 0) - len;
              if (score > bestScore) { bestScore = score; bestT = t; }
            }
            if (bestT < 0) break;
            made.push({ to: bestT, fields: st.addLink(s, bestT) });
          }
        }
      }
      visited[s] = true;
      visitOrder.push(s);
      if (made.length) steps.push({ portal: s, links: made });
    });
    return finish(world, st, steps);
  }

  function finish(world, st, steps) {
    var P = world.pts;
    var dist = 0, prev = world.position;
    steps.forEach(function (step) {
      var p = P[step.portal];
      step.walk = prev ? G.haversine(prev, p) : 0;
      dist += step.walk;
      prev = p;
    });
    var nLinks = st.planLinks.length, nFields = st.planFields.length;
    return {
      steps: steps, state: st, distance: dist,
      links: nLinks, fields: nFields, ap: nLinks * AP_LINK + nFields * AP_FIELD, area: st.area
    };
  }

  function score(res, objective) {
    if (objective === 'ap') return res.ap * 100 - res.distance;
    // MU = área × densidade local (desconhecida): dentro de uma mesma região, mais área ≈ mais MU
    if (objective === 'mu') return res.area - res.distance * 1e-3; // área decide; caminhada só desempata
    if (objective === 'distancia') return res.ap / (res.distance + 300) + res.fields * 1e-6;
    return res.fields * 1e6 + res.links - res.distance / 1e3; // 'campos' (padrão)
  }

  /* ------------------------------------------------------------------ */
  /* Rota a pé: vizinho mais próximo + 2-opt (caminho aberto).            */
  /* ------------------------------------------------------------------ */

  function routeLength(world, order) {
    var P = world.pts, d = 0, prev = world.position;
    for (var i = 0; i < order.length; i++) { if (prev) d += G.haversine(prev, P[order[i]]); prev = P[order[i]]; }
    return d;
  }

  function nearestNeighbor(world, ids) {
    var P = world.pts, left = ids.slice(), order = [];
    var cur = world.position || (left.length ? P[left[0]] : null);
    while (left.length) {
      var bi = 0, bd = Infinity;
      for (var i = 0; i < left.length; i++) {
        var d = G.haversine(cur, P[left[i]]);
        if (d < bd) { bd = d; bi = i; }
      }
      cur = P[left[bi]];
      order.push(left.splice(bi, 1)[0]);
    }
    return order;
  }

  function twoOpt(world, order) {
    var best = order.slice(), bestLen = routeLength(world, best), improved = true, guard = 0;
    while (improved && guard++ < 200) {
      improved = false;
      for (var i = 0; i < best.length - 1; i++) {
        for (var k = i + 1; k < best.length; k++) {
          var cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          var len = routeLength(world, cand);
          if (len + 1e-6 < bestLen) { best = cand; bestLen = len; improved = true; }
        }
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Estratégias.                                                         */
  /* ------------------------------------------------------------------ */

  /** Ordena os demais portais por ângulo em torno da âncora, começando após o maior vão. */
  function angularOrder(world, anchor, ids) {
    var P = world.pts, A = P[anchor];
    var arr = ids.filter(function (i) { return i !== anchor; }).map(function (i) {
      return { i: i, ang: Math.atan2(P[i].y - A.y, P[i].x - A.x) };
    }).sort(function (a, b) { return a.ang - b.ang; });
    if (arr.length < 2) return arr.map(function (o) { return o.i; });
    var gapAt = 0, gap = -1;
    for (var k = 0; k < arr.length; k++) {
      var next = k + 1 < arr.length ? arr[k + 1].ang : arr[0].ang + 2 * Math.PI;
      if (next - arr[k].ang > gap) { gap = next - arr[k].ang; gapAt = k + 1; }
    }
    return arr.slice(gapAt).concat(arr.slice(0, gapAt)).map(function (o) { return o.i; });
  }

  function fanfieldPlans(world, consider, deadline) {
    var ids = world.candidates;
    // âncoras com mais chaves primeiro: são as que rendem fan; para no prazo
    var anchors = ids.slice().sort(function (a, b) { return world.pts[b].keys - world.pts[a].keys; });
    anchors.forEach(function (anchor, k) {
      if (k > 0 && Date.now() >= deadline) return;
      var ord = angularOrder(world, anchor, ids);
      [ord, ord.slice().reverse()].forEach(function (o) {
        consider(simulate(world, o, { type: 'fan', anchor: anchor }), 'fanfield', o, { type: 'fan', anchor: anchor });
      });
    });
  }

  /*
   * Multicamada: base A–B e, de cada lado, a maior cadeia de portais encaixados C1 ⊃ C2 ⊃ … ⊃ Cn
   * (cada Ci dentro do triângulo A-B-C(i−1)). Executa do miolo para fora: A→B, depois Cn→A, Cn→B, …,
   * C1→A, C1→B. Assim nenhum Ci está sob campo quando linka, e cada camada empilha sobre a anterior.
   * Peso da cadeia: 1 por camada, ou a área da camada no objetivo 'mu' (cada camada conta MU de novo).
   */
  function layerChain(world, A, B, side) {
    var P = world.pts, pa = P[A], pb = P[B];
    var cand = world.candidates.filter(function (i) {
      return i !== A && i !== B && Math.sign(G.orient(pa, pb, P[i])) === side;
    }).map(function (i) { return { i: i, area: G.triangleArea(pa, pb, P[i]) }; })
      .sort(function (x, y) { return y.area - x.area; }); // de fora para dentro
    var w = function (c) { return world.objective === 'mu' ? c.area : 1; };
    var dp = [], prev = [], best = -1;
    for (var k = 0; k < cand.length; k++) {
      dp[k] = w(cand[k]); prev[k] = -1;
      for (var j = 0; j < k; j++) {
        // cand[k] precisa estar dentro do triângulo da camada externa cand[j]
        if (dp[j] + w(cand[k]) > dp[k] && G.pointInTriangle(P[cand[k].i], pa, pb, P[cand[j].i])) {
          dp[k] = dp[j] + w(cand[k]); prev[k] = j;
        }
      }
      if (best < 0 || dp[k] > dp[best]) best = k;
    }
    var chain = [];
    for (var c = best; c >= 0; c = prev[c]) chain.push(cand[c].i); // do miolo para fora
    return chain;
  }

  function layerPlans(world, consider, deadline) {
    var ids = world.candidates;
    for (var a = 0; a < ids.length; a++) {
      for (var b = a + 1; b < ids.length; b++) {
        if ((a > 0 || b > 1) && Date.now() >= deadline) return;
        var A = ids[a], B = ids[b];
        [[A, B], [B, A]].forEach(function (pair) {
          var s = pair[0], t = pair[1];
          var left = layerChain(world, s, t, 1), right = layerChain(world, s, t, -1);
          if (!left.length && !right.length) return;
          var targets = {}; targets[s] = [t];
          left.concat(right).forEach(function (c) { targets[c] = [s, t]; });
          var order = [s].concat(left, right);
          var policy = { type: 'layers', targets: targets, base: [s, t], layers: left.length + right.length };
          consider(simulate(world, order, policy), 'multicamada', order, policy);
        });
      }
    }
  }

  function permutations(arr, cb) {
    var a = arr.slice(), n = a.length, c = new Array(n).fill(0), i = 0;
    if (cb(a.slice()) === false) return;
    while (i < n) {
      if (c[i] < i) {
        var j = i % 2 ? c[i] : 0, tmp = a[j]; a[j] = a[i]; a[i] = tmp;
        if (cb(a.slice()) === false) return;
        c[i]++; i = 0;
      } else { c[i] = 0; i++; }
    }
  }

  function triangulationPlans(world, consider, deadline) {
    var ids = world.candidates;
    var seed = twoOpt(world, nearestNeighbor(world, ids));
    var policy = { type: 'greedy' };
    consider(simulate(world, seed, policy), 'triangulacao', seed, policy);
    if (ids.length > 12) return;

    if (ids.length <= 7) {
      // busca exaustiva (≤ 5040 ordens)
      permutations(ids, function (o) {
        consider(simulate(world, o, policy), 'triangulacao', o, policy);
        return Date.now() < deadline;
      });
      return;
    }
    // busca local limitada: trocas e reinserções a partir da melhor ordem até o prazo
    var cur = seed, curRes = simulate(world, cur, policy), rnd = mulberry32(ids.length * 7919 + 17);
    while (Date.now() < deadline) {
      var o = cur.slice(), i = Math.floor(rnd() * o.length), j = Math.floor(rnd() * o.length);
      if (i === j) continue;
      if (rnd() < 0.5) { var t = o[i]; o[i] = o[j]; o[j] = t; } else o.splice(j, 0, o.splice(i, 1)[0]);
      var r = simulate(world, o, policy);
      consider(r, 'triangulacao', o, policy);
      if (score(r, world.objective) >= score(curRes, world.objective)) { cur = o; curRes = r; }
    }
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ */
  /* Entrada principal.                                                   */
  /* ------------------------------------------------------------------ */

  function optimize(input) {
    var t0 = Date.now();
    var world = buildWorld(input);
    world.objective = input.objective || 'campos';
    var budget = Number(input.timeBudgetMs) > 0 ? Number(input.timeBudgetMs) : 1500;
    var deadline = t0 + budget;
    var strategy = input.strategy || 'auto';

    var best = null;
    function consider(res, name, order, policy) {
      var sc = score(res, world.objective);
      if (!best || sc > best.score) best = { res: res, score: sc, strategy: name, order: order, policy: policy };
    }

    if (world.candidates.length >= 2) {
      // no modo automático cada estratégia usa até 1/3 do orçamento; a triangulação fica com o resto
      var fanDeadline = strategy === 'auto' ? t0 + budget / 3 : deadline;
      var layerDeadline = strategy === 'auto' ? t0 + 2 * budget / 3 : deadline;
      if (strategy === 'auto' || strategy === 'fanfield') fanfieldPlans(world, consider, fanDeadline);
      if (strategy === 'auto' || strategy === 'multicamada') layerPlans(world, consider, layerDeadline);
      if (strategy === 'auto' || strategy === 'triangulacao') triangulationPlans(world, consider, deadline);
    }

    var out = {
      ok: true,
      strategy: best ? best.strategy : null,
      anchor: best && best.policy.type === 'fan' ? world.pts[best.policy.anchor].id : null,
      base: best && best.policy.type === 'layers' ? best.policy.base.map(function (i) { return world.pts[i].id; }) : null,
      layers: best && best.policy.type === 'layers' ? best.res.fields : 0,
      candidates: world.candidates.length,
      candidateIds: world.candidates.map(function (i) { return world.pts[i].id; }),
      inRadius: world.inRadius,
      steps: [], links: [], fields: [], distance: 0, ap: 0, area: 0, simulation: !!input.ignoreKeys,
      keysUsed: [], keysMissing: [], potentialFields: 0,
      elapsedMs: 0
    };
    if (!best) { out.elapsedMs = Date.now() - t0; return out; }

    var P = world.pts, res = best.res, n = 0;
    out.steps = res.steps.map(function (st) {
      return {
        portal: P[st.portal].id,
        walk: Math.round(st.walk),
        links: st.links.map(function (l) {
          n++;
          var link = {
            n: n, from: P[st.portal].id, to: P[l.to].id, fields: l.fields.length,
            area: Math.round(l.fields.reduce(function (a, f) { return a + G.triangleArea(P[f[0]], P[f[1]], P[f[2]]); }, 0))
          };
          out.links.push(link);
          l.fields.forEach(function (f) {
            out.fields.push({ link: n, portals: f.map(function (i) { return P[i].id; }), area: Math.round(G.triangleArea(P[f[0]], P[f[1]], P[f[2]])) });
          });
          return link;
        })
      };
    });
    out.distance = Math.round(res.distance);
    out.area = Math.round(res.area);
    out.simulation = world.ignoreKeys;
    out.ap = res.ap;
    res.state.keysUsed.forEach(function (k, i) {
      if (k > 0) out.keysUsed.push({ portal: P[i].id, used: k, have: P[i].keys });
    });
    // Simulação: o plano ignorou as chaves; a lista de farm diz quantas faltam de cada portal.
    if (world.ignoreKeys) {
      out.keysUsed.forEach(function (k) {
        if (k.used > k.have) out.keysMissing.push({ portal: k.portal, need: k.used, have: k.have, missing: k.used - k.have });
      });
      out.potentialFields = res.fields;
    }

    // Chaves faltantes: mesma ordem/política, sem limite de chaves; compara a necessidade.
    if (!world.ignoreKeys) {
      var w2 = buildWorld(Object.assign({}, input, { ignoreKeys: true }));
      var free = simulate(w2, best.order, best.policy);
      out.potentialFields = free.fields;
      free.state.keysUsed.forEach(function (k, i) {
        if (k > P[i].keys) out.keysMissing.push({ portal: P[i].id, need: k, have: P[i].keys, missing: k - P[i].keys });
      });
    }
    out.elapsedMs = Date.now() - t0;
    return out;
  }

  return {
    optimize: optimize,
    // expostos para testes
    _internal: { layerChain: layerChain, buildWorld: buildWorld, State: State, simulate: simulate, nearestNeighbor: nearestNeighbor, twoOpt: twoOpt, angularOrder: angularOrder, routeLength: routeLength },
    AP_LINK: AP_LINK,
    AP_FIELD: AP_FIELD
  };
});
