/*
 * Field Planner — interface.
 * Rede: apenas tiles do OpenStreetMap (via Leaflet) e os próprios arquivos do app.
 * Nenhum dado sai do aparelho. GPS é somente leitura (navigator.geolocation).
 */
/* global L, FPGeo */
(function () {
  'use strict';

  var STORE = 'fieldplanner.v1';
  var VERSION = '1.5.0';
  // Qualquer string de 1–64 caracteres sem controle. A segurança contra "constructor"/"__proto__"
  // vem dos mapas sem protótipo; filtrar mais trocaria ids e órfãos bloqueadores/links feitos.
  var ID_RE = /^[^\u0000-\u001f\u007f]{1,64}$/;
  var MOVE_RECALC_M = 100;
  var PERIODIC_RECALC_MS = 5 * 60 * 1000;
  var LEVEL_COLORS = ['#fece5a', '#ffa630', '#ff7315', '#e40000', '#fd2992', '#eb26cd', '#c124e0', '#9627f4'];

  var $ = function (s) { return document.querySelector(s); };

  /* ------------------------------------------------------------ */
  /* Persistência (localStorage).                                  */
  /* ------------------------------------------------------------ */

  function emptyDb() {
    return {
      version: 1, portals: [], blockers: [], done: [], excluded: [], coveredManual: [], lastImport: null,
      settings: { radius: 1500, maxOut: 8, objective: 'campos', strategy: 'auto', simulate: false }
    };
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return emptyDb();
      var d = JSON.parse(raw), base = emptyDb();
      Object.keys(base).forEach(function (k) { if (d[k] === undefined) d[k] = base[k]; });
      d.settings = Object.assign(base.settings, d.settings || {});
      d.portals = d.portals.map(sanitizePortal).filter(Boolean);
      var ids = idSet(d.portals);
      d.blockers = d.blockers.map(function (b) { return sanitizeBlocker(b, ids); }).filter(Boolean);
      d.done = sanitizePairs(d.done, ids);
      d.excluded = sanitizePairs(d.excluded, ids);
      d.coveredManual = d.coveredManual.filter(function (x) { return typeof x === 'string' && ids[x]; });
      var li = d.lastImport;
      d.lastImport = li && Array.isArray(li.ids) ? { ts: Number(li.ts) || 0, label: String(li.label || '').slice(0, 40),
        ids: li.ids.filter(function (x) { return typeof x === 'string' && ids[x]; }) } : null;
      if (d.lastImport && !d.lastImport.ids.length) d.lastImport = null;
      return d;
    } catch (e) {
      console.warn('[FP] falha ao ler dados locais', e);
      return emptyDb();
    }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(db)); }
    catch (e) { toastError('Não foi possível salvar (armazenamento cheio?)'); }
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function clampInt(v, lo, hi, def) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
  }
  function sanitizePortal(p) {
    if (!p || typeof p !== 'object') return null;
    // aceita lat/lng (padrão do app) e latitude/longitude ou lon (outros arquivos)
    var rawLat = p.lat != null ? p.lat : p.latitude;
    var rawLng = p.lng != null ? p.lng : (p.lon != null ? p.lon : p.longitude);
    if (rawLat == null || rawLng == null || String(rawLat).trim() === '' || String(rawLng).trim() === '') return null; // "" não vira 0
    var lat = Number(rawLat), lng = Number(rawLng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return {
      id: typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : newId(),
      nome: String(p.nome || p.name || 'Portal').trim().slice(0, 80) || 'Portal',
      lat: lat, lng: lng,
      nivel: clampInt(p.nivel, 1, 8, 1),
      chaves: clampInt(p.chaves, 0, 999, 0),
      observacao: String(p.observacao || '').slice(0, 300)
    };
  }
  function idSet(portals) {
    var ids = Object.create(null); // sem protótipo: "constructor", "__proto__" etc. não passam
    portals.forEach(function (p) { ids[p.id] = true; });
    return ids;
  }
  function pairKeyDir(d) { return d.from + '\u0000' + d.to; } // \u0000 é proibido em ids: sem colisão
  /** Valida pares {from,to} e remove duplicatas (mesma direção). */
  function sanitizePairs(list, ids, existing) {
    var seen = Object.create(null), out = [];
    (existing || []).forEach(function (d) { seen[pairKeyDir(d)] = true; });
    (Array.isArray(list) ? list : []).forEach(function (d) {
      if (!d || typeof d.from !== 'string' || typeof d.to !== 'string') return;
      if (!ids[d.from] || !ids[d.to] || d.from === d.to || seen[pairKeyDir(d)]) return;
      seen[pairKeyDir(d)] = true;
      out.push({ from: d.from, to: d.to, ts: Number(d.ts) || Date.now() });
    });
    return out;
  }
  function blockerKey(b) { return [b.portalA, b.portalB].sort().join('\u0000') + '\u0000' + b.origem; }
  function sanitizeBlocker(b, ids) {
    if (!b || typeof b.portalA !== 'string' || typeof b.portalB !== 'string') return null;
    if (!ids[b.portalA] || !ids[b.portalB] || b.portalA === b.portalB) return null;
    return { id: typeof b.id === 'string' && ID_RE.test(b.id) ? b.id : newId(), portalA: b.portalA, portalB: b.portalB, origem: b.origem === 'aliado' ? 'aliado' : 'inimigo' };
  }

  var db = load();
  function portalById(id) { for (var i = 0; i < db.portals.length; i++) if (db.portals[i].id === id) return db.portals[i]; return null; }
  function pname(id) { var p = portalById(id); return p ? p.nome : '(removido)'; }

  /* ------------------------------------------------------------ */
  /* Utilidades de UI.                                             */
  /* ------------------------------------------------------------ */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function fmtDist(m) {
    if (m == null || !isFinite(m)) return '–';
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2).replace('.', ',') + ' km';
  }
  function fmtNum(n) { return Number(n).toLocaleString('pt-BR'); }
  function fmtMin(min) {
    if (min < 60) return Math.max(1, Math.round(min)) + ' min';
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
  }
  function fmtArea(m2) {
    if (!m2) return '0 m²';
    if (m2 < 10000) return fmtNum(Math.round(m2)) + ' m²';
    if (m2 < 1e6) return (m2 / 10000).toFixed(1).replace('.', ',') + ' ha';
    return (m2 / 1e6).toFixed(2).replace('.', ',') + ' km²';
  }
  var toastTimer;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, ms || 2600);
  }
  /** Erros ficam 10 s na tela (ou até tocar). */
  function toastError(msg) { toast('⚠ ' + msg, 10000); }
  $('#toast').addEventListener('click', function () { this.style.display = 'none'; });
  function levelBadge(n) {
    return el('span', { class: 'lv', text: 'L' + n, style: 'background:' + LEVEL_COLORS[n - 1] });
  }
  function confirmDialog(title, text) {
    return new Promise(function (resolve) {
      var d = $('#confirmDlg');
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      d.returnValue = '';
      d.addEventListener('close', function h() { d.removeEventListener('close', h); resolve(d.returnValue === 'ok'); });
      d.showModal();
    });
  }
  function compass(deg) {
    var dirs = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
    return dirs[Math.round(deg / 45) % 8];
  }

  /* ------------------------------------------------------------ */
  /* Mapa.                                                         */
  /* ------------------------------------------------------------ */

  var map = L.map('map', { zoomControl: false, attributionControl: true, tapHold: true }).setView([-15.78, -47.93], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true, // respostas CORS (não opacas) para o cache offline não estourar a cota
    attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);

  var fieldLayer = L.layerGroup().addTo(map);
  var blockerLayer = L.layerGroup().addTo(map);
  var doneLayer = L.layerGroup().addTo(map);
  var planLayer = L.layerGroup().addTo(map);
  var routeLayer = L.layerGroup().addTo(map);
  var portalLayer = L.layerGroup().addTo(map);
  var meMarker = null, meAccuracy = null;

  if (db.portals.length) {
    map.fitBounds(L.latLngBounds(db.portals.map(function (p) { return [p.lat, p.lng]; })).pad(0.2));
  }

  // Toque longo (ou clique direito) adiciona portal no ponto.
  map.on('contextmenu', function (e) { openPortalDlg(null, e.latlng); });

  function renderPortals() {
    portalLayer.clearLayers();
    var inPlan = Object.create(null);
    if (plan) plan.links.forEach(function (l) { inPlan[l.from] = inPlan[l.to] = true; });
    db.portals.forEach(function (p) {
      var m = L.circleMarker([p.lat, p.lng], {
        radius: inPlan[p.id] ? 11 : 8, color: '#0d1117', weight: 2,
        fillColor: LEVEL_COLORS[p.nivel - 1], fillOpacity: 0.95
      });
      if (inPlan[p.id]) m.bindTooltip(esc(p.nome) + ' · 🔑' + p.chaves, { permanent: true, direction: 'right', offset: [8, 0], className: 'plabel' });
      else m.bindTooltip(esc(p.nome) + ' · L' + p.nivel + ' · ' + p.chaves + ' 🔑', { direction: 'top', offset: [0, -8] });
      m.on('click', function () { openPortalDlg(p); });
      m.addTo(portalLayer);
    });
  }

  function renderLinks() {
    blockerLayer.clearLayers();
    doneLayer.clearLayers();
    db.blockers.forEach(function (b) {
      var a = portalById(b.portalA), c = portalById(b.portalB);
      if (!a || !c) return;
      L.polyline([[a.lat, a.lng], [c.lat, c.lng]], {
        color: b.origem === 'aliado' ? '#58a6ff' : '#f85149', weight: 3, dashArray: '6 6', opacity: 0.9
      }).bindTooltip((b.origem === 'aliado' ? 'Aliado: ' : 'Inimigo: ') + esc(a.nome) + ' – ' + esc(c.nome)).addTo(blockerLayer);
    });
    db.done.forEach(function (d) {
      var a = portalById(d.from), c = portalById(d.to);
      if (!a || !c) return;
      L.polyline([[a.lat, a.lng], [c.lat, c.lng]], { color: '#8b949e', weight: 3, opacity: 0.9 }).addTo(doneLayer);
    });
  }

  function renderPlanOnMap() {
    planLayer.clearLayers();
    fieldLayer.clearLayers();
    routeLayer.clearLayers();
    if (!plan) return;
    // campos finais: contorno + sombra; camadas sobrepostas escurecem
    plan.fields.forEach(function (f) {
      var pts = f.portals.map(portalById);
      if (pts.some(function (p) { return !p; })) return;
      L.polygon(pts.map(function (p) { return [p.lat, p.lng]; }), {
        color: '#2dd4bf', weight: 1.5, opacity: 0.8, fillColor: '#2dd4bf', fillOpacity: 0.22, interactive: false
      }).addTo(fieldLayer);
    });
    var cur = currentLink();
    plan.links.forEach(function (l) {
      var a = portalById(l.from), b = portalById(l.to);
      if (!a || !b) return;
      var isCur = cur && cur.n === l.n;
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
        color: isCur ? '#ffffff' : '#2dd4bf', weight: isCur ? 5 : 3, opacity: 0.95, dashArray: isCur ? null : '2 6'
      }).addTo(planLayer);
      // número do link a 40% do caminho (afasta rótulos de links que saem do mesmo portal)
      var mid = [a.lat + (b.lat - a.lat) * 0.4, a.lng + (b.lng - a.lng) * 0.4];
      L.marker(mid, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: '', html: '<div class="lbl' + (isCur ? ' cur' : '') + '">' + l.n + '</div>', iconSize: [22, 18], iconAnchor: [11, 9] })
      }).addTo(planLayer);
    });
    // rota a pé: A (posição usada no cálculo) → 1 → 2 → … na ordem dos passos
    var route = [];
    if (plan.origin) route.push([plan.origin.lat, plan.origin.lng]);
    plan.steps.forEach(function (s) { var p = portalById(s.portal); if (p) route.push([p.lat, p.lng]); });
    if (route.length > 1) L.polyline(route, { color: '#fbbf24', weight: 3, opacity: 0.9, dashArray: '8 6', interactive: false }).addTo(routeLayer);
    var routeIcon = function (txt, cls) {
      return L.divIcon({ className: '', html: '<div class="route-num ' + (cls || '') + '">' + txt + '</div>', iconSize: [24, 20], iconAnchor: [-6, 24] });
    };
    if (plan.origin) L.marker([plan.origin.lat, plan.origin.lng], { interactive: false, keyboard: false, icon: routeIcon('A', 'start') }).addTo(routeLayer);
    plan.steps.forEach(function (s, i) {
      var p = portalById(s.portal);
      if (p) L.marker([p.lat, p.lng], { interactive: false, keyboard: false, zIndexOffset: 500, icon: routeIcon(String(i + 1)) }).addTo(routeLayer);
    });
  }

  /** Recolhe o painel e enquadra rota, links e campos do plano. */
  function showPlanOnMap() {
    if (!plan) return;
    var ids = Object.create(null);
    plan.links.forEach(function (l) { ids[l.from] = ids[l.to] = true; });
    var ll = Object.keys(ids).map(portalById).filter(Boolean).map(function (p) { return [p.lat, p.lng]; });
    if (plan.origin) ll.push([plan.origin.lat, plan.origin.lng]);
    if (!ll.length) return;
    sheet.classList.add('min');
    map.fitBounds(L.latLngBounds(ll).pad(0.15), { paddingBottomRight: [0, 80] });
  }

  function renderMe() {
    if (!pos) return;
    var ll = [pos.lat, pos.lng];
    if (!meMarker) {
      meAccuracy = L.circle(ll, { radius: pos.accuracy || 0, color: '#58a6ff', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000,
        icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meAccuracy.setLatLng(ll).setRadius(pos.accuracy || 0);
    }
  }

  function renderAll() {
    renderPortals();
    renderLinks();
    renderPlanOnMap();
    renderPortalList();
    renderBlockerList();
    renderPlanPanel();
    renderField();
    renderUndoImport();
    $('#doneInfo').textContent = db.done.length + ' link(s) marcados como feitos · ' + db.excluded.length + ' par(es) falho(s)' +
      (db.coveredManual.length ? ' · ' + db.coveredManual.length + ' portal(is) marcados sob campo' : '');
  }

  /* ------------------------------------------------------------ */
  /* GPS (somente leitura).                                        */
  /* ------------------------------------------------------------ */

  var pos = null;          // última leitura {lat,lng,accuracy,heading}
  var lastOptPos = null;   // posição usada no último cálculo
  var centeredOnce = false;

  function setGpsChip(text, cls) { var c = $('#gpsChip'); c.textContent = text; c.className = 'chip ' + (cls || ''); }

  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(function (p) {
      pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading };
      setGpsChip('GPS ±' + Math.round(p.coords.accuracy) + ' m', p.coords.accuracy <= 30 ? 'ok' : 'warn');
      renderMe();
      if (!centeredOnce && !db.portals.length) { map.setView([pos.lat, pos.lng], 16); centeredOnce = true; }
      if (fieldMode && plan && !busy) {
        if (!lastOptPos) optimize('GPS disponível');
        else if (FPGeo.haversine(lastOptPos, pos) > MOVE_RECALC_M) optimize('você se moveu mais de ' + MOVE_RECALC_M + ' m');
      }
      renderField();
    }, function (err) {
      setGpsChip(err.code === 1 ? 'GPS negado' : 'sem GPS', 'bad');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  } else {
    setGpsChip('sem GPS', 'bad');
  }

  $('#centerBtn').addEventListener('click', function () {
    if (pos) map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 16));
    else toast('Sem posição de GPS ainda');
  });

  /* ------------------------------------------------------------ */
  /* Otimizador (Web Worker).                                      */
  /* ------------------------------------------------------------ */

  var plan = null, lastOptAt = 0, reqSeq = 0, busy = false;
  var worker = null;
  try { worker = new Worker('worker.js'); } catch (e) { console.error('[FP] worker indisponível', e); }

  if (worker) worker.onerror = function (e) {
    busy = false;
    $('#optBtn').disabled = false;
    $('#optBtn').textContent = 'Calcular plano';
    toastError('Falha ao carregar o otimizador' + (e && e.message ? ': ' + e.message : ''));
  };
  if (worker) worker.onmessage = function (e) {
    var m = e.data;
    if (m.reqId !== reqSeq) return; // resposta antiga
    busy = false;
    $('#optBtn').disabled = false;
    $('#optBtn').textContent = 'Calcular plano';
    if (m.type === 'error') { toastError('Erro no otimizador: ' + m.error); return; }
    plan = m.result;
    plan.reason = pendingReason;
    plan.origin = pendingOrigin; // posição usada neste cálculo (ponto A da rota)
    renderAll();
    if (pendingReason && fieldMode) toast('Plano recalculado: ' + pendingReason);
    else if (!plan.links.length) toast('Nenhum link possível com os dados atuais', 4000);
  };

  var pendingReason = '', pendingOrigin = null;
  function optimize(reason) {
    if (!worker) { toast('Seu navegador não suporta Web Workers'); return; }
    if (db.portals.length < 2) { toast('Cadastre pelo menos 2 portais'); return; }
    var s = db.settings;
    lastOptPos = pos ? { lat: pos.lat, lng: pos.lng } : null;
    pendingOrigin = lastOptPos;
    lastOptAt = Date.now();
    pendingReason = reason || '';
    busy = true;
    $('#optBtn').disabled = true;
    $('#optBtn').textContent = 'Calculando…';
    worker.postMessage({
      type: 'optimize', reqId: ++reqSeq,
      input: {
        portals: db.portals, blockers: db.blockers, done: db.done, excluded: db.excluded, coveredManual: db.coveredManual,
        position: lastOptPos, radius: s.radius, maxOut: s.maxOut, objective: s.objective, strategy: s.strategy,
        ignoreKeys: !!s.simulate,
        timeBudgetMs: 1500
      }
    });
    if (!pos) toast('Sem GPS: considerando todos os portais, a partir do centro deles', 3500);
  }

  // Recálculo periódico (a cada 5 min) quando há plano em uso.
  setInterval(function () {
    if (plan && fieldMode && !busy && Date.now() - lastOptAt >= PERIODIC_RECALC_MS) optimize('5 minutos desde o último cálculo');
  }, 30 * 1000);

  /* ------------------------------------------------------------ */
  /* Painel: Plano.                                                */
  /* ------------------------------------------------------------ */

  var cfg = { radius: $('#cfgRadius'), maxOut: $('#cfgMaxOut'), objective: $('#cfgObjective'), strategy: $('#cfgStrategy'), simulate: $('#cfgSimulate') };
  cfg.simulate.checked = !!db.settings.simulate;
  cfg.radius.value = db.settings.radius;
  cfg.maxOut.value = db.settings.maxOut;
  cfg.objective.value = db.settings.objective;
  cfg.strategy.value = db.settings.strategy;
  Object.keys(cfg).forEach(function (k) {
    cfg[k].addEventListener('change', function () {
      db.settings.radius = clampInt(cfg.radius.value, 100, 100000, 1500);
      db.settings.maxOut = clampInt(cfg.maxOut.value, 1, 40, 8);
      db.settings.objective = cfg.objective.value;
      db.settings.strategy = cfg.strategy.value;
      var simChanged = db.settings.simulate !== cfg.simulate.checked;
      db.settings.simulate = cfg.simulate.checked;
      cfg.radius.value = db.settings.radius;
      cfg.maxOut.value = db.settings.maxOut;
      save();
      if (simChanged && plan) optimize(db.settings.simulate ? 'simulação ligada' : 'simulação desligada');
    });
  });

  $('#optBtn').addEventListener('click', function () { optimize(''); });
  $('#startBtn').addEventListener('click', function () { setFieldMode(true); });

  var STRAT_NAMES = { fanfield: 'Fanfield', triangulacao: 'Triangulação', multicamada: 'Multicamada' };

  function renderPlanPanel() {
    var out = $('#planOut');
    out.textContent = '';
    // simulação não vai para o modo em campo: os links dependem de chaves que você ainda não tem
    $('#startBtn').disabled = !(plan && plan.links.length) || !!(plan && plan.simulation);
    if (!plan) {
      out.appendChild(el('p', { class: 'muted', text: 'Cadastre portais (toque longo no mapa, ou aba Portais) e toque em “Calcular plano”.' }));
      return;
    }
    var stats = el('div', { class: 'stats' }, [
      el('div', { class: 'stat' }, [el('b', { text: String(plan.fields.length) }), el('span', { text: 'campos' })]),
      el('div', { class: 'stat' }, [el('b', { text: String(plan.links.length) }), el('span', { text: 'links' })]),
      el('div', { class: 'stat' }, [el('b', { text: fmtNum(plan.ap) }), el('span', { text: 'AP' })]),
      el('div', { class: 'stat' }, [el('b', { text: fmtDist(plan.distance) }), el('span', { text: 'a pé' })])
    ]);
    out.appendChild(stats);
    if (plan.links.length) {
      var tt = FPGeo.travelTimes(plan.steps.map(function (s) { return s.walk; }), plan.links.length);
      out.appendChild(el('div', { class: 'times' }, [
        el('div', null, [el('b', { text: fmtMin(tt.walk) }), '🚶 a pé']),
        el('div', null, [el('b', { text: fmtMin(tt.car) }), '🚗 carro']),
        el('div', null, [el('b', { text: fmtMin(tt.transit) }), '🚌 transporte'])
      ]));
      out.appendChild(el('p', { class: 'muted small', text: 'Tempo estimado: linha reta × desvio das ruas, mais ~1 min por link e por parada. ' +
        'Não é rota real: o app não consulta serviços de rotas.' }));
      out.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn grow', text: '🗺 Ver plano no mapa', onclick: showPlanOnMap })]));
    }
    if (plan.simulation) {
      out.appendChild(el('div', { class: 'sim-banner', text: '🧪 Simulação: plano ideal pela posição dos portais, sem considerar suas chaves. ' +
        'Use a lista de farm abaixo para buscar as chaves; depois desligue a simulação para executar em campo.' }));
    }
    if (plan.fields.length) {
      out.appendChild(el('p', { class: 'muted small', text: 'Área total dos campos: ' + fmtArea(plan.area) +
        ' — o MU real é proporcional à área × densidade populacional local (desconhecida).' }));
    }
    var meta = (STRAT_NAMES[plan.strategy] || '–') + (plan.anchor ? ' · âncora: ' + pname(plan.anchor) : '') +
      (plan.base ? ' · base: ' + pname(plan.base[0]) + ' – ' + pname(plan.base[1]) + ' · ' + plan.layers + ' camada(s)' : '') +
      ' · ' + (plan.inRadius > plan.candidates
        ? plan.candidates + ' de ' + plan.inRadius + ' portais ' + (lastOptPos ? 'no raio ' : '') + 'considerados (com chave e mais próximos primeiro)'
        : plan.candidates + ' portal(is) no raio') + ' · ' + plan.elapsedMs + ' ms';
    out.appendChild(el('p', { class: 'muted small', text: meta }));

    if (!plan.links.length) {
      out.appendChild(el('p', { class: 'muted', text: 'Nenhum link possível.' }));
      // diz qual é o motivo mais provável, em vez de uma lista genérica
      // só os portais que entram no cálculo (dentro do raio, quando há GPS)
      var noRaio = db.portals.filter(function (p) { return !lastOptPos || FPGeo.haversine(lastOptPos, p) <= db.settings.radius; });
      var semChave = noRaio.filter(function (p) { return !p.chaves; }).length;
      var nivel1 = noRaio.filter(function (p) { return p.nivel === 1; }).length;
      var dicas = el('ul', { class: 'list' });
      if (semChave) dicas.appendChild(el('li', { class: 'nokey', text: semChave === noRaio.length
        ? 'Nenhum portal tem chave cadastrada. Cada link precisa de uma chave do portal de destino: na aba Portais, use 🔑 + para informar quantas chaves você tem.'
        : semChave + ' portal(is) sem chave não podem receber links. Ajuste em Portais → 🔑 Chaves.' }));
      if (nivel1) dicas.appendChild(el('li', { text: nivel1 + ' portal(is) estão como L1 (alcance de só 160 m). Toque no nome do portal, em Portais, para informar o nível real.' }));
      if (plan.candidates < 3) dicas.appendChild(el('li', { text: 'Só ' + plan.candidates + ' portal(is) dentro do raio a pé de ' + fmtDist(db.settings.radius) + '.' }));
      if (dicas.childNodes.length) out.appendChild(dicas);
      else out.appendChild(el('p', { class: 'muted small', text: 'Verifique os bloqueadores e o limite de links de saída.' }));
    } else {
      out.appendChild(el('h3', { text: 'Passos' }));
      var ol = el('ol', { class: 'steps' });
      plan.steps.forEach(function (s, i) {
        var links = s.links.map(function (l) {
          return '#' + l.n + ' → ' + pname(l.to) + (l.fields ? ' (+' + l.fields + ' campo' + (l.fields > 1 ? 's' : '') + ', ' + fmtArea(l.area) + ')' : '');
        }).join(', ');
        ol.appendChild(el('li', null, [
          el('span', { class: 'num', text: String(i + 1) }),
          el('b', { text: 'Vá até ' + pname(s.portal) }),
          el('span', { class: 'muted', text: ' · ' + fmtDist(s.walk) }),
          el('div', { class: 'small', text: 'Faça link ' + links })
        ]));
      });
      out.appendChild(ol);
    }

    if (plan.keysUsed.length) {
      out.appendChild(el('h3', { text: 'Chaves consumidas' }));
      var tb = el('tbody');
      plan.keysUsed.forEach(function (k) {
        tb.appendChild(el('tr', null, [el('td', { text: pname(k.portal) }), el('td', { class: 'n', text: String(k.used) }), el('td', { class: 'n', text: String(k.have) })]));
      });
      out.appendChild(el('table', null, [el('thead', null, [el('tr', null, [el('th', { text: 'Portal' }), el('th', { class: 'n', text: 'usar' }), el('th', { class: 'n', text: 'tem' })])]), tb]));
    }
    if (plan.keysMissing.length) {
      if (plan.simulation) {
        var totalFarm = plan.keysMissing.reduce(function (a, k) { return a + k.missing; }, 0);
        out.appendChild(el('h3', { text: '🔑 Lista de farm' }));
        out.appendChild(el('p', { class: 'farm-total', text: 'Faltam ' + totalFarm + ' chave(s) em ' + plan.keysMissing.length + ' portal(is) para executar este plano.' }));
      } else {
        out.appendChild(el('h3', { text: 'Chaves faltantes' }));
        var gain = plan.potentialFields - plan.fields.length;
        if (gain > 0) out.appendChild(el('p', { class: 'muted small', text: 'Com essas chaves, a mesma rota renderia ' + plan.potentialFields + ' campos (+' + gain + ').' }));
      }
      var ul = el('ul', { class: 'list' });
      plan.keysMissing.forEach(function (k) {
        ul.appendChild(el('li', null, [el('b', { text: pname(k.portal) }), el('span', { class: 'muted', text: ' · faltam ' + k.missing + ' (precisa ' + k.need + ', tem ' + k.have + ')' })]));
      });
      out.appendChild(ul);
    }
  }

  /* ------------------------------------------------------------ */
  /* Painel: Portais.                                              */
  /* ------------------------------------------------------------ */

  function renderPortalList() {
    var ul = $('#portalList'), q = $('#search').value.trim().toLowerCase();
    ul.textContent = '';
    var list = db.portals.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    if (pos) list.sort(function (a, b) { return FPGeo.haversine(pos, a) - FPGeo.haversine(pos, b); });
    list.filter(function (p) { return !q || p.nome.toLowerCase().indexOf(q) >= 0; }).forEach(function (p) {
      var keysBox = el('div', { class: 'keys-wrap' }, [
        el('span', { class: 'keys-label', text: '🔑 Chaves' }),
        el('div', { class: 'keys' }, [
          el('button', { 'aria-label': 'Menos uma chave de ' + p.nome, text: '−', onclick: function (e) { e.stopPropagation(); bumpKeys(p, -1); } }),
          el('b', { class: p.chaves ? '' : 'zero', text: String(p.chaves) }),
          el('button', { 'aria-label': 'Mais uma chave de ' + p.nome, text: '+', onclick: function (e) { e.stopPropagation(); bumpKeys(p, 1); } })
        ])
      ]);
      var meta = el('div', { class: 'muted small' }, [
        (pos ? fmtDist(FPGeo.haversine(pos, p)) + ' · ' : '') + 'Nível ' + p.nivel + ' · alcance ' + fmtDist(FPGeo.linkRange(p.nivel)),
        p.chaves ? null : el('span', { class: 'nokey', text: ' · sem chave: não recebe links' }),
        p.observacao ? ' · ' + p.observacao : null
      ]);
      var info = el('div', { class: 'grow' }, [el('div', { class: 'name', text: p.nome }), meta]);
      var li = el('li', { class: 'item' }, [levelBadge(p.nivel), info, keysBox]);
      info.addEventListener('click', function () { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)); openPortalDlg(p); });
      ul.appendChild(li);
    });
    if (!db.portals.length) ul.appendChild(el('li', { class: 'muted', text: 'Nenhum portal cadastrado.' }));
  }
  $('#search').addEventListener('input', renderPortalList);

  function bumpKeys(p, d) {
    p.chaves = clampInt(p.chaves + d, 0, 999, 0);
    save();
    renderPortals();
    renderPortalList();
  }

  var levelSel = $('#portalForm').elements.nivel;
  for (var lv = 1; lv <= 8; lv++) levelSel.appendChild(el('option', { value: String(lv), text: 'L' + lv }));

  var editing = null;
  function openPortalDlg(p, latlng, prefill) {
    editing = p;
    var f = $('#portalForm').elements;
    $('#portalDlgTitle').textContent = p ? 'Editar portal' : 'Novo portal';
    $('#portalDelete').hidden = !p;
    f.nome.value = p ? p.nome : (prefill && prefill.nome) || '';
    f.link.value = '';
    var ll = p || latlng || (prefill && prefill.coords) || null;
    f.lat.value = ll ? (+ll.lat).toFixed(6) : '';
    f.lng.value = ll ? (+ll.lng).toFixed(6) : '';
    f.nivel.value = String(p ? p.nivel : 1);
    f.chaves.value = String(p ? p.chaves : 0);
    f.observacao.value = p ? p.observacao : '';
    $('#portalDlg').returnValue = '';
    $('#portalDlg').showModal();
    if (!p) setTimeout(function () { f.nome.focus(); }, 50);
  }
  $('#portalForm').elements.link.addEventListener('input', function (e) {
    var c = FPGeo.parseCoords(e.target.value);
    var f = $('#portalForm').elements;
    if (c) { f.lat.value = c.lat.toFixed(6); f.lng.value = c.lng.toFixed(6); }
  });
  $('#portalDlg').addEventListener('close', function () {
    var v = $('#portalDlg').returnValue, f = $('#portalForm').elements;
    if (v === 'save') {
      var data = sanitizePortal({
        id: editing ? editing.id : newId(), nome: f.nome.value, lat: f.lat.value, lng: f.lng.value,
        nivel: f.nivel.value, chaves: f.chaves.value, observacao: f.observacao.value
      });
      if (!data) { toast('Coordenadas inválidas'); return; }
      if (editing) Object.assign(editing, data); else db.portals.push(data);
      save();
      invalidatePlan();
      toast(editing ? 'Portal atualizado' : 'Portal adicionado');
    } else if (v === 'delete' && editing) {
      var id = editing.id, name = editing.nome;
      confirmDialog('Excluir portal', 'Excluir “' + name + '” e links associados?').then(function (ok) {
        if (!ok) return;
        var gone = Object.create(null); gone[id] = true;
        removePortals(gone);
        save();
        invalidatePlan();
      });
    }
    editing = null;
  });

  $('#addPortalBtn').addEventListener('click', function () {
    openPortalDlg(null, pos ? { lat: pos.lat, lng: pos.lng } : map.getCenter());
  });
  $('#pasteBtn').addEventListener('click', function () {
    var d = $('#pasteDlg');
    d.querySelector('textarea').value = '';
    d.returnValue = '';
    d.showModal();
  });
  $('#pasteDlg').addEventListener('close', function () {
    var d = $('#pasteDlg');
    if (d.returnValue !== 'ok') return;
    var text = d.querySelector('textarea').value;
    var c = FPGeo.parseCoords(text);
    if (!c) { toast('Não encontrei coordenadas nesse texto. Digite lat/lng manualmente.', 4000); return; }
    map.setView([c.lat, c.lng], 17);
    openPortalDlg(null, null, { coords: c });
  });

  // Mudança de dados invalida o plano (recalcula se já havia um).
  function invalidatePlan() {
    if (plan) optimize('dados alterados');
    renderAll();
  }

  /* ------------------------------------------------------------ */
  /* Painel: Ajustes (bloqueadores, dados).                        */
  /* ------------------------------------------------------------ */

  function renderBlockerList() {
    var ul = $('#blockerList');
    ul.textContent = '';
    db.blockers.forEach(function (b) {
      ul.appendChild(el('li', { class: 'item' }, [
        el('span', { class: 'chip ' + (b.origem === 'aliado' ? 'ok' : 'bad'), text: b.origem }),
        el('div', { class: 'grow name', text: pname(b.portalA) + ' – ' + pname(b.portalB) }),
        el('button', { class: 'btn sm ghost', 'aria-label': 'Remover bloqueador', text: '✕', onclick: function () {
          db.blockers = db.blockers.filter(function (x) { return x !== b; });
          save(); invalidatePlan();
        } })
      ]));
    });
    if (!db.blockers.length) ul.appendChild(el('li', { class: 'muted', text: 'Nenhum bloqueador.' }));
  }

  var blockerCb = null;
  function openBlockerDlg(preA, preB, cb) {
    if (db.portals.length < 2) { toast('Cadastre pelo menos 2 portais'); return; }
    var d = $('#blockerDlg'), f = d.querySelector('form').elements;
    [f.a, f.b].forEach(function (sel) {
      sel.textContent = '';
      var list = db.portals.slice();
      if (pos) list.sort(function (x, y) { return FPGeo.haversine(pos, x) - FPGeo.haversine(pos, y); });
      list.forEach(function (p) { sel.appendChild(el('option', { value: p.id, text: p.nome })); });
    });
    if (preA) f.a.value = preA;
    if (preB) f.b.value = preB;
    else if (f.a.value === f.b.value && db.portals.length > 1) f.b.selectedIndex = 1;
    f.origem.value = 'inimigo';
    blockerCb = cb || null;
    d.returnValue = '';
    d.showModal();
  }
  $('#addBlockerBtn').addEventListener('click', function () { openBlockerDlg(); });
  $('#blockerDlg').addEventListener('close', function () {
    var d = $('#blockerDlg'), f = d.querySelector('form').elements, cb = blockerCb;
    blockerCb = null;
    if (d.returnValue !== 'save') return;
    if (f.a.value === f.b.value) { toast('Escolha dois portais diferentes'); return; }
    db.blockers.push({ id: newId(), portalA: f.a.value, portalB: f.b.value, origem: f.origem.value });
    save();
    toast('Bloqueador adicionado');
    if (cb) cb(); else invalidatePlan();
  });

  $('#clearDoneBtn').addEventListener('click', function () {
    confirmDialog('Limpar links feitos', 'Esquecer os links marcados como feitos? (as chaves não são devolvidas)').then(function (ok) {
      if (!ok) return;
      db.done = []; db.coveredManual = []; undoStack = [];
      save(); invalidatePlan();
    });
  });
  $('#clearExclBtn').addEventListener('click', function () { db.excluded = []; save(); invalidatePlan(); });

  $('#exportBtn').addEventListener('click', function () {
    var data = {
      app: 'field-planner', version: 1, exportedAt: new Date().toISOString(),
      portals: db.portals, blockers: db.blockers, done: db.done, excluded: db.excluded, coveredManual: db.coveredManual, settings: db.settings
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'field-planner-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });
  $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
  $('#importFile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Arquivo grande demais (máx. 5 MB)'); return; }
    file.text().then(importJsonText).catch(function (err) { toastError('JSON inválido: ' + err.message); });
  });

  /** Importa o JSON do app (ou um array de portais). Lança erro se o formato for desconhecido. */
  function importJsonText(txt) {
    return Promise.resolve().then(function () {
      var data = JSON.parse(txt);
      // aceita as chaves portals (padrão do app), portais e pontos
      var portals = Array.isArray(data) ? data : (data.portals || data.portais || data.pontos);
      if (!Array.isArray(portals)) throw new Error('formato desconhecido');
      if (portals.length <= BIG_IMPORT) return applyImport(data, portals);
      return confirmDialog('Importação grande', 'O arquivo tem ' + fmtNum(portals.length) + ' pontos. ' +
        'Listas detectadas automaticamente em prints costumam trazer ruído (pontos em grade, na água, na borda da imagem). ' +
        'Você pode desfazer depois em Ajustes → Desfazer última importação.').then(function (ok) {
        if (ok) applyImport(data, portals); else toast('Importação cancelada');
      });
    });
  }

  function applyImport(data, portals) {
    var added = 0, updated = 0, kept = 0, autoN = nextPortalNumber(), addedIds = [];
    var near = nearIndex(db.portals);
    portals.forEach(function (raw) {
      var p = sanitizePortal(raw);
      if (!p) return;
      var hasId = raw && typeof raw.id === 'string' && ID_RE.test(raw.id);
      var ex = hasId ? portalById(p.id) : null;
      var semNome = !(raw.nome || raw.name);
      if (ex) { // mesmo id: atualiza, mas sem trocar um nome existente por um automático
        if (semNome) p.nome = ex.nome;
        Object.assign(ex, p); updated++; return;
      }
      if (!hasId) {
        // sem id (arquivo feito à mão): mesmo lugar = mesmo portal; mantém chaves/nível já ajustados
        if (near.find(p)) { kept++; return; }
      }
      if (semNome) p.nome = 'Portal ' + String(autoN++).padStart(2, '0'); // só quem entra de fato consome número
      db.portals.push(p); near.add(p); addedIds.push(p.id); added++;
    });
    recordImport(addedIds, 'arquivo JSON');
    var ids = idSet(db.portals);
    var nb = 0, have = Object.create(null);
    db.blockers.forEach(function (b) { have[blockerKey(b)] = true; have['id:' + b.id] = true; });
    (Array.isArray(data.blockers) ? data.blockers : []).forEach(function (b) {
      var s = sanitizeBlocker(b, ids);
      if (!s || have[blockerKey(s)] || have['id:' + s.id]) return;
      have[blockerKey(s)] = have['id:' + s.id] = true;
      db.blockers.push(s); nb++;
    });
    ['done', 'excluded'].forEach(function (k) {
      db[k] = db[k].concat(sanitizePairs(data[k], ids, db[k]));
    });
    if (Array.isArray(data.coveredManual)) data.coveredManual.forEach(function (x) {
      if (typeof x === 'string' && ids[x] && db.coveredManual.indexOf(x) < 0) db.coveredManual.push(x);
    });
    if (data.settings && typeof data.settings === 'object') {
      var st = data.settings;
      db.settings = {
        radius: clampInt(st.radius, 100, 100000, db.settings.radius),
        maxOut: clampInt(st.maxOut, 1, 40, db.settings.maxOut),
        objective: ['campos', 'ap', 'distancia', 'mu'].indexOf(st.objective) >= 0 ? st.objective : db.settings.objective,
          simulate: typeof st.simulate === 'boolean' ? st.simulate : db.settings.simulate,
        strategy: ['auto', 'fanfield', 'triangulacao', 'multicamada'].indexOf(st.strategy) >= 0 ? st.strategy : db.settings.strategy
      };
      cfg.radius.value = db.settings.radius; cfg.maxOut.value = db.settings.maxOut;
      cfg.objective.value = db.settings.objective; cfg.strategy.value = db.settings.strategy; cfg.simulate.checked = db.settings.simulate;
    }
    save();
    if (db.portals.length) map.fitBounds(L.latLngBounds(db.portals.map(function (p) { return [p.lat, p.lng]; })).pad(0.2));
    invalidatePlan();
    toast('Importado: ' + added + ' novo(s), ' + updated + ' atualizado(s)' + (kept ? ', ' + kept + ' já existente(s) mantido(s)' : '') + ', ' + nb + ' bloqueador(es)', 5000);
  }

  /* ------------------------------------------------------------ */
  /* Importação em lote: uma linha por portal (nome + link/coords). */
  /* ------------------------------------------------------------ */

  var DUP_M = 10; // portais a menos de 10 m são tratados como o mesmo
  var BIG_IMPORT = 300; // acima disso, pede confirmação antes de gravar

  /**
   * Índice espacial simples (grade de ~22 m) para achar portais a menos de DUP_M sem comparar
   * cada ponto com todos os outros: importar milhares de pontos não trava a tela.
   */
  function nearIndex(list) {
    var CELL = 0.0002, grid = Object.create(null);
    var key = function (la, ln) { return Math.floor(la / CELL) + ':' + Math.floor(ln / CELL); };
    var idx = {
      add: function (p) { var k = key(p.lat, p.lng); (grid[k] = grid[k] || []).push(p); },
      find: function (p) {
        var r = Math.floor(p.lat / CELL), c = Math.floor(p.lng / CELL);
        // em longitude a célula encolhe com a latitude (22 m × cos): alarga a busca para cobrir DUP_M
        var span = Math.max(1, Math.ceil(DUP_M / (CELL * 111320 * Math.max(Math.cos(p.lat * Math.PI / 180), 0.01))));
        for (var i = -1; i <= 1; i++) for (var j = -span; j <= span; j++) {
          var b = grid[(r + i) + ':' + (c + j)];
          if (b) for (var k = 0; k < b.length; k++) if (FPGeo.haversine(b[k], p) < DUP_M) return b[k];
        }
        return null;
      }
    };
    (list || []).forEach(idx.add);
    return idx;
  }

  /** Remove portais (conjunto de ids) e tudo que aponta para eles. */
  function removePortals(gone) {
    db.portals = db.portals.filter(function (p) { return !gone[p.id]; });
    db.blockers = db.blockers.filter(function (b) { return !gone[b.portalA] && !gone[b.portalB]; });
    db.done = db.done.filter(function (d) { return !gone[d.from] && !gone[d.to]; });
    db.excluded = db.excluded.filter(function (d) { return !gone[d.from] && !gone[d.to]; });
    db.coveredManual = db.coveredManual.filter(function (x) { return !gone[x]; });
    if (db.lastImport) db.lastImport.ids = db.lastImport.ids.filter(function (x) { return !gone[x]; });
    if (db.lastImport && !db.lastImport.ids.length) db.lastImport = null;
  }

  function recordImport(ids, label) {
    if (ids.length) db.lastImport = { ts: Date.now(), label: label, ids: ids };
  }
  var bulkRows = [];
  var bulkForm = $('#bulkForm').elements;
  for (var bl = 1; bl <= 8; bl++) bulkForm.nivel.appendChild(el('option', { value: String(bl), text: 'L' + bl }));

  $('#bulkBtn').addEventListener('click', function () {
    bulkForm.text.value = '';
    bulkRows = [];
    renderBulk();
    $('#bulkDlg').returnValue = '';
    $('#bulkDlg').showModal();
  });
  $('#bulkFileBtn').addEventListener('click', function () { $('#bulkFile').click(); });
  $('#bulkFile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Arquivo grande demais (máx. 5 MB)'); return; }
    file.text().then(function (txt) {
      var t = txt.trim();
      // JSON do próprio app (ou array de portais): usa o import completo
      if (t[0] === '{' || t[0] === '[') {
        try { JSON.parse(t); } catch (err) { t = null; }
        if (t !== null) {
          $('#bulkDlg').close('cancel');
          importJsonText(txt).catch(function (err) { toastError('JSON inválido: ' + err.message); });
          return;
        }
      }
      bulkForm.text.value = txt;
      parseBulkText();
    }).catch(function (err) { toastError('Não foi possível ler o arquivo: ' + err.message); });
  });
  $('#bulkParseBtn').addEventListener('click', parseBulkText);
  // Enter em qualquer campo de uma linha não submete: o botão padrão do form é "Cancelar"
  $('#bulkForm').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault();
  });

  function parseBulkText() {
    var parsed = FPGeo.parseBulk(bulkForm.text.value, 2001);
    if (parsed.length > 2000) { toast('Máximo de 2000 linhas por importação; o resto foi ignorado', 4000); parsed = parsed.slice(0, 2000); }
    var saved = nearIndex(db.portals), accepted = nearIndex([]);
    bulkRows = parsed.map(function (r) {
      if (r.erro) return r;
      var hit = saved.find(r), dup = null;
      if (hit) dup = 'já cadastrado: ' + hit.nome;
      else if ((hit = accepted.find(r))) dup = 'repetido da linha ' + hit.linha;
      r.dup = dup;
      r.use = !dup;
      if (!dup) accepted.add(r);
      return r;
    });
    // Sem nome na linha: rótulo automático. O que importa é a posição; o jogador associa no jogo.
    var n = nextPortalNumber();
    // numera primeiro os que serão importados, depois os duplicados (desmarcados), para não pular números
    [false, true].forEach(function (dupPass) {
      bulkRows.forEach(function (r) {
        if (!r.erro && !r.nome && !!r.dup === dupPass) r.nome = 'Portal ' + String(n++).padStart(2, '0');
      });
    });
    renderBulk();
  }

  /** Próximo número livre para "Portal NN", olhando os portais salvos e as linhas da prévia. */
  function nextPortalNumber() {
    var max = 0;
    db.portals.concat(bulkRows).forEach(function (p) {
      var m = /^Portal (\d+)$/.exec(String(p.nome || '').trim());
      if (m) max = Math.max(max, +m[1]);
    });
    return max + 1;
  }

  function renderBulk() {
    var ul = $('#bulkPreview');
    ul.textContent = '';
    var ok = 0, err = 0, dup = 0;
    bulkRows.forEach(function (r) {
      if (r.erro) {
        err++;
        ul.appendChild(el('li', { class: 'bulk-row' }, [
          el('span', { text: '✕' }),
          el('div', { class: 'name', text: r.texto }),
          el('div', { class: 'meta bad', text: 'Linha ' + r.linha + ': ' + r.erro + ' — ignorada' })
        ]));
        return;
      }
      if (r.dup) dup++; else ok++;
      var cb = el('input', { type: 'checkbox', 'aria-label': 'Importar linha ' + r.linha });
      cb.checked = r.use;
      cb.addEventListener('change', function () { r.use = cb.checked; updateBulkSave(); });
      var name = el('input', { type: 'text', maxlength: '80', placeholder: 'Nome (opcional)', 'aria-label': 'Nome do portal da linha ' + r.linha });
      name.value = r.nome || '';
      name.addEventListener('input', function () { r.nome = name.value; updateBulkSave(); });
      // Enter não pode submeter o formulário (o botão padrão é "Cancelar" e perderia a edição)
      name.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var all = ul.querySelectorAll('input[type=text]'), i = Array.prototype.indexOf.call(all, name);
        if (all[i + 1]) all[i + 1].focus(); else name.blur();
      });
      ul.appendChild(el('li', { class: 'bulk-row' }, [
        cb, name,
        el('div', { class: 'meta' + (r.dup ? ' warn' : ''), text: 'Linha ' + r.linha + ' · ' + r.lat.toFixed(6) + ', ' + r.lng.toFixed(6) + (r.dup ? ' · ' + r.dup : '') })
      ]));
    });
    $('#bulkSummary').textContent = bulkRows.length
      ? ok + ' novo(s) · ' + dup + ' possível(is) duplicado(s) · ' + err + ' linha(s) sem coordenadas'
      : '';
    updateBulkSave();
  }

  function updateBulkSave() {
    var sel = bulkRows.filter(function (r) { return !r.erro && r.use; });
    var b = $('#bulkSave');
    b.disabled = !sel.length;
    b.textContent = 'Importar ' + sel.length;
  }

  $('#bulkDlg').addEventListener('close', function () {
    if ($('#bulkDlg').returnValue !== 'save') return;
    var nivel = clampInt(bulkForm.nivel.value, 1, 8, 1), chaves = clampInt(bulkForm.chaves.value, 0, 999, 0);
    var added = [], n = nextPortalNumber();
    bulkRows.forEach(function (r) {
      if (r.erro || !r.use) return;
      var nome = String(r.nome || '').trim() || 'Portal ' + String(n++).padStart(2, '0'); // usuário apagou o nome
      var p = sanitizePortal({ id: newId(), nome: nome, lat: r.lat, lng: r.lng, nivel: nivel, chaves: chaves, observacao: '' });
      if (p) { db.portals.push(p); added.push(p); }
    });
    bulkRows = [];
    if (!added.length) return;
    recordImport(added.map(function (p) { return p.id; }), 'lista de links');
    save();
    map.fitBounds(L.latLngBounds(added.map(function (p) { return [p.lat, p.lng]; })).pad(0.2));
    invalidatePlan();
    toast(added.length + ' portal(is) importado(s). Ajuste nível e chaves na lista.', 4000);
  });

  function renderUndoImport() {
    var b = $('#undoImportBtn'), li = db.lastImport;
    b.disabled = !li;
    b.textContent = li ? 'Desfazer última importação (' + fmtNum(li.ids.length) + ' portais, ' + li.label + ')' : 'Desfazer última importação';
  }
  $('#undoImportBtn').addEventListener('click', function () {
    var li = db.lastImport;
    if (!li) return;
    confirmDialog('Desfazer importação', 'Remover os ' + fmtNum(li.ids.length) + ' portais adicionados na última importação (' + li.label + ', ' +
      new Date(li.ts).toLocaleString('pt-BR') + ')? Bloqueadores e links feitos ligados a eles também saem, e chaves e níveis ajustados neles se perdem. ' +
      'Portais que já existiam e foram atualizados pelo arquivo, e configurações vindas dele, não são revertidos.').then(function (ok) {
      if (!ok) return;
      var gone = Object.create(null);
      li.ids.forEach(function (id) { gone[id] = true; });
      var n = li.ids.length;
      removePortals(gone);
      db.lastImport = null;
      save();
      invalidatePlan();
      toast(fmtNum(n) + ' portal(is) removido(s)');
    });
  });

  $('#wipeBtn').addEventListener('click', function () {
    confirmDialog('Apagar tudo', 'Remove todos os portais, bloqueadores e configurações deste aparelho. Exporte antes se quiser guardar.').then(function (ok) {
      if (!ok) return;
      db = emptyDb(); plan = null; undoStack = [];
      save();
      setFieldMode(false);
      renderAll();
      toast('Dados apagados');
    });
  });

  /* ------------------------------------------------------------ */
  /* Modo em campo.                                                */
  /* ------------------------------------------------------------ */

  var fieldMode = false;
  var undoStack = [];

  function currentStep() { return plan && plan.steps.length ? plan.steps[0] : null; }
  function currentLink() { var s = currentStep(); return s ? s.links[0] : null; }

  function setFieldMode(on) {
    fieldMode = on;
    document.body.classList.toggle('fieldmode', on);
    $('#field').hidden = !on;
    if (on) {
      if (!plan || !plan.links.length) { setFieldMode(false); toast('Calcule um plano antes'); return; }
      if (pos && lastOptPos && FPGeo.haversine(pos, lastOptPos) > MOVE_RECALC_M) optimize('posição atualizada');
      var s = currentStep(), p = s && portalById(s.portal);
      if (p) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17));
      // mantém a tela acesa, se suportado
      if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
    } else if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    renderField();
  }
  var wakeLock = null;

  function renderField() {
    if (!fieldMode) return;
    var s = currentStep(), l = currentLink();
    var totalLinks = plan ? plan.links.length : 0;
    $('#fSummary').textContent = plan ? plan.fields.length + ' campos · ' + totalLinks + ' links restantes' : '';
    if (!s || !l) {
      $('#fStep').textContent = 'Plano concluído';
      $('#fTarget').textContent = 'Nada mais a fazer 🎉';
      $('#fDist').textContent = db.done.length + ' link(s) feitos nesta sessão';
      $('#fLink').textContent = 'Toque em Recalcular se algo mudou.';
      $('#fDone').disabled = $('#fFail').disabled = true;
      return;
    }
    $('#fDone').disabled = $('#fFail').disabled = false;
    var p = portalById(s.portal), q = portalById(l.to);
    $('#fStep').textContent = 'Passo 1 de ' + plan.steps.length + ' · link #' + l.n;
    $('#fTarget').textContent = 'Vá até ' + (p ? p.nome : '?');
    if (pos && p) {
      var d = FPGeo.haversine(pos, p), br = FPGeo.bearing(pos, p);
      var rel = typeof pos.heading === 'number' && isFinite(pos.heading) ? br - pos.heading : br;
      $('#arrow').style.transform = 'rotate(' + rel + 'deg)';
      $('#fDist').textContent = (d < 40 ? 'Você chegou · ' : '') + fmtDist(d) + ' · rumo ' + Math.round(br) + '° ' + compass(br) +
        (typeof pos.heading === 'number' && isFinite(pos.heading) ? '' : ' (seta relativa ao norte)');
    } else {
      $('#fDist').textContent = 'Sem GPS';
    }
    var link = $('#fLink');
    link.textContent = '';
    link.appendChild(el('div', null, [el('span', { class: 'num', text: '#' + l.n }), document.createTextNode((p ? p.nome : '?') + ' → ' + (q ? q.nome : '?'))]));
    var rest = s.links.slice(1).map(function (x) { return '#' + x.n + ' → ' + pname(x.to); }).join(', ');
    link.appendChild(el('small', { text: (l.fields ? '+' + l.fields + ' campo(s) · ' : '') + 'chaves de ' + (q ? q.nome : '?') + ': ' + (q ? q.chaves : 0) + (rest ? ' · depois: ' + rest : '') }));
  }

  function snapshot() {
    return JSON.stringify({ done: db.done, excluded: db.excluded, blockers: db.blockers, coveredManual: db.coveredManual,
      keys: db.portals.map(function (p) { return [p.id, p.chaves]; }) });
  }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 30) undoStack.shift(); }

  // Remove o link atual do plano local para a UI responder na hora; o recálculo substitui depois.
  function advanceLocal() {
    var s = currentStep();
    if (!s) return;
    var l = s.links.shift();
    plan.links = plan.links.filter(function (x) { return x.n !== l.n; });
    if (!s.links.length) plan.steps.shift();
    renderPlanOnMap();
    renderField();
  }

  $('#fDone').addEventListener('click', function () {
    var l = currentLink();
    if (!l) return;
    pushUndo();
    db.done.push({ from: l.from, to: l.to, ts: Date.now() });
    var q = portalById(l.to);
    if (q) q.chaves = Math.max(0, q.chaves - 1);
    save();
    if (navigator.vibrate) navigator.vibrate(30);
    advanceLocal();
    renderLinks();
    optimize('link #' + l.n + ' concluído');
  });

  $('#fFail').addEventListener('click', function () {
    var l = currentLink();
    if (!l) return;
    failTarget = { n: l.n, from: l.from, to: l.to }; // congelado: um recálculo pode chegar com o diálogo aberto
    $('#failWhat').textContent = 'Link #' + l.n + ': ' + pname(l.from) + ' → ' + pname(l.to);
    $('#failDlg').returnValue = '';
    $('#failDlg').showModal();
  });
  var failTarget = null;
  $('#failDlg').addEventListener('close', function () {
    var v = $('#failDlg').returnValue, l = failTarget;
    failTarget = null;
    if (!l || !v || v === 'cancel') return;
    if (v === 'blocked') {
      // registra o bloqueador que o jogador viu e recalcula
      openBlockerDlg(null, null, function () { pushUndoAfter(); optimize('bloqueador adicionado'); renderAll(); });
      return;
    }
    pushUndo();
    if (v === 'nokey') {
      var q = portalById(l.to);
      if (q) q.chaves = 0;
    } else if (v === 'covered') {
      if (db.coveredManual.indexOf(l.from) < 0) db.coveredManual.push(l.from);
    } else {
      db.excluded.push({ from: l.from, to: l.to, ts: Date.now() });
    }
    save();
    var cur = currentLink();
    if (cur && cur.from === l.from && cur.to === l.to) advanceLocal(); // só se o plano não mudou
    optimize('link #' + l.n + ' falhou');
    renderAll();
  });
  // Desfazer de bloqueador: o snapshot é tirado antes do push; reconstruímos removendo o último.
  function pushUndoAfter() {
    var last = db.blockers[db.blockers.length - 1];
    var snap = JSON.parse(snapshot());
    snap.blockers = snap.blockers.filter(function (b) { return b !== last && b.id !== last.id; });
    undoStack.push(JSON.stringify(snap));
  }

  $('#fUndo').addEventListener('click', function () {
    var s = undoStack.pop();
    if (!s) { toast('Nada para desfazer'); return; }
    var snap = JSON.parse(s);
    db.done = snap.done; db.excluded = snap.excluded; db.blockers = snap.blockers; db.coveredManual = snap.coveredManual;
    snap.keys.forEach(function (kv) { var p = portalById(kv[0]); if (p) p.chaves = kv[1]; });
    save();
    optimize('desfeito');
    renderAll();
  });
  $('#fRecalc').addEventListener('click', function () { optimize('recalculado manualmente'); });
  $('#fExit').addEventListener('click', function () { setFieldMode(false); });

  /* ------------------------------------------------------------ */
  /* Folha inferior, abas, rede, service worker.                   */
  /* ------------------------------------------------------------ */

  var sheet = $('#sheet');
  $('#grab').addEventListener('click', function () { sheet.classList.toggle('min'); });
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () {
      var already = b.getAttribute('aria-selected') === 'true';
      document.querySelectorAll('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      document.querySelectorAll('.sheet-body section').forEach(function (s) { s.hidden = s.id !== 'tab-' + b.dataset.tab; });
      if (already) sheet.classList.toggle('min'); else sheet.classList.remove('min');
    });
  });

  function updateOnline() { $('#offChip').hidden = navigator.onLine; }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  $('#versionInfo').textContent = 'Versão ' + VERSION + ' · dados em localStorage deste navegador.';

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      // procura versão nova ao voltar para o app e a cada 30 min
      document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update().catch(function () {}); });
      setInterval(function () { reg.update().catch(function () {}); }, 30 * 60 * 1000);
    }).catch(function (e) { console.warn('[FP] SW não registrado', e); });
    // Versão nova assumiu: avisa (não recarrega sozinho para não interromper o modo em campo)
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; } // primeira instalação, nada a avisar
      var justOpened = performance.now() < 20000;
      var busyUi = fieldMode || plan || document.querySelector('dialog[open]'); // plano só existe em memória
      if (justOpened && !busyUi) { location.reload(); return; } // acabou de abrir: troca já
      var bar = $('#updateBar');
      if (bar) bar.hidden = false;
    });
    var updBar = $('#updateBar');
    if (updBar) updBar.addEventListener('click', function () { location.reload(); });
  }

  renderAll();
})();
