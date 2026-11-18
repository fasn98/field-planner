/*
 * Field Planner — casamento de nomes lidos de prints com os portais do app.
 * Determinístico e sem rede: recebe a leitura já validada (printread.js) e os portais, devolve sugestões.
 * Nada aqui altera dados; quem aplica é o app, depois da confirmação do usuário.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'));
  else root.FPMatch = factory(root.FPGeo);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var R = 6371008.8, DEG = Math.PI / 180;
  var MAP_TOL_M = 40;          // print de mapa: distância máxima entre ponto ajustado e portal
  var MIN_INLIERS = 3;         // abaixo disso, o print de mapa não casa nada
  var NEAR_RING_M = 12;        // lista de chaves: ±(12 m + precisão do GPS + incerteza do portal)
  var FAR_RING_M = 60;         // ≥ 1 km (o jogo arredonda): mais 60 m, e nunca decide sozinho
  var FAR_AWAY_M = 5000;       // chave de portal a mais de 5 km: outra cidade, fica fora dos pendentes
  var UNREG_MAX_ERR_M = 150;   // portal potencial: posição estimada só com erro esperado até 150 m
  var PORTAL_UNC_EST_M = 20;   // portal com posição estimada ou nunca confirmada
  var PORTAL_UNC_OK_M = 5;     // portal confirmado
  var SAME_NAME = 0.85;        // similaridade mínima para "é o mesmo portal" 
  var DISTINCT_ORIGIN_M = 30;  // origens a menos disso contam como o mesmo ponto
  var TRILAT_MAX_RES_M = 15;   // resíduo máximo para sugerir "ajustar posição"
  var TRILAT_MAX_SIGMA_M = 10; // e erro esperado (1σ) pela geometria das origens
  var AUTO_ACCEPT = 0.8;       // confiança mínima para entrar no "aceitar todos acima de X%"

  /* ------------------------------------------------------------ */
  /* Texto: nomes e ruas.                                          */
  /* ------------------------------------------------------------ */

  /** Sem acento, minúsculas, espaços simples. Chave das observações. */
  function normName(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  var STREET_PREFIX = /^(rua|r|avenida|av|alameda|al|travessa|tv|trav|praca|pca|pc|estrada|estr|rodovia|rod|largo|lgo|viela|via|viaduto|marginal|parque|pq)\s+/;
  var STREET_STOP = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, dr: 1, doutor: 1, prof: 1, professor: 1, padre: 1, pe: 1, jorn: 1, jornalista: 1, eng: 1, sao: 1, santa: 1, santo: 1, gen: 1, cel: 1 };

  /** Palavras significativas do nome da rua: "R. Dr. José de Souza, 120 - Brooklin" → ["jose","souza"]. */
  function streetTokens(addr) {
    var s = normName(String(addr || '').split(/[,\-–]/)[0]).replace(/\b\d+\b/g, ' ').trim();
    s = s.replace(STREET_PREFIX, '');
    return s.split(' ').filter(function (w) { return w.length > 1 && !STREET_STOP[w]; });
  }

  /** Rua do endereço do print aparece no nome ou na observação do portal do app? null = não dá para dizer. */
  function streetCompatible(addr, portal) {
    var a = streetTokens(addr);
    if (!a.length) return null;
    var hay = ' ' + normName((portal.nome || '') + ' ' + (portal.observacao || '')) + ' ';
    // o nome provisório "BK 070 - R. Arizona" carrega a rua mais próxima: basta a palavra mais longa bater
    var key = a.slice().sort(function (x, y) { return y.length - x.length; })[0];
    return hay.indexOf(' ' + key + ' ') >= 0;
  }

  var STREET_IN_TEXT = /(^|[\s,(])(rua|r|avenida|av|alameda|al|travessa|tv|trav|pra[cç]a|p[cç]a|estrada|estr|rodovia|rod|largo|lgo|viela|viaduto|marginal)\.?\s+\S/i;

  /**
   * O portal do app diz em que rua está? Sufixo do nome ("… - R. X") ou, na observação, um campo explícito
   * ("Rua: …" / "Endereço: …"); texto livre como "perto da rua de trás" não conta. Sem isso, a rua não decide nada.
   */
  function portalStreetKnown(p) {
    var parts = String(p.nome || '').split(/\s+[-–]\s*|\s*[-–]\s+/);
    return (parts.length > 1 && STREET_IN_TEXT.test(' ' + parts.slice(1).join(' '))) || /\b(rua|endere[cç]o)\s*:\s*\S/i.test(p.observacao || '');
  }
  /** O endereço do print começa por uma rua ("R. …", "Av. …", "Alameda …")? "Shopping Morumbi, …" não. */
  function addressHasStreet(addr) {
    return STREET_IN_TEXT.test(' ' + String(addr || '').split(/[,\-–]/)[0].trim());
  }

  /** Nome provisório (gerado por importação): "BK 070 - …", "CB 12", "BW 5", "GJ 3", "ENS 05", "Portal 07", "Enseada 03 - …". */
  function isProvisional(nome) {
    var s = String(nome || '').trim();
    // só prefixos explícitos: "UBS 2", "CEU 3" e "EMEF 12 de Outubro" são nomes reais
    return /^(BK|CB|BW|GJ|ENS)\s?\d+/i.test(s) || /^Portal \d+$/i.test(s) || /^Enseada \d+\b/.test(s);
  }

  /* ------------------------------------------------------------ */
  /* Identidade por nome (antes de qualquer casamento por distância). */
  /* ------------------------------------------------------------ */

  var NAME_STOP = { da: 1, de: 1, do: 1, das: 1, dos: 1, a: 1, o: 1 };

  /** Palavras do nome sem o sufixo de rua: "Metas em Mente- Viaduto Santo Amaro" → ["metas","em","mente"]. */
  function nameTokens(nome) {
    // sufixo de rua: hífen com espaço de pelo menos um lado ("Mercedes-Benz" fica inteiro)
    var base = String(nome || '').split(/\s+[-–]\s*|\s*[-–]\s+/)[0];
    return normName(base).split(' ').filter(function (w) { return w.length > 1 && !NAME_STOP[w]; });
  }
  function nameKey(nome) { return nameTokens(nome).join(' '); }

  /** Jaro-Winkler entre duas palavras (0–1). */
  function jaroWinkler(a, b) {
    if (a === b) return 1;
    var la = a.length, lb = b.length;
    if (!la || !lb) return 0;
    var win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1), ma = [], mb = [], m = 0, i, j;
    for (i = 0; i < la; i++) {
      for (j = Math.max(0, i - win); j < Math.min(lb, i + win + 1); j++) {
        if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
      }
    }
    if (!m) return 0;
    var t = 0, k = 0;
    for (i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
    var jaro = (m / la + m / lb + (m - t / 2) / m) / 3, p = 0;
    while (p < 4 && p < la && p < lb && a[p] === b[p]) p++;
    return jaro + p * 0.1 * (1 - jaro);
  }

  /**
   * Similaridade de nomes (0–1): Jaccard de palavras, contando como iguais palavras com Jaro-Winkler ≥ 0,9
   * ("manhathan" ≈ "manhattan"). "Estatua Da Liberdade Manhathan" ↔ "Estátua Liberdade Manhattan" = 1.
   */
  function singles(nome) {
    var base = String(nome || '').split(/\s+[-–]\s*|\s*[-–]\s+/)[0];
    return normName(base).split(' ').filter(function (w) { return w.length === 1 && !NAME_STOP[w] && w !== 'e'; }).sort().join(' ');
  }
  function nameSimilarity(a, b) {
    var A = nameTokens(a), B = nameTokens(b);
    if (!A.length || !B.length) return 0;
    // letra ou número solto é o que distingue "Bloco A"/"Bloco B" e "Mural 1"/"Mural 2": se diferem, não é o mesmo nome
    if (singles(a) !== singles(b)) return 0;
    var used = [], hit = 0;
    A.forEach(function (x) {
      var best = -1, bs = 0;
      B.forEach(function (y, j) { if (!used[j]) { var s = jaroWinkler(x, y); if (s > bs) { bs = s; best = j; } } });
      if (best >= 0 && bs >= 0.9) { used[best] = true; hit++; }
    });
    return hit / (A.length + B.length - hit);
  }

  /** Incerteza da posição cadastrada: 20 m se estimada ou nunca confirmada, 5 m se confirmada. */
  function portalUncertainty(p) {
    var o = String(p && p.observacao || '');
    if (/estimad|n[aã]o confirmad/i.test(o)) return PORTAL_UNC_EST_M;
    return /confirmad/i.test(o) ? PORTAL_UNC_OK_M : PORTAL_UNC_EST_M;
  }

  /** Portal do app (qualquer um) com nome ≥ 0,85 parecido, ou null. */
  function sameNamePortal(nome, portals, exceptId) {
    var best = null, bs = 0;
    portals.forEach(function (p) {
      if (p.id === exceptId) return;
      var s = nameSimilarity(nome, p.nome);
      if (s >= SAME_NAME && s > bs) { bs = s; best = p; }
    });
    return best;
  }

  /* ------------------------------------------------------------ */
  /* Projeção local (metros) com inversa.                          */
  /* ------------------------------------------------------------ */

  function localFrame(ref) {
    var k = Math.cos(ref.lat * DEG);
    return {
      to: function (p) { return { x: (p.lng - ref.lng) * DEG * R * k, y: (p.lat - ref.lat) * DEG * R }; },
      from: function (q) { return { lat: ref.lat + q.y / (R * DEG), lng: ref.lng + q.x / (R * DEG * k) }; }
    };
  }

  /* ------------------------------------------------------------ */
  /* Atribuição um-para-um (algoritmo húngaro, O(n³)).             */
  /* ------------------------------------------------------------ */

  /**
   * cost[i][j] (linhas × colunas, qualquer formato); Infinity = proibido.
   * Devolve assign[i] = j ou -1, minimizando a soma.
   */
  function hungarian(cost) {
    var nr = cost.length, nc = nr ? cost[0].length : 0, n = Math.max(nr, nc);
    if (!n) return [];
    var BIG = 1e9, a = [];
    for (var i = 0; i < n; i++) {
      a.push([]);
      for (var j = 0; j < n; j++) {
        var c = i < nr && j < nc ? cost[i][j] : BIG / 10;
        a[i].push(isFinite(c) ? c : BIG);
      }
    }
    var u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
    for (i = 1; i <= n; i++) {
      p[0] = i;
      var j0 = 0, minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
      do {
        used[j0] = true;
        var i0 = p[j0], delta = Infinity, j1 = 0;
        for (j = 1; j <= n; j++) {
          if (used[j]) continue;
          var cur = a[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= n; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var jw = way[j0]; p[j0] = p[jw]; j0 = jw; } while (j0);
    }
    var out = new Array(nr).fill(-1);
    for (j = 1; j <= n; j++) {
      var r = p[j] - 1, col = j - 1;
      if (r < nr && col < nc && a[r][col] < BIG) out[r] = col;
    }
    return out;
  }

  /* ------------------------------------------------------------ */
  /* Print de mapa: semelhança pixel → metros, RANSAC + húngaro.   */
  /* ------------------------------------------------------------ */

  function mulberry32(s) {
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Transformação: [x; y] metros = s·Rot(θ)·[px; −py] + [tx; ty]  (y do pixel cresce para baixo)
  function apply(T, q) {
    var X = q.x, Y = -q.y, c = Math.cos(T.th), s = Math.sin(T.th);
    return { x: T.s * (c * X - s * Y) + T.tx, y: T.s * (s * X + c * Y) + T.ty };
  }

  /** Mínimos quadrados de semelhança (Umeyama 2D), com ou sem rotação. pairs: [{q (px), m (metros)}]. */
  function fitSimilarity(pairs, rotate) {
    var n = pairs.length, mx = 0, my = 0, qx = 0, qy = 0;
    pairs.forEach(function (p) { qx += p.q.x; qy += -p.q.y; mx += p.m.x; my += p.m.y; });
    qx /= n; qy /= n; mx /= n; my /= n;
    var sxx = 0, sxy = 0, var_q = 0;
    pairs.forEach(function (p) {
      var ax = p.q.x - qx, ay = -p.q.y - qy, bx = p.m.x - mx, by = p.m.y - my;
      sxx += ax * bx + ay * by;      // parte "cos"
      sxy += ax * by - ay * bx;      // parte "sen"
      var_q += ax * ax + ay * ay;
    });
    if (var_q < 1e-9) return null;
    var th = rotate ? Math.atan2(sxy, sxx) : 0;
    var s = (Math.cos(th) * sxx + Math.sin(th) * sxy) / var_q;
    if (!(s > 0)) return null;
    var c = Math.cos(th), si = Math.sin(th);
    return { s: s, th: th, tx: mx - s * (c * qx - si * qy), ty: my - s * (si * qx + c * qy) };
  }

  /**
   * Print de mapa. reading: { portais: [{nome,x,y}], escala_m_por_px, norte_para_cima }.
   * portals: portais do app. opts: { tol, iterations, seed }.
   * Devolve { ok, transform, inliers, matches: [{ idx, nome, portal, dist, confidence, second }], unmatched: [idx] }.
   */
  function matchMap(reading, portals, opts) {
    opts = opts || {};
    var tol = opts.tol || MAP_TOL_M;
    var pts = [];
    reading.portais.forEach(function (p, i) { if (p.x != null && p.y != null) pts.push({ i: i, nome: p.nome, x: p.x, y: p.y }); });
    var base = { ok: false, transform: null, inliers: 0, matches: [], unmatched: reading.portais.map(function (_, i) { return i; }) };
    if (pts.length < MIN_INLIERS || portals.length < MIN_INLIERS) return Object.assign(base, { reason: 'poucos pontos no print ou no app' });
    var ref = G.centroid(portals), F = localFrame(ref);
    var P = portals.map(function (p) { var m = F.to(p); return { x: m.x, y: m.y, p: p }; });
    var rotate = reading.norte_para_cima === false;
    var knownScale = reading.escala_m_por_px > 0 ? reading.escala_m_por_px : null;

    // grade espacial para o vizinho mais próximo
    var CELL = tol * 2, grid = Object.create(null);
    P.forEach(function (m, j) { var k = Math.floor(m.x / CELL) + ':' + Math.floor(m.y / CELL); (grid[k] = grid[k] || []).push(j); });
    function near(q, maxD) {
      var cx = Math.floor(q.x / CELL), cy = Math.floor(q.y / CELL), out = [];
      var span = Math.ceil(maxD / CELL);
      if ((2 * span + 1) * (2 * span + 1) > P.length) { // raio grande: varrer os portais sai mais barato que as células
        P.forEach(function (m, j) { var d = Math.hypot(m.x - q.x, m.y - q.y); if (d <= maxD) out.push({ j: j, d: d }); });
        return out.sort(function (u, w) { return u.d - w.d; });
      }
      for (var a = -span; a <= span; a++) for (var b = -span; b <= span; b++) {
        var bucket = grid[(cx + a) + ':' + (cy + b)];
        if (bucket) bucket.forEach(function (j) { var d = Math.hypot(P[j].x - q.x, P[j].y - q.y); if (d <= maxD) out.push({ j: j, d: d }); });
      }
      return out.sort(function (u, w) { return u.d - w.d; });
    }
    // pontos casados com portais DISTINTOS: sem isso, uma escala minúscula junta o print inteiro em volta de um portal
    function score(T) {
      var n = 0, err = 0, used = Object.create(null);
      pts.forEach(function (q) {
        var hs = near(apply(T, q), tol);
        for (var k = 0; k < hs.length; k++) if (!used[hs[k].j]) { used[hs[k].j] = true; n++; err += hs[k].d; break; }
      });
      return { n: n, err: err };
    }

    var rnd = mulberry32(opts.seed || 12345), best = null, hyps = [];
    var consider = function (T) {
      if (!T || !(T.s >= 0.2 && T.s <= 20)) return; // escala plausível de mapa no celular (m/px)
      if (knownScale && Math.abs(T.s / knownScale - 1) > 0.25) return;
      var sc = score(T);
      if (sc.n >= MIN_INLIERS) hyps.push({ T: T, n: sc.n });
      if (!best || sc.n > best.n || (sc.n === best.n && sc.err < best.err)) best = { T: T, n: sc.n, err: sc.err };
    };
    if (knownScale && !rotate) {
      // escala conhecida e norte para cima: 1 par fixa a translação; testa todos os pares
      pts.forEach(function (q) {
        P.forEach(function (m) { consider({ s: knownScale, th: 0, tx: m.x - knownScale * q.x, ty: m.y + knownScale * q.y }); });
      });
    } else {
      var iters = opts.iterations || 20000;
      for (var it = 0; it < iters; it++) {
        var a1 = pts[Math.floor(rnd() * pts.length)], a2 = pts[Math.floor(rnd() * pts.length)];
        if (a1 === a2) continue;
        var dq = Math.hypot(a1.x - a2.x, a1.y - a2.y);
        if (dq < 5) continue;
        var b1 = P[Math.floor(rnd() * P.length)];
        // segundo portal: um que esteja à distância compatível do primeiro (escala 0,2–20 m/px)
        var cand = near(b1, dq * (knownScale ? knownScale * 1.25 : 20));
        if (cand.length < 2) continue;
        var b2 = P[cand[1 + Math.floor(rnd() * (cand.length - 1))].j];
        var dm = Math.hypot(b1.x - b2.x, b1.y - b2.y), sc0 = dm / dq;
        if (sc0 < 0.2 || sc0 > 20) continue;
        consider(fitSimilarity([{ q: a1, m: b1 }, { q: a2, m: b2 }], rotate));
      }
    }
    if (!best || best.n < MIN_INLIERS) return Object.assign(base, { reason: 'não achei pelo menos ' + MIN_INLIERS + ' pontos que batem com portais do app' });

    // refinamento: mínimos quadrados sobre os inliers; só fica se não perder pontos casados
    var T = best.T, Tn = best.n;
    for (var r = 0; r < 4; r++) {
      var pairs = [];
      pts.forEach(function (q) { var h = near(apply(T, q), tol)[0]; if (h) pairs.push({ q: q, m: P[h.j] }); });
      var T2 = pairs.length >= 2 ? fitSimilarity(pairs, rotate) : null;
      if (knownScale && T2 && !rotate) T2 = fitTranslation(pairs, knownScale, T2);
      if (!T2) break;
      var n2 = T2.s >= 0.2 && T2.s <= 20 ? score(T2).n : -1;
      if (n2 < Tn) break;
      T = T2; Tn = n2;
    }

    // ambiguidade: outra transformação bem diferente (ex.: deslocada uma quadra numa grade regular de ruas)
    // que casa quase tantos pontos quanto a escolhida → nenhuma sugestão pode ser aceita automaticamente
    var cq = { x: 0, y: 0 };
    pts.forEach(function (q) { cq.x += q.x / pts.length; cq.y += q.y / pts.length; });
    var c0 = apply(T, cq), rival = 0;
    hyps.forEach(function (h) {
      var c1 = apply(h.T, cq);
      if (Math.hypot(c1.x - c0.x, c1.y - c0.y) > 2 * tol && h.n > rival) rival = h.n;
    });
    var ambiguous = rival >= Tn - 1;

    // atribuição um-para-um
    var cands = pts.map(function (q) { return near(apply(T, q), tol); });
    var used = Object.create(null), cols = [];
    cands.forEach(function (list) { list.forEach(function (c) { if (!used[c.j]) { used[c.j] = cols.length + 1; cols.push(c.j); } }); });
    var cost = cands.map(function (list) {
      var row = cols.map(function () { return Infinity; });
      list.forEach(function (c) { row[used[c.j] - 1] = c.d; });
      return row;
    });
    var asg = cols.length ? hungarian(cost) : pts.map(function () { return -1; });
    var matches = [], inl = 0, res = 0;
    asg.forEach(function (col, k) { if (col >= 0) { inl++; res += cost[k][col]; } });
    var meanRes = inl ? res / inl : tol;
    if (inl < MIN_INLIERS) return Object.assign(base, { transform: T, reason: 'menos de ' + MIN_INLIERS + ' pontos casados' });
    var unmatched = [];
    asg.forEach(function (col, k) {
      var q = pts[k];
      if (col < 0) { unmatched.push(q.i); return; }
      var j = cols[col], d = cost[k][col];
      var others = cands[k].filter(function (c) { return c.j !== j; });
      var second = others.length ? others[0].d : Infinity;
      var conf = mapConfidence(d, second, meanRes, inl, tol);
      matches.push({ idx: q.i, nome: q.nome, portal: P[j].p.id, dist: Math.round(d), second: isFinite(second) ? Math.round(second) : null,
        confidence: ambiguous ? Math.min(conf, AUTO_ACCEPT - 0.01) / 2 : conf });
    });
    reading.portais.forEach(function (p, i) { if (p.x == null || p.y == null) unmatched.push(i); });
    return { ok: true, transform: T, inliers: inl, meanResidual: Math.round(meanRes), ambiguous: ambiguous, rivalInliers: rival,
      matches: matches.sort(byConf), unmatched: unmatched };
  }

  function fitTranslation(pairs, s, T) {
    // escala conhecida: só ajusta a translação (mantém a escala do print se o ajuste livre fugir dela)
    if (Math.abs(T.s / s - 1) <= 0.1) return T;
    var tx = 0, ty = 0;
    pairs.forEach(function (p) { tx += p.m.x - s * p.q.x; ty += p.m.y + s * p.q.y; });
    return { s: s, th: 0, tx: tx / pairs.length, ty: ty / pairs.length };
  }

  /** Confiança 0–1: perto do ponto, longe do 2º candidato, muitos inliers, resíduo geral baixo. */
  function mapConfidence(d, second, meanRes, inliers, tol) {
    var fit = Math.max(0, 1 - Math.pow(d / tol, 2));   // 10 m de 40: 0,94; 20 m: 0,75; 30 m: 0,44
    var gap = isFinite(second) ? Math.max(0, Math.min(1, (second - d) / 25)) : 1; // 2º candidato a +25 m: sem ambiguidade
    var support = Math.min(1, (inliers - 2) / 4);                                // 3 inliers: 0,25; 6+: 1
    var global = Math.max(0, 1 - Math.pow(meanRes / tol, 2));
    return Math.round(100 * fit * gap * (0.5 + 0.5 * support) * (0.6 + 0.4 * global)) / 100;
  }
  function byConf(a, b) { return b.confidence - a.confidence; }

  /* ------------------------------------------------------------ */
  /* Lista de chaves: anéis de distância a partir do GPS do print. */
  /* ------------------------------------------------------------ */

  /**
   * Tolerância do anel = 12 m + precisão do GPS + incerteza do portal (20 m estimado, 5 m confirmado);
   * ≥ 1 km (arredondada pelo jogo): mais 60 m, peso baixo (nunca decide sozinha).
   */
  function ringTol(dist, acc, unc) {
    var t = NEAR_RING_M + Math.max(0, Number(acc) || 0) + (unc == null ? PORTAL_UNC_EST_M : unc);
    return dist < 1000 ? { tol: t, weak: false } : { tol: t + FAR_RING_M, weak: true };
  }

  /**
   * Observações → { nomeNormalizado: [obs] }. obs: { nome, endereco, distancia_m, nivel, chaves, origem:{lat,lng,precisao}, ts }.
   */
  function groupObs(list) {
    var g = Object.create(null);
    (list || []).forEach(function (o) {
      if (!o || !o.nome || !(o.distancia_m >= 0) || !o.origem) return;
      var k = normName(o.nome); // nome inteiro: "Mural 1" e "Mural 2" são portais diferentes
      if (k) (g[k] = g[k] || []).push(o);
    });
    return g;
  }

  /** Mesma observação repetida: mesmo nome, origem a < 5 m e mesma distância (reenviar o print não conta de novo). */
  function isDuplicateObs(a, b) {
    return normName(a.nome) === normName(b.nome) &&
      Math.abs((a.distancia_m || 0) - (b.distancia_m || 0)) < 0.05 && G.haversine(a.origem, b.origem) < 5;
  }

  /**
   * Nome cortado pela tela: se a mesma linha veio inteira em outro print (mesma origem a < 5 m e mesma distância
   * abaixo de 1 km), o pedaço ("Ninhos D") sai e fica só a observação inteira, com o endereço, as chaves e o nível
   * dela. Acima de 1 km a distância é arredondada pelo jogo e dois portais diferentes podem empatar: não junta.
   * Duplicatas também saem. Indexado por distância: a lista guardada pode ter até 2000 observações.
   */
  function mergeTruncated(list) {
    var src = [];
    (list || []).forEach(function (o) { if (o && o.nome && o.distancia_m >= 0 && o.origem) src.push({ o: o, k: normName(o.nome), b: Math.floor(o.distancia_m * 10) }); });
    var near = Object.create(null);
    src.forEach(function (e) { if (e.o.distancia_m < 1000) (near[e.b] = near[e.b] || []).push(e); });
    var around = function (idx, b) { return (idx[b - 1] || []).concat(idx[b] || [], idx[b + 1] || []); };
    var out = [], seen = Object.create(null);
    src.forEach(function (e) {
      var o = e.o;
      if (e.k.length >= 3 && o.distancia_m < 1000) {
        var cut = around(near, e.b).some(function (f) {
          return f.k.length > e.k.length && f.k.indexOf(e.k) === 0 && Math.abs(f.o.distancia_m - o.distancia_m) < 0.05 &&
            G.haversine(f.o.origem, o.origem) < 5;
        });
        if (cut) return; // a linha inteira está na lista e cobre esta
      }
      var bucket = seen[e.k] = seen[e.k] || Object.create(null);
      if (around(bucket, e.b).some(function (x) { return isDuplicateObs(x, o); })) return;
      (bucket[e.b] = bucket[e.b] || []).push(o);
      out.push(o);
    });
    return out;
  }

  /** Quantas origens distintas (≥ 30 m entre si) uma lista de observações tem. */
  function distinctOrigins(obs) {
    var seen = [];
    obs.forEach(function (o) {
      if (!seen.some(function (s) { return G.haversine(s, o.origem) < DISTINCT_ORIGIN_M; })) seen.push(o.origem);
    });
    return seen.length;
  }

  /** Arredondamento da distância pelo jogo: decímetro abaixo de 1 km, ±50 m até 10 km, ±500 m acima. */
  function roundingErr(d) { return d < 1000 ? 0 : d < 10000 ? 50 : 500; }

  /**
   * Trilateração por mínimos quadrados (Gauss-Newton) em metros locais. Devolve { pos, residual, expectedError, sigma }
   * ou null. Por padrão só usa anéis abaixo de 1 km (precisão de metros); com opts.all usa também os arredondados,
   * com peso menor (para estimar a posição de um portal ainda não cadastrado, a km de distância).
   */
  function trilaterate(obs, opts) {
    var all = !!(opts && opts.all);
    var near = all ? obs.slice() : obs.filter(function (o) { return o.distancia_m < 1000; });
    if (near.length < 3 || distinctOrigins(near) < 3) return null;
    var ref = near[0].origem, F = localFrame(ref);
    var O = near.map(function (o) {
      var m = F.to(o.origem), sd = NEAR_RING_M + (o.origem.precisao || 0) + (all ? roundingErr(o.distancia_m) : 0);
      return { x: m.x, y: m.y, d: o.distancia_m, w: 1 / (sd * sd) };
    });
    // espalhamento: área do triângulo das origens (evita origens quase alinhadas)
    var spread = 0;
    for (var a = 0; a < O.length; a++) for (var b = a + 1; b < O.length; b++) for (var c = b + 1; c < O.length; c++) {
      spread = Math.max(spread, Math.abs((O[b].x - O[a].x) * (O[c].y - O[a].y) - (O[c].x - O[a].x) * (O[b].y - O[a].y)) / 2);
    }
    if (spread < 300) return null; // ~ triângulo de 30 m × 20 m: origens praticamente alinhadas
    // chute inicial: média das origens deslocada; várias partidas para fugir da imagem espelhada
    var best = null;
    [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]].forEach(function (dir) {
      var cx = 0, cy = 0;
      O.forEach(function (o) { cx += o.x; cy += o.y; });
      cx = cx / O.length + dir[0] * O[0].d; cy = cy / O.length + dir[1] * O[0].d;
      for (var it = 0; it < 50; it++) {
        var a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
        O.forEach(function (o) {
          var dx = cx - o.x, dy = cy - o.y, r = Math.hypot(dx, dy) || 1e-6, e = r - o.d;
          var jx = dx / r, jy = dy / r;
          a11 += o.w * jx * jx; a12 += o.w * jx * jy; a22 += o.w * jy * jy; b1 += o.w * jx * e; b2 += o.w * jy * e;
        });
        var det = a11 * a22 - a12 * a12;
        if (Math.abs(det) < 1e-12) break;
        var sx = (a22 * b1 - a12 * b2) / det, sy = (a11 * b2 - a12 * b1) / det;
        cx -= sx; cy -= sy;
        if (Math.hypot(sx, sy) < 0.01) break;
      }
      var res = Math.sqrt(O.reduce(function (s, o) { var e = Math.hypot(cx - o.x, cy - o.y) - o.d; return s + e * e; }, 0) / O.length);
      if (!best || res < best.res) best = { x: cx, y: cy, res: res };
    });
    // Resíduo baixo não basta: com origens mal espalhadas, 3 anéis concordam com uma posição errada.
    // Erro esperado pela geometria = σ·√traço((JᵀJ)⁻¹), σ ≈ metade da tolerância do anel.
    var j11 = 0, j12 = 0, j22 = 0, sig = 0;
    O.forEach(function (o) {
      var dx = best.x - o.x, dy = best.y - o.y, r = Math.hypot(dx, dy) || 1e-6;
      j11 += dx * dx / (r * r); j12 += dx * dy / (r * r); j22 += dy * dy / (r * r);
      sig = Math.max(sig, (1 / Math.sqrt(o.w)) / 2);
    });
    var dt = j11 * j22 - j12 * j12;
    var expected = dt > 1e-9 ? sig * Math.sqrt((j11 + j22) / dt) : Infinity;
    var pos = F.from(best);
    return { pos: { lat: pos.lat, lng: pos.lng }, residual: Math.round(best.res * 10) / 10,
      expectedError: isFinite(expected) ? Math.round(expected * 10) / 10 : null, sigma: sig };
  }

  /**
   * Casamento incremental da lista de chaves.
   * observations: todas as observações guardadas; portals: portais do app.
   * Devolve { suggestions: [...], pending: [...], registered: [...], far: [...] }.
   *   suggestion: { key, nome, portal, confidence, obs: n, origins: n, keys, nivel, estimate?: {lat,lng,residual,shift} }
   *   pending:    { key, nome, candidates: [ids], obs, origins, hint }
   *   far:        { key, nome, distancia_m } (todas as observações a mais de 5 km e o nome sem portal no app)
   *   unregistered: ver unregisteredList (a UI usa esta; far fica por compatibilidade)
   */
  function matchKeyList(observations, portals) {
    var groups = groupObs(mergeTruncated(observations)), keys = Object.keys(groups);
    var inRing = function (o, p, mult) {
      var rt = ringTol(o.distancia_m, o.origem.precisao, portalUncertainty(p));
      return { ok: Math.abs(G.haversine(o.origem, p) - o.distancia_m) <= rt.tol * (mult || 1), weak: rt.weak };
    };
    // 1) identidade por nome: o portal já está cadastrado com esse nome (e dentro do anel ampliado ×2)
    var registered = [], claimed = Object.create(null), rest = [];
    keys.forEach(function (k) {
      var obs = groups[k], nome = obs[obs.length - 1].nome, best = null, bs = 0;
      portals.forEach(function (p) {
        var s = nameSimilarity(nome, p.nome);
        if (!claimed[p.id] && s >= SAME_NAME && s > bs && obs.every(function (o) { return inRing(o, p, 2).ok; })) { bs = s; best = p; }
      });
      if (!best) { rest.push(k); return; }
      claimed[best.id] = true;
      var last = obs.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); })[0];
      var reg = { key: k, nome: nome, portal: best.id, similarity: Math.round(bs * 100) / 100, obs: obs.length, origins: distinctOrigins(obs),
        keys: last.chaves, nivel: last.nivel,
        delta: Math.round(obs.reduce(function (s, o) { return s + Math.abs(G.haversine(o.origem, best) - o.distancia_m); }, 0) / obs.length) };
      var tri = trilaterate(obs);
      if (obs.length >= 3 && trustedTri(tri)) reg.estimate = { lat: tri.pos.lat, lng: tri.pos.lng, residual: tri.residual, expectedError: tri.expectedError, shift: Math.round(G.haversine(tri.pos, best)) };
      registered.push(reg);
    });
    var named = registered; // compatibilidade
    // chaves de portais de outras cidades (todas as distâncias > 5 km): fora dos pendentes, num grupo à parte
    var far = [];
    rest = rest.filter(function (k) {
      var obs = groups[k];
      if (!obs.every(function (o) { return o.distancia_m > FAR_AWAY_M; })) return true;
      far.push({ key: k, nome: obs[obs.length - 1].nome, distancia_m: Math.min.apply(null, obs.map(function (o) { return o.distancia_m; })) });
      return false;
    });
    far.sort(function (a, b) { return a.distancia_m - b.distancia_m; });
    var farKeys = Object.create(null);
    far.forEach(function (f) { farKeys[f.key] = true; });
    // 2) renomear: só portais provisórios que nenhuma observação já reconheceu pelo nome
    var work = [];
    rest.forEach(function (k) {
      var obs = groups[k];
      var cands = portals.filter(function (p) { return isProvisional(p.nome) && !claimed[p.id]; }).filter(function (p) {
        var strong = false;
        var okAll = obs.every(function (o) {
          var rt = inRing(o, p);
          if (rt.ok && !rt.weak) strong = true;
          return rt.ok;
        });
        return okAll && strong; // anel de ≥ 1 km nunca decide sozinho
      });
      // rua do endereço: filtra só se sobrar alguém compatível
      var addr = obs.map(function (o) { return o.endereco; }).filter(Boolean)[0];
      var streetHit = false, notRegistered = null;
      if (addr && cands.length) {
        var comp = cands.filter(function (p) { return streetCompatible(addr, p) === true; });
        if (comp.length) { cands = comp; streetHit = true; }
        else if (addressHasStreet(addr) && streetTokens(addr).length && cands.every(portalStreetKnown)) {
          // nenhum candidato do anel fica na rua do print (e todos dizem a sua rua): o portal certo
          // provavelmente não está cadastrado; não oferecer "É este" para portais de outra rua
          notRegistered = { street: String(addr).split(/[,\-–]/)[0].trim(), others: cands.map(function (p) { return p.id; }) };
          cands = [];
        }
      }
      var last = obs.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); })[0];
      var tri = trilaterate(obs);
      work.push({ key: k, nome: last.nome, obs: obs, cands: cands.map(function (p) { return p.id; }), streetHit: streetHit, last: last, tri: tri, notRegistered: notRegistered });
    });

    // trilateração primeiro (sobre os candidatos do anel), propagação depois: assim nenhuma eliminação
    // fica apoiada num singleton que a trilateração viria a pôr em conflito
    var pById = Object.create(null);
    portals.forEach(function (p) { pById[p.id] = p; });
    work.forEach(function (w) {
      if (w.cands.length > 1 && trustedTri(w.tri)) {
        var ds = w.cands.map(function (id) { return { id: id, d: G.haversine(w.tri.pos, pById[id]) }; }).sort(function (a, b) { return a.d - b.d; });
        if (ds[0].d <= 2 * TRILAT_MAX_RES_M && (ds.length < 2 || ds[1].d - ds[0].d >= 15)) w.cands = [ds[0].id];
      }
    });

    // propagação de singletons: um portal decidido sai da lista dos outros nomes
    var changed = true;
    while (changed) {
      changed = false;
      var taken = Object.create(null);
      work.forEach(function (w) { if (w.cands.length === 1) taken[w.cands[0]] = (taken[w.cands[0]] || 0) + 1; });
      work.forEach(function (w) {
        if (w.cands.length > 1) {
          // só portal disputado por UM nome sai dos outros; com dois nomes no mesmo portal, um deles está errado
          var left = w.cands.filter(function (id) { return taken[id] !== 1; });
          if (left.length && left.length < w.cands.length) { w.cands = left; changed = true; }
        }
      });
    }

    // dois ou mais nomes com o mesmo candidato único: conflito. Nenhum ganha; o jogador decide (ADR-0003, decisão 3)
    var byPortal = Object.create(null);
    work.forEach(function (w) { if (w.cands.length === 1) (byPortal[w.cands[0]] = byPortal[w.cands[0]] || []).push(w); });
    Object.keys(byPortal).forEach(function (id) {
      var ws = byPortal[id];
      if (ws.length > 1) ws.forEach(function (w) { w.conflict = ws.filter(function (x) { return x !== w; }).map(function (x) { return x.nome; }); });
    });

    // atribuição global um-para-um entre nomes com candidato único (dois nomes não ficam com o mesmo ponto)
    var single = work.filter(function (w) { return w.cands.length === 1 && !w.conflict; });
    var cols = [], colIdx = Object.create(null);
    single.forEach(function (w) { if (!(w.cands[0] in colIdx)) { colIdx[w.cands[0]] = cols.length; cols.push(w.cands[0]); } });
    var cost = single.map(function (w) {
      var row = cols.map(function () { return Infinity; });
      var p = pById[w.cands[0]];
      row[colIdx[w.cands[0]]] = w.obs.reduce(function (s, o) { return s + Math.abs(G.haversine(o.origem, p) - o.distancia_m); }, 0) / w.obs.length;
      return row;
    });
    var asg = single.length ? hungarian(cost) : [];
    var winners = Object.create(null);
    single.forEach(function (w, i) { if (asg[i] >= 0) winners[w.key] = true; });

    var suggestions = [], pending = [];
    work.forEach(function (w) {
      var origins = distinctOrigins(w.obs);
      if (w.cands.length === 1 && winners[w.key]) {
        var p = pById[w.cands[0]];
        // 1 observação: só a distância de um ponto, abaixo de 50% mesmo com a rua batendo (nunca auto-aceite)
        var conf = origins >= 3 ? 0.85 : origins === 2 ? 0.7 : 0.4;
        if (w.streetHit) conf = origins >= 2 ? Math.min(0.95, conf + 0.1) : 0.45;
        var sug = { key: w.key, nome: w.nome, portal: p.id, confidence: Math.round(conf * 100) / 100, obs: w.obs.length, origins: origins,
          keys: w.last.chaves, nivel: w.last.nivel };
        var taken = sameNamePortal(w.nome, portals, p.id);
        if (taken) sug.nameTakenBy = taken.id; // renomear criaria dois portais com o mesmo nome: bloqueado na revisão
        if (trustedTri(w.tri)) {
          sug.estimate = { lat: w.tri.pos.lat, lng: w.tri.pos.lng, residual: w.tri.residual, expectedError: w.tri.expectedError,
            shift: Math.round(G.haversine(w.tri.pos, p)) };
        }
        suggestions.push(sug);
      } else {
        pending.push({ key: w.key, nome: w.nome, candidates: w.cands.slice(), obs: w.obs.length, origins: origins, conflict: w.conflict || null,
          notRegistered: w.notRegistered, otherStreet: w.notRegistered ? w.notRegistered.others : null,
          hint: w.notRegistered ? 'provavelmente não cadastrado: nenhum portal do app nesse anel fica na ' + w.notRegistered.street +
              '. Cadastre pelo link do portal (Portais → Colar link)'
            : w.conflict ? 'conflito: "' + w.conflict.join('", "') + '" também só cabe neste portal. Um dos dois não está cadastrado ou tem a posição errada; escolha qual é, se souber'
            : !w.cands.length && w.obs.every(function (o) { return o.distancia_m >= 1000; }) ? 'a ' + Math.round(w.obs[0].distancia_m / 100) / 10 + ' km (arredondado pelo jogo) a distância não decide: tire um print mais perto'
            : !w.cands.length ? 'nenhum portal provisório do app nesse anel: confira se o portal está cadastrado'
            : 'tire outro print a uns 100 m daqui para separar ' + w.cands.length + ' candidatos' });
      }
    });
    var unregistered = unregisteredList(groups, keys, registered, suggestions, pending, farKeys, portals);
    return { suggestions: suggestions.sort(byConf), pending: pending, registered: registered, named: named, far: far, unregistered: unregistered };
  }

  /**
   * Chaves sem portal no app: nenhum portal com o mesmo nome (SAME_NAME, em qualquer lugar), nenhum portal cujo nome
   * comece por este (nome cortado de um cadastrado) e nenhum candidato provisório no anel (esses são renomeação, em
   * Pendentes). Inclui os que vão para `far`.
   *   { key, nome, endereco, chaves, nivel, obs, origins, rings: [{lat,lng,raio_m,tol_m}], estimate?, cutOf? }
   * estimate só com 3+ observações de 3+ origens e trilateração confiável: a fina (trustedTri) ou, com anéis de
   * km, a ponderada pelo arredondamento do jogo com erro esperado até 150 m.
   * cutOf: outro nome da lista que começa por este (provável nome cortado); a UI não oferece cadastro.
   */
  /** Tirando cada observação (até 8), a trilateração das outras fica a até maxShift da estimativa com todas. */
  function consistentWithout(obs, tri, maxShift, opts) {
    var list = obs.slice(0, 8);
    return list.every(function (_, i) {
      var t = trilaterate(list.filter(function (__, j) { return j !== i; }), opts);
      return !t || G.haversine(t.pos, tri.pos) <= maxShift;
    });
  }

  function unregisteredList(groups, keys, registered, suggestions, pending, farKeys, portals) {
    var skip = Object.create(null);
    registered.forEach(function (r) { skip[r.key] = true; });
    suggestions.forEach(function (s) { skip[s.key] = true; });
    pending.forEach(function (pd) { if (pd.candidates.length) skip[pd.key] = true; }); // renomear um provisório, não cadastrar
    var portalKeys = portals.map(function (p) { return normName(String(p.nome || '').split(/\s+[-–]\s*|\s*[-–]\s+/)[0]); });
    var out = [];
    keys.forEach(function (k) {
      if (skip[k]) return;
      var obs = groups[k], nome = obs[obs.length - 1].nome;
      if (sameNamePortal(nome, portals)) return; // já existe com esse nome (talvez com a posição errada): nunca duplicar
      if (isProvisional(nome)) return; // "BK 009", "Portal 07": nome do próprio app, não do jogo; nunca cadastrar com ele
      if (k.length >= 3 && portalKeys.some(function (pk) { return pk.length > k.length && pk.indexOf(k) === 0; })) return;
      var last = obs.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); })[0];
      var u = { key: k, nome: last.nome, endereco: (obs.map(function (o) { return o.endereco; }).filter(Boolean)[0]) || null,
        chaves: last.chaves, nivel: last.nivel, obs: obs.length, origins: distinctOrigins(obs), far: !!farKeys[k],
        rings: obs.map(function (o) {
          return { lat: o.origem.lat, lng: o.origem.lng, raio_m: o.distancia_m, tol_m: Math.round(ringTol(o.distancia_m, o.origem.precisao, 0).tol + roundingErr(o.distancia_m)) };
        }) };
      if (obs.length >= 3 && u.origins >= 3) {
        var tri = trilaterate(obs), checked = false;
        if (trustedTri(tri)) checked = u.origins >= 4 && consistentWithout(obs, tri, Math.max(30, tri.expectedError), {});
        else {
          tri = trilaterate(obs, { all: true });
          // Erro mostrado = 1,5× o esperado pela geometria (cobre ~97% com distâncias arredondadas, em simulação)
          // + 3× o resíduo (uma leitura errada desloca a posição ~3× o resíduo que ela deixa). Resíduo acima de σ: recusa.
          if (tri && tri.expectedError != null) tri.expectedError = Math.round(1.5 * tri.expectedError + 3 * tri.residual);
          if (!(tri && tri.expectedError != null && tri.expectedError <= UNREG_MAX_ERR_M && tri.residual <= tri.sigma)) tri = null;
          // com 4+ pontos dá para conferir: tirar qualquer um não pode mover a estimativa além do erro mostrado
          else if (u.origins >= 4) { if (consistentWithout(obs, tri, tri.expectedError, { all: true })) checked = true; else tri = null; }
        }
        // com só 3 pontos, uma leitura errada pode não deixar rastro: o app avisa "sem conferência"
        if (tri) u.estimate = { lat: tri.pos.lat, lng: tri.pos.lng, residual: tri.residual, expectedError: tri.expectedError, checked: checked };
      }
      out.push(u);
    });
    // nome que é começo de outro da lista: provável pedaço cortado do mesmo portal
    out.forEach(function (u) {
      var longer = out.filter(function (v) { return v !== u && v.key.length > u.key.length && v.key.indexOf(u.key) === 0; })
        .sort(function (a, b) { return b.key.length - a.key.length; })[0]; // o mais longo: o nome inteiro, não outro pedaço
      if (longer) u.cutOf = longer.nome;
    });
    return out.sort(function (a, b) { return (b.estimate ? 1 : 0) - (a.estimate ? 1 : 0) || a.nome.localeCompare(b.nome); });
  }

  /** Posição trilaterada confiável: resíduo e erro esperado pela geometria até 15 m. */
  function trustedTri(t) {
    return !!(t && t.residual <= TRILAT_MAX_RES_M && t.expectedError != null && t.expectedError <= TRILAT_MAX_SIGMA_M);
  }

  /* ------------------------------------------------------------ */
  /* Portal único: sempre com confirmação.                         */
  /* ------------------------------------------------------------ */

  /** Candidatos por rua compatível e distância à origem (se houver). Confiança limitada a 0,5. */
  function matchSingle(reading, portals, origin) {
    var p0 = reading.portais[0];
    if (!p0) return { ok: false, candidates: [] };
    var list = portals.filter(function (p) { return isProvisional(p.nome); }).map(function (p) {
      var st = p0.endereco ? streetCompatible(p0.endereco, p) : null;
      var d = origin ? G.haversine(origin, p) : null;
      var ringOk = origin && p0.distancia_m != null ? Math.abs(d - p0.distancia_m) <= ringTol(p0.distancia_m, origin.precisao, portalUncertainty(p)).tol : null;
      return { portal: p.id, street: st, dist: d == null ? null : Math.round(d), ring: ringOk };
    }).filter(function (c) { return c.street === true || c.ring === true || (c.street === null && c.dist != null && c.dist < 300); });
    list.sort(function (a, b) {
      var sa = (a.street ? 0 : 1) + (a.ring ? 0 : 1), sb = (b.street ? 0 : 1) + (b.ring ? 0 : 1);
      return sa - sb || (a.dist == null ? 1e9 : a.dist) - (b.dist == null ? 1e9 : b.dist);
    });
    return { ok: list.length > 0, nome: p0.nome, candidates: list.slice(0, 5), confidence: list.length === 1 ? 0.5 : 0.3 };
  }

  return {
    MAP_TOL_M: MAP_TOL_M, MIN_INLIERS: MIN_INLIERS, AUTO_ACCEPT: AUTO_ACCEPT, TRILAT_MAX_RES_M: TRILAT_MAX_RES_M,
    normName: normName, nameTokens: nameTokens, nameKey: nameKey, nameSimilarity: nameSimilarity, jaroWinkler: jaroWinkler,
    portalUncertainty: portalUncertainty, sameNamePortal: sameNamePortal, SAME_NAME: SAME_NAME,
    streetTokens: streetTokens, streetCompatible: streetCompatible, isProvisional: isProvisional,
    hungarian: hungarian, fitSimilarity: fitSimilarity, matchMap: matchMap, ringTol: ringTol, trilaterate: trilaterate,
    matchKeyList: matchKeyList, trustedTri: trustedTri, isDuplicateObs: isDuplicateObs, mergeTruncated: mergeTruncated, FAR_AWAY_M: FAR_AWAY_M, UNREG_MAX_ERR_M: UNREG_MAX_ERR_M, roundingErr: roundingErr, portalStreetKnown: portalStreetKnown, addressHasStreet: addressHasStreet, matchSingle: matchSingle, distinctOrigins: distinctOrigins, localFrame: localFrame
  };
});
