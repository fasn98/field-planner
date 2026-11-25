/*
 * Field Planner — leitura local de um print do Intel (mapa escuro).
 * Funções puras sobre os pixels (RGBA) que o próprio usuário escolheu: nada é enviado a lugar nenhum,
 * nenhuma IA e nenhuma requisição. Roda na página (canvas → getImageData) e nos testes (Node).
 * Ver README, "Política de conformidade", regra 8.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'));
  else root.FPIntel = factory(root.FPGeo);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var R = 6378137, DEG = Math.PI / 180;
  var DEFAULTS = {
    zoom: 15, dpr: 2,
    uiTop: 0.10, uiBottom: 0.08, uiSide: 0, // frações da altura/largura ocupadas pela interface (busca, botões, Filters, rodapé)
    coreMin: 150, coreMax: 700, sideMin: 14, sideMax: 30,
    linkMinLen: 40, linkGap: 6, linkWidth: 3, maxLinks: 120,
    endTol: 10, edgeTol: 8,
    maxResidual: 30, dupM: 15,
    neutralRing: 0.3, factionRing: 0.45, autoMaxResidual: 25
  };
  var FACTIONS = ['neutro', 'verde', 'azul', 'machina'];

  function opt(o) { var r = {}; for (var k in DEFAULTS) r[k] = o && o[k] != null ? o[k] : DEFAULTS[k]; return r; }

  /* ---------------- cores fixas do Intel ---------------- */
  function isGray(r, g, b) { return Math.abs(r - 86) <= 3 && Math.abs(g - 86) <= 3 && Math.abs(b - 86) <= 3; }
  function isWhite(r, g, b) { return r > 200 && g > 200 && b > 200; }
  function isGreen(r, g, b) { return g > 200 && r < 90 && b < 90; }
  function isBlue(r, g, b) { return b > 200 && r < 90 && g > 100 && g < 200; }
  function isRed(r, g, b) { return r > 200 && g < 90 && (b < 90 || b > 150); } // vermelho ou rosa (Machina)
  /** Sombra de campo: tom esverdeado/azulado escuro, mais fraco que o anel e o link. */
  function fieldTint(r, g, b) {
    if (g - Math.max(r, b) > 14 && g < 200) return 'verde';
    if (b - Math.max(r, g) > 14 && b < 200 && !(g > 100 && r < 90 && b > 200)) return 'azul';
    return null;
  }
  function colorOf(r, g, b) {
    if (isGreen(r, g, b)) return 'verde';
    if (isBlue(r, g, b)) return 'azul';
    if (isRed(r, g, b)) return 'machina';
    return null;
  }

  /** Retângulo útil do print (sem a interface). */
  function usableArea(img, o) {
    o = opt(o);
    var x0 = Math.round(img.width * o.uiSide), x1 = img.width - 1 - x0;
    return { x0: x0, y0: Math.round(img.height * o.uiTop), x1: x1, y1: img.height - 1 - Math.round(img.height * o.uiBottom) };
  }

  /* ---------------- componentes conectados ---------------- */
  function components(w, h, test, area) {
    var lab = new Int32Array(w * h), out = [], stack = new Int32Array(w * h), n = 0;
    for (var y = area.y0; y <= area.y1; y++) for (var x = area.x0; x <= area.x1; x++) {
      var i = y * w + x;
      if (lab[i] || !test(i)) continue;
      n++;
      var sp = 0, cnt = 0, sx = 0, sy = 0, minx = x, maxx = x, miny = y, maxy = y;
      stack[sp++] = i; lab[i] = n;
      while (sp) {
        var j = stack[--sp], jx = j % w, jy = (j - jx) / w;
        cnt++; sx += jx; sy += jy;
        if (jx < minx) minx = jx; if (jx > maxx) maxx = jx; if (jy < miny) miny = jy; if (jy > maxy) maxy = jy;
        var nb = [j - 1, j + 1, j - w, j + w];
        for (var k = 0; k < 4; k++) {
          var q = nb[k];
          if (q < 0 || q >= w * h) continue;
          var qx = q % w, qy = (q - qx) / w;
          if (qx < area.x0 || qx > area.x1 || qy < area.y0 || qy > area.y1) continue;
          if (Math.abs(qx - jx) > 1) continue;
          if (!lab[q] && test(q)) { lab[q] = n; stack[sp++] = q; }
        }
      }
      out.push({ label: n, area: cnt, x: sx / cnt, y: sy / cnt, minx: minx, maxx: maxx, miny: miny, maxy: maxy });
    }
    return { comps: out, lab: lab };
  }

  /** Fração dos pontos de um anel (raio r em torno de c) que passam no teste. */
  function ringFrac(img, cx, cy, r, test) {
    var d = img.data, w = img.width, h = img.height, hit = 0, tot = 0;
    for (var a = 0; a < 32; a++) {
      var x = Math.round(cx + r * Math.cos(a * Math.PI / 16)), y = Math.round(cy + r * Math.sin(a * Math.PI / 16));
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      tot++;
      var i = (y * w + x) * 4;
      if (test(d[i], d[i + 1], d[i + 2])) hit++;
    }
    return tot ? hit / tot : 0;
  }

  /* ---------------- portais ---------------- */
  function detectPortals(img, o) {
    o = opt(o);
    var d = img.data, w = img.width, area = usableArea(img, o), out = [];
    var okShape = function (c) {
      var bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      return c.area >= o.coreMin && c.area <= o.coreMax && bw >= o.sideMin && bw <= o.sideMax && bh >= o.sideMin && bh <= o.sideMax &&
        bw / bh > 0.6 && bw / bh < 1.67 && c.area / (bw * bh) > 0.5;
    };
    // neutros: miolo cinza (86,86,86)±3 pelo formato; o anel branco pode estar incompleto (hexágono encostado
    // em outro, sob link ou perto da borda), então basta ≥ neutralRing dele
    var gray = components(w, img.height, function (i) { return isGray(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); }, area);
    gray.comps.forEach(function (c) {
      if (!okShape(c)) return;
      var r = Math.max(c.maxx - c.minx, c.maxy - c.miny) / 2;
      var white = Math.max(ringFrac(img, c.x, c.y, r + 2, isWhite), ringFrac(img, c.x, c.y, r + 3, isWhite));
      if (white >= o.neutralRing) out.push({ x: c.x, y: c.y, r: r + 3, faccao: 'neutro' });
    });
    // facções: miolo (qualquer cor que não a da facção) cercado pelo anel de ressonadores da facção
    [['verde', isGreen], ['azul', isBlue], ['machina', isRed]].forEach(function (f) {
      var test = f[1];
      var holes = components(w, img.height, function (i) {
        var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        return !test(r, g, b) && !isGray(r, g, b);
      }, area);
      holes.comps.forEach(function (c) {
        if (!okShape(c)) return;
        var r = Math.max(c.maxx - c.minx, c.maxy - c.miny) / 2;
        var ring = Math.max(ringFrac(img, c.x, c.y, r + 1.5, test), ringFrac(img, c.x, c.y, r + 3, test));
        if (ring >= o.factionRing) out.push({ x: c.x, y: c.y, r: r + 4, faccao: f[0] });
      });
      // alternativa para portais em grupo (anel encostado em outro anel ou em link): miolo = buraco do anel
      // dilatado 2 px, depois abertura 5×5; tamanho 8–34 px
      ringHoles(img, test, area).forEach(function (c) {
        if (out.some(function (q) { return Math.hypot(q.x - c.x, q.y - c.y) < 10; })) return;
        out.push({ x: c.x, y: c.y, r: c.r + 4, faccao: f[0] });
      });
    });
    out.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    return out;
  }

  function ringHoles(img, test, area) {
    var d = img.data, w = img.width, h = img.height, m = new Uint8Array(w * h), dil = new Uint8Array(w * h), out = [];
    for (var y = area.y0; y <= area.y1; y++) for (var x = area.x0; x <= area.x1; x++) {
      var i = y * w + x;
      if (test(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) m[i] = 1;
    }
    for (y = area.y0; y <= area.y1; y++) for (x = area.x0; x <= area.x1; x++) {
      if (!m[y * w + x]) continue;
      for (var yy = Math.max(area.y0, y - 2); yy <= Math.min(area.y1, y + 2); yy++)
        for (var xx = Math.max(area.x0, x - 2); xx <= Math.min(area.x1, x + 2); xx++) dil[yy * w + xx] = 1;
    }
    var holes = components(w, h, function (i) { return !dil[i]; }, area);
    holes.comps.forEach(function (c) {
      var bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      if (bw > 34 || bh > 34) return;
      if (c.minx <= area.x0 || c.miny <= area.y0 || c.maxx >= area.x1 || c.maxy >= area.y1) return; // não fechado
      // miolo = preenchido − anel (dilatado): o próprio buraco, devolvido ao tamanho com a dilatação
      var x0 = c.minx - 2, y0 = c.miny - 2, W = bw + 4, H = bh + 4, core = new Uint8Array(W * H);
      for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
        var gx = x0 + xx, gy = y0 + yy;
        if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
        var gi = gy * w + gx;
        if (holes.lab[gi] === c.label || (dil[gi] && !m[gi] && nearLabel(holes.lab, w, h, gx, gy, c.label))) core[yy * W + xx] = 1;
      }
      var op = morph(morph(core, W, H, 2, true), W, H, 2, false); // abertura 5×5
      var n = 0, sx = 0, sy = 0, mnx = W, mxx = -1, mny = H, mxy = -1;
      for (yy = 0; yy < H; yy++) for (xx = 0; xx < W; xx++) if (op[yy * W + xx]) {
        n++; sx += xx; sy += yy; if (xx < mnx) mnx = xx; if (xx > mxx) mxx = xx; if (yy < mny) mny = yy; if (yy > mxy) mxy = yy;
      }
      if (!n) return;
      var ow = mxx - mnx + 1, oh = mxy - mny + 1;
      if (ow < 8 || oh < 8 || ow > 34 || oh > 34 || ow / oh < 0.6 || ow / oh > 1.67) return;
      out.push({ x: x0 + sx / n, y: y0 + sy / n, r: Math.max(ow, oh) / 2 });
    });
    return out;
  }
  function nearLabel(lab, w, h, x, y, l) {
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
      var X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h && lab[Y * w + X] === l) return true;
    }
    return false;
  }
  /** Erosão (erode=true) ou dilatação com quadrado de raio r. */
  function morph(a, W, H, r, erode) {
    var o = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var v = erode ? 1 : 0;
      for (var dy = -r; dy <= r && v === (erode ? 1 : 0); dy++) for (var dx = -r; dx <= r; dx++) {
        var X = x + dx, Y = y + dy, b = X >= 0 && Y >= 0 && X < W && Y < H ? a[Y * W + X] : 0;
        if (erode && !b) { v = 0; break; }
        if (!erode && b) { v = 1; break; }
      }
      o[y * W + x] = v;
    }
    return o;
  }

  /* ---------------- links (Hough sobre a máscara de cor, sem os portais) ---------------- */
  function linkMask(img, portals, cor, o) {
    var d = img.data, w = img.width, h = img.height, area = usableArea(img, o);
    var test = cor === 'verde' ? isGreen : isBlue;
    var m = new Uint8Array(w * h);
    for (var y = area.y0; y <= area.y1; y++) for (var x = area.x0; x <= area.x1; x++) {
      var i = y * w + x;
      if (test(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) m[i] = 1;
    }
    portals.forEach(function (p) { // tira o anel dos portais
      var rr = p.r + 3;
      for (var yy = Math.floor(p.y - rr); yy <= p.y + rr; yy++) for (var xx = Math.floor(p.x - rr); xx <= p.x + rr; xx++) {
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && (xx - p.x) * (xx - p.x) + (yy - p.y) * (yy - p.y) <= rr * rr) m[yy * w + xx] = 0;
      }
    });
    return m;
  }

  function detectLinks(img, portals, o) {
    o = opt(o);
    var w = img.width, h = img.height, out = [];
    var NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = 2 * diag + 1;
    var cs = new Float64Array(NT), sn = new Float64Array(NT);
    for (var t = 0; t < NT; t++) { cs[t] = Math.cos(t * Math.PI / NT); sn[t] = Math.sin(t * Math.PI / NT); }
    ['verde', 'azul'].forEach(function (cor) {
      var m = linkMask(img, portals, cor, o), pts = [];
      for (var i = 0; i < m.length; i++) if (m[i]) pts.push(i);
      if (pts.length < o.linkMinLen) return;
      var acc = new Int32Array(NT * NR);
      var vote = function (i, dv) {
        var x = i % w, y = (i - x) / w;
        for (var t = 0; t < NT; t++) acc[t * NR + Math.round(x * cs[t] + y * sn[t]) + diag] += dv;
      };
      pts.forEach(function (i) { vote(i, 1); });
      for (var iter = 0; iter < o.maxLinks; iter++) {
        var best = 0, bi = -1;
        for (var k = 0; k < acc.length; k++) if (acc[k] > best) { best = acc[k]; bi = k; }
        if (best < o.linkMinLen) break;
        var th = Math.floor(bi / NR), rho = bi % NR - diag;
        // pixels da máscara perto da reta, ordenados ao longo dela; maior trecho com vãos ≤ linkGap
        var near = [];
        for (var p = 0; p < pts.length; p++) {
          var q = pts[p]; if (!m[q]) continue;
          var x = q % w, y = (q - x) / w;
          if (Math.abs(x * cs[th] + y * sn[th] - rho) <= o.linkWidth) near.push({ i: q, s: -x * sn[th] + y * cs[th] });
        }
        near.sort(function (a, b) { return a.s - b.s; });
        var bs = 0, be = -1, s0 = 0;
        for (var n = 1; n <= near.length; n++) {
          if (n === near.length || near[n].s - near[n - 1].s > o.linkGap) {
            if (n - 1 >= s0 && near[n - 1].s - near[s0].s > (be >= 0 ? near[be].s - near[bs].s : -1)) { bs = s0; be = n - 1; }
            s0 = n;
          }
        }
        var ok = be >= 0 && near[be].s - near[bs].s >= o.linkMinLen;
        // apaga os pixels usados (ou a reta toda, se não deu trecho) e tira os votos deles
        var used = ok ? near.slice(bs, be + 1) : near;
        if (!used.length) { acc[bi] = 0; continue; }
        used.forEach(function (u) { if (m[u.i]) { m[u.i] = 0; vote(u.i, -1); } });
        if (!ok) { acc[bi] = 0; continue; }
        var sA = near[bs].s, sB = near[be].s;
        var px = function (s) { return { x: rho * cs[th] - s * sn[th], y: rho * sn[th] + s * cs[th] }; };
        var A = px(sA), B = px(sB);
        out.push({ cor: cor, x1: A.x, y1: A.y, x2: B.x, y2: B.y });
      }
    });
    return out;
  }

  /**
   * Liga as pontas dos segmentos aos portais (portal na direção da reta, até endTol além da ponta) ou
   * marca a ponta como fora do print (encostada na borda da área útil), prolongando até a borda.
   */
  function resolveLinks(segs, portals, img, o) {
    o = opt(o);
    var area = usableArea(img, o), out = [];
    segs.forEach(function (s) {
      var dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      var end = function (x, y, dir) {
        var best = null, bd = Infinity;
        portals.forEach(function (p, i) {
          var vx = p.x - x, vy = p.y - y, along = (vx * ux + vy * uy) * dir, perp = Math.abs(vx * uy - vy * ux);
          if (along > -o.endTol && along < p.r + o.endTol + 6 && perp <= Math.max(5, p.r * 0.6) && Math.hypot(vx, vy) < bd) { bd = Math.hypot(vx, vy); best = i; }
        });
        if (best != null) return { portal: best, x: portals[best].x, y: portals[best].y };
        var nearEdge = x - area.x0 <= o.edgeTol || area.x1 - x <= o.edgeTol || y - area.y0 <= o.edgeTol || area.y1 - y <= o.edgeTol;
        if (nearEdge) { var e = toEdge(x, y, ux * dir, uy * dir, area); return { portal: null, x: e.x, y: e.y, fora: true }; }
        return { portal: null, x: x, y: y, fora: false };
      };
      var a = end(s.x1, s.y1, -1), b = end(s.x2, s.y2, 1);
      if (a.portal != null && a.portal === b.portal) return;
      out.push({ cor: s.cor, a: a, b: b });
    });
    // mesmo par de portais duas vezes (link grosso detectado em duas retas): fica um
    var seen = {};
    return out.filter(function (l) {
      if (l.a.portal == null || l.b.portal == null) return true;
      var k = Math.min(l.a.portal, l.b.portal) + '|' + Math.max(l.a.portal, l.b.portal);
      if (seen[k]) return false; seen[k] = true; return true;
    });
  }

  function toEdge(x, y, ux, uy, area) {
    var t = Infinity;
    if (ux > 1e-9) t = Math.min(t, (area.x1 - x) / ux); else if (ux < -1e-9) t = Math.min(t, (area.x0 - x) / ux);
    if (uy > 1e-9) t = Math.min(t, (area.y1 - y) / uy); else if (uy < -1e-9) t = Math.min(t, (area.y0 - y) / uy);
    if (!isFinite(t) || t < 0) t = 0;
    return { x: x + ux * t, y: y + uy * t };
  }

  /** Portal dentro de campo: a maior parte da vizinhança (fora do anel) tem a sombra de campo. */
  function coveredPortals(img, portals) {
    return portals.map(function (p) {
      var best = 0, cor = null;
      ['verde', 'azul'].forEach(function (c) {
        var f = (ringFrac(img, p.x, p.y, p.r + 8, function (r, g, b) { return fieldTint(r, g, b) === c; }) +
          ringFrac(img, p.x, p.y, p.r + 14, function (r, g, b) { return fieldTint(r, g, b) === c; })) / 2;
        if (f > best) { best = f; cor = c; }
      });
      return best >= 0.7 ? cor : null;
    });
  }

  /** Tudo de uma vez. */
  function analyze(img, o) {
    var portals = detectPortals(img, o);
    var links = resolveLinks(detectLinks(img, portals, o), portals, img, o);
    var cov = coveredPortals(img, portals);
    portals.forEach(function (p, i) { p.coberto = cov[i]; });
    return { width: img.width, height: img.height, area: usableArea(img, o), portals: portals, links: links };
  }

  /* ---------------- georreferência ---------------- */
  /** Escala padrão do Web Mercator, em metros por pixel do print. */
  function defaultScale(lat, zoom, dpr) {
    return 156543.03 * Math.cos(lat * DEG) / Math.pow(2, zoom) / (dpr || 1);
  }

  /**
   * refs: [{ x, y, lat, lng }] (pixel do print ↔ posição real). Norte para cima, sem rotação.
   * 1 ponto: só translação, escala padrão. 2+: ajusta escala e translação (mínimos quadrados).
   * Devolve { scale, toLL(x,y), residuals:[m], maxResidual, ok }.
   */
  function fitTransform(refs, o) {
    o = opt(o);
    if (!refs || !refs.length) return null;
    var lat0 = refs.reduce(function (a, r) { return a + r.lat; }, 0) / refs.length;
    var lng0 = refs.reduce(function (a, r) { return a + r.lng; }, 0) / refs.length;
    var kx = R * Math.cos(lat0 * DEG) * DEG, ky = R * DEG; // m por grau
    var E = refs.map(function (r) { return (r.lng - lng0) * kx; }), N = refs.map(function (r) { return (r.lat - lat0) * ky; });
    var mx = refs.reduce(function (a, r) { return a + r.x; }, 0) / refs.length, my = refs.reduce(function (a, r) { return a + r.y; }, 0) / refs.length;
    var s = defaultScale(lat0, o.zoom, o.dpr);
    if (refs.length >= 2) {
      var num = 0, den = 0;
      refs.forEach(function (r, i) { var dx = r.x - mx, dy = r.y - my; num += dx * E[i] - dy * N[i]; den += dx * dx + dy * dy; });
      if (den > 0 && num > 0) s = num / den;
    }
    // E = s(x - mx) + mean(E) = s(x-mx); N = -s(y - my)
    var toLL = function (x, y) {
      return { lat: lat0 + (-s * (y - my)) / ky, lng: lng0 + (s * (x - mx)) / kx };
    };
    var res = refs.map(function (r) { return Math.round(G.haversine(toLL(r.x, r.y), r) * 10) / 10; });
    var max = Math.max.apply(null, res);
    return { scale: s, toLL: toLL, residuals: res, maxResidual: max, ok: max <= o.maxResidual, points: refs.length };
  }

  /**
   * Monta o que entra no app, sem gravar nada: portais novos ("Print NN"), facção dos existentes a < dupM,
   * bloqueadores entre portais, segmentos com ponta fora do print, portais sob campo.
   * an: resultado de analyze; tr: fitTransform; existing: db.portals; ctx: { now, myFaction, nextNum, newId }
   */
  function buildImport(an, tr, existing, ctx, o) {
    o = opt(o);
    var stamp = fmtStamp(ctx.now);
    var mapped = [], novos = [], updates = [], n = ctx.nextNum || 1;
    var forced = ctx.forced || {};
    an.portals.forEach(function (p, i) {
      if (forced[i]) { // portal escolhido como referência: é aquele portal
        var f = existing.filter(function (e) { return e.id === forced[i]; })[0];
        if (f) { if (f.faccao !== p.faccao) updates.push({ id: f.id, faccao: p.faccao }); mapped.push(f.id); return; }
      }
      var ll = tr.toLL(p.x, p.y), best = null, bd = Infinity;
      existing.concat(novos).forEach(function (e) { var dd = G.haversine(e, ll); if (dd < bd) { bd = dd; best = e; } });
      if (best && bd < o.dupM) {
        if (best.faccao !== p.faccao) updates.push({ id: best.id, faccao: p.faccao });
        mapped.push(best.id);
        return;
      }
      var np = { id: ctx.newId(), nome: 'Print ' + (n < 10 ? '0' : '') + n++, lat: round6(ll.lat), lng: round6(ll.lng), nivel: null, chaves: 0,
        observacao: 'ESTIMADO pelo print ' + stamp, faccao: p.faccao };
      novos.push(np); mapped.push(np.id);
    });
    var origemOf = function (cor) { return ctx.myFaction && cor === ctx.myFaction ? 'aliado' : 'inimigo'; };
    var blockers = [], segments = [], seen = {};
    an.links.forEach(function (l) {
      var A = l.a.portal != null ? mapped[l.a.portal] : null, B = l.b.portal != null ? mapped[l.b.portal] : null;
      if (A && B) {
        if (A === B) return;
        var k = [A, B].sort().join('|');
        if (seen[k]) return; seen[k] = true;
        blockers.push({ id: ctx.newId(), portalA: A, portalB: B, origem: origemOf(l.cor), fonte: 'print', ts: ctx.now, cor: l.cor });
        return;
      }
      var a = A ? existing.concat(novos).filter(function (p) { return p.id === A; })[0] : tr.toLL(l.a.x, l.a.y);
      var b = B ? existing.concat(novos).filter(function (p) { return p.id === B; })[0] : tr.toLL(l.b.x, l.b.y);
      var nota = (l.a.fora || l.b.fora) ? 'ponta fora do print' : 'ponta sem portal no print';
      segments.push({ id: ctx.newId(), tipo: 'segmento', a: { lat: round6(a.lat), lng: round6(a.lng) }, b: { lat: round6(b.lat), lng: round6(b.lng) },
        origem: origemOf(l.cor), fonte: 'print', ts: ctx.now, nota: nota, cor: l.cor });
    });
    var covered = [];
    an.portals.forEach(function (p, i) { if (p.coberto && covered.indexOf(mapped[i]) < 0) covered.push(mapped[i]); });
    return { novos: novos, updates: updates, blockers: blockers, segments: segments, covered: covered, mapped: mapped };
  }

  /**
   * Acha automaticamente quais portais detectados correspondem às referências (sem o usuário tocar):
   * testa cada portal como a 1ª referência, prevê as outras pela escala padrão e ajusta.
   */
  function autoMatchRefs(portals, refs, o) {
    o = opt(o);
    if (!refs.length || !portals.length) return null;
    var s0 = defaultScale(refs[0].lat, o.zoom, o.dpr), kx = R * Math.cos(refs[0].lat * DEG) * DEG, ky = R * DEG;
    var best = null;
    portals.forEach(function (p0) {
      var pairs = [{ x: p0.x, y: p0.y, lat: refs[0].lat, lng: refs[0].lng }];
      for (var i = 1; i < refs.length; i++) {
        var px = p0.x + (refs[i].lng - refs[0].lng) * kx / s0, py = p0.y - (refs[i].lat - refs[0].lat) * ky / s0;
        var nb = null, nd = Infinity;
        portals.forEach(function (q) { var dd = Math.hypot(q.x - px, q.y - py); if (dd < nd) { nd = dd; nb = q; } });
        if (!nb || nd > 60) return;
        pairs.push({ x: nb.x, y: nb.y, lat: refs[i].lat, lng: refs[i].lng });
      }
      var tr = fitTransform(pairs, o);
      if (!best || tr.maxResidual < best.tr.maxResidual) best = { refs: pairs, tr: tr };
    });
    // encaixe ruim não é aceito em silêncio: o usuário toca nas referências
    if (best) {
      best.ok = best.tr.maxResidual <= o.autoMaxResidual;
      if (!best.ok) best.message = 'Encaixe automático com resíduo de ' + best.tr.maxResidual + ' m (acima de ' + o.autoMaxResidual + ' m): toque nas referências no print.';
    }
    return best;
  }

  function round6(v) { return Math.round(v * 1e6) / 1e6; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtStamp(ts) { var d = new Date(ts); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  /** Idade, em dias, de um bloqueador vindo de print (null se não for de print). */
  function printAgeDays(b, now) { return b && b.fonte === 'print' && b.ts > 0 ? (now - b.ts) / 86400000 : null; }

  return {
    DEFAULTS: DEFAULTS, FACTIONS: FACTIONS,
    isGray: isGray, isWhite: isWhite, isGreen: isGreen, isBlue: isBlue, fieldTint: fieldTint, colorOf: colorOf,
    usableArea: usableArea, detectPortals: detectPortals, detectLinks: detectLinks, resolveLinks: resolveLinks,
    coveredPortals: coveredPortals, analyze: analyze,
    defaultScale: defaultScale, fitTransform: fitTransform, buildImport: buildImport, autoMatchRefs: autoMatchRefs,
    fmtStamp: fmtStamp, printAgeDays: printAgeDays
  };
});
