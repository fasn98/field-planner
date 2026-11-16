/*
 * Field Planner — interface.
 * Rede: apenas tiles do OpenStreetMap (via Leaflet) e os próprios arquivos do app.
 * Nenhum dado sai do aparelho. GPS é somente leitura (navigator.geolocation).
 */
/* global L, FPGeo, FPPlan, FPMatch, FPRead */
(function () {
  'use strict';

  var STORE = 'fieldplanner.v1';
  var VERSION = '1.10.0';
  // nível padrão de portal novo ou importado sem nível: L1 só alcança 160 m e quase nunca fecha campo
  var DEFAULT_LEVEL = 5;
  // Qualquer string de 1–64 caracteres sem controle. A segurança contra "constructor"/"__proto__"
  // vem dos mapas sem protótipo; filtrar mais trocaria ids e órfãos bloqueadores/links feitos.
  var ID_RE = /^[^\u0000-\u001f\u007f]{1,64}$/;
  var MOVE_RECALC_M = FPPlan.MOVE_RECALC_M; // recálculo automático só em plano solto (FPPlan.autoRecalcReason)
  var LEVEL_COLORS = ['#fece5a', '#ffa630', '#ff7315', '#e40000', '#fd2992', '#eb26cd', '#c124e0', '#9627f4'];

  var $ = function (s) { return document.querySelector(s); };

  /* ------------------------------------------------------------ */
  /* Persistência (localStorage).                                  */
  /* ------------------------------------------------------------ */

  function emptyDb() {
    return {
      version: 1, portals: [], blockers: [], done: [], excluded: [], coveredManual: [], lastImport: null, plan: null,
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
      d.plan = FPPlan.sanitizeRecord(d.plan); // plano salvo: restaurado como está, sem recalcular
      return d;
    } catch (e) {
      console.warn('[FP] falha ao ler dados locais', e);
      return emptyDb();
    }
  }
  function save() {
    validationMemo = null;
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
      nivel: clampInt(p.nivel, 1, 8, DEFAULT_LEVEL),
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
  map.on('contextmenu', function (e) { if (!moving) openPortalDlg(null, e.latlng); });

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
      m.on('click', function () { if (!moving) openPortalDlg(p); });
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
      if (nm.sharedQueue.length) flushSharedQueue();
      if (!centeredOnce && !db.portals.length) { map.setView([pos.lat, pos.lng], 16); centeredOnce = true; }
      if (plan && !busy) {
        var why = FPPlan.autoRecalcReason(db.plan, { type: 'gps', fieldMode: fieldMode, lastPos: lastOptPos,
          moved: lastOptPos ? FPGeo.haversine(lastOptPos, pos) : 0 });
        if (why) optimize(why);
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

  // plano em uso = db.plan.result (salvo no localStorage com as entradas do cálculo; ver plan.js)
  var plan = db.plan ? db.plan.result : null, lastOptAt = db.plan ? db.plan.ts : 0, reqSeq = 0, busy = false;
  if (plan) lastOptPos = plan.origin;
  var validationMemo = null;
  function isPinned() { return !!(plan && db.plan && db.plan.pinned); }
  function updateOptBtn() {
    var b = $('#optBtn');
    b.disabled = busy;
    b.textContent = busy ? 'Calculando…' : isPinned() ? '⟳ Recalcular' : 'Calcular plano';
  }
  /** Ignora respostas do otimizador ainda a caminho (o plano atual passou a valer). */
  function cancelPending() { reqSeq++; busy = false; updateOptBtn(); }
  function liveData() {
    return { portals: db.portals, blockers: db.blockers, done: db.done, excluded: db.excluded, coveredManual: db.coveredManual, maxOut: db.settings.maxOut };
  }
  /** Validação do plano salvo contra os dados atuais (memorizada até o próximo save()). */
  function planValidation() {
    if (!plan || !db.plan) return null;
    if (!validationMemo) validationMemo = FPPlan.validate(db.plan, liveData());
    return validationMemo;
  }
  // geração do plano em uso: o desfazer só devolve passos ao mesmo plano em que foram tirados
  var planGen = 0;
  function setPlanRecord(rec) {
    planGen++;
    db.plan = rec;
    plan = rec ? rec.result : null;
    lastOptPos = plan ? plan.origin : null;
    lastOptAt = rec ? rec.ts : 0;
    save();
  }
  var worker = null;
  try { worker = new Worker('worker.js'); } catch (e) { console.error('[FP] worker indisponível', e); }

  if (worker) worker.onerror = function (e) {
    busy = false;
    updateOptBtn();
    toastError('Falha ao carregar o otimizador' + (e && e.message ? ': ' + e.message : ''));
  };
  if (worker) worker.onmessage = function (e) {
    var m = e.data;
    if (m.reqId !== reqSeq) return; // resposta antiga
    busy = false;
    if (m.type === 'error') { updateOptBtn(); toastError('Erro no otimizador: ' + m.error); return; }
    var res = m.result;
    res.reason = pendingReason;
    res.origin = pendingOrigin; // posição usada neste cálculo (ponto A da rota)
    // padrão: plano de simulação é fixado ao ser salvo; recálculo pedido de um plano fixado continua fixado
    var pin = !!res.links.length && (res.simulation || pendingPin);
    setPlanRecord(FPPlan.makeRecord(res, { origin: pendingOrigin, settings: pendingSettings, appVersion: VERSION, pinned: pin, portals: db.portals, ts: lastOptAt }));
    renderAll();
    if (pendingReason && fieldMode) toast('Plano recalculado: ' + pendingReason);
    else if (!plan.links.length) toast('Nenhum link possível com os dados atuais', 4000);
    else if (pin && !pendingPin) toast('📌 Plano de simulação fixado: não muda sozinho', 4000);
  };

  var pendingReason = '', pendingOrigin = null, pendingPin = false, pendingSettings = null, pendingManual = false;
  /** Dados mudaram com um cálculo a caminho: refaz o pedido com os dados novos (a resposta antiga é descartada). */
  function restartPending() { if (busy) optimize(pendingReason, pendingManual); }
  function optimize(reason, manual) {
    if (!worker) { toast('Seu navegador não suporta Web Workers'); return; }
    if (db.portals.length < 2) { if (busy) cancelPending(); toast('Cadastre pelo menos 2 portais'); return; } // resposta a caminho viria de dados apagados
    var s = db.settings;
    pendingPin = !!manual && isPinned();
    pendingManual = !!manual;
    pendingSettings = Object.assign({}, s);
    lastOptPos = pos ? { lat: pos.lat, lng: pos.lng } : null;
    pendingOrigin = lastOptPos;
    lastOptAt = Date.now();
    pendingReason = reason || '';
    busy = true;
    updateOptBtn();
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

  /** Recálculo automático (GPS, tempo, dados, simulação, modo em campo): nunca num plano fixado. */
  function autoOptimize(reason) {
    if (!FPPlan.autoRecalcReason(db.plan, { type: 'auto', reason: reason })) { restartPending(); return false; }
    optimize(reason);
    return true;
  }
  /** Recálculo pedido pelo usuário: num plano fixado, só com confirmação. */
  function manualOptimize(reason) {
    if (!isPinned()) { optimize(reason); return; }
    confirmDialog('Recalcular plano', 'Isso substitui o plano fixado. Continuar?').then(function (ok) {
      if (ok) optimize(reason, true);
    });
  }

  // Recálculo periódico (a cada 5 min) quando há plano em uso.
  setInterval(function () {
    var why = plan && !busy && FPPlan.autoRecalcReason(db.plan, { type: 'timer', fieldMode: fieldMode, elapsedMs: Date.now() - lastOptAt });
    if (why) optimize(why);
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
      if (!simChanged || !plan) return;
      if (autoOptimize(db.settings.simulate ? 'simulação ligada' : 'simulação desligada')) return;
      // plano fixado: desligar a simulação reaproveita o mesmo plano, revalidado com as chaves reais
      if (!db.settings.simulate && plan.simulation) leaveSimulation();
      else renderPlanPanel();
    });
  });

  /** Simulação → campo sem recalcular: mesma ordem e mesmos links, conferidos com as chaves de agora. */
  function leaveSimulation() {
    var v = FPPlan.toFieldPlan(db.plan, liveData());
    if (!v.ok) {
      var first = v.issues[0];
      toastError('O plano fixado continua como simulação: ' + (first.step ? 'passo ' + first.step + ', link #' + first.n + ': ' : '') + first.text +
        (v.issues.length > 1 ? ' (e mais ' + (v.issues.length - 1) + ')' : ''));
      renderPlanPanel();
      return false;
    }
    db.settings.simulate = false;
    cfg.simulate.checked = false;
    save();
    renderAll();
    toast('Plano fixado pronto para o modo em campo: mesma ordem e mesmos links', 4000);
    return true;
  }

  $('#optBtn').addEventListener('click', function () { manualOptimize(''); });
  $('#startBtn').addEventListener('click', function () {
    if (plan && plan.simulation && !leaveSimulation()) return;
    setFieldMode(true);
  });
  $('#pinBtn').addEventListener('click', function () {
    if (!plan || !db.plan) return;
    db.plan.pinned = !db.plan.pinned;
    if (db.plan.pinned) cancelPending(); // um recálculo a caminho não substitui o plano que acabou de ser fixado
    else pendingPin = false;             // soltou durante o Recalcular: o resultado chega solto
    save();
    renderPlanPanel();
    toast(db.plan.pinned ? '📌 Plano fixado: só muda pelo Recalcular' : 'Plano solto: volta a recalcular sozinho em campo');
  });

  var STRAT_NAMES = { fanfield: 'Fanfield', triangulacao: 'Triangulação', multicamada: 'Multicamada' };

  function renderPlanPanel() {
    var out = $('#planOut');
    out.textContent = '';
    updateOptBtn();
    var pinBtn = $('#pinBtn');
    pinBtn.disabled = !(plan && plan.links.length);
    pinBtn.textContent = isPinned() ? '📌 Fixado · soltar' : '📌 Fixar plano';
    pinBtn.classList.toggle('on', isPinned());
    var kn = plan ? FPPlan.keyNeeds(plan, db.portals) : null;
    // simulação só vai para o modo em campo fixada e com todas as chaves (mesmo plano, sem recalcular)
    $('#startBtn').disabled = !(plan && plan.links.length) || !!(plan.simulation && !(isPinned() && !kn.totalMissing));
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
    if (isPinned()) {
      out.appendChild(el('div', { class: 'pin-banner', text: '📌 Plano fixado (calculado em ' + new Date(db.plan.ts).toLocaleString('pt-BR') +
        (db.plan.appVersion ? ', v' + db.plan.appVersion : '') + '). Não muda com GPS, tempo, chaves ou edição de portais: só pelo ⟳ Recalcular.' }));
    }
    var val = busy ? null : planValidation();
    if (val && !val.ok) {
      var box = el('div', { class: 'plan-warn' }, [el('b', { text: '⚠ O plano não bate com os dados atuais' +
        (val.steps.length ? ' (passo' + (val.steps.length > 1 ? 's ' : ' ') + val.steps.join(', ') + ')' : '') + ':' })]);
      var wl = el('ul');
      val.issues.slice(0, 8).forEach(function (x) {
        wl.appendChild(el('li', { text: (x.step ? 'Passo ' + x.step + ' · link #' + x.n + ': ' : '') + x.text }));
      });
      if (val.issues.length > 8) wl.appendChild(el('li', { text: 'e mais ' + (val.issues.length - 8) + '.' }));
      box.appendChild(wl);
      box.appendChild(el('div', { class: 'small', text: isPinned() ? 'O plano fixado não foi recalculado. Corrija os dados ou toque em ⟳ Recalcular.' : 'Toque em Calcular plano para refazer.' }));
      out.appendChild(box);
    }
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
      renderRouteExport(out);
    }
    if (plan.simulation) {
      out.appendChild(el('div', { class: 'sim-banner', text: '🧪 Simulação: plano ideal pela posição dos portais, sem considerar suas chaves. ' +
        (isPinned() && !kn.totalMissing && plan.links.length
          ? '✅ Você já tem todas as chaves: toque em Modo em campo para executar este mesmo plano, sem recalcular.'
          : 'Use a lista de farm abaixo para buscar as chaves; com todas elas, o Modo em campo executa este mesmo plano.') }));
    }
    if (plan.fields.length) {
      out.appendChild(el('p', { class: 'muted small', text: 'Área total dos campos: ' + fmtArea(plan.area) +
        ' — o MU real é proporcional à área × densidade populacional local (desconhecida).' }));
    }
    var meta = (STRAT_NAMES[plan.strategy] || '–') + (plan.anchor ? ' · âncora: ' + pname(plan.anchor) : '') +
      (plan.base ? ' · base: ' + pname(plan.base[0]) + ' – ' + pname(plan.base[1]) + ' · ' + plan.layers + ' camada(s)' : '') +
      ' · ' + (plan.inRadius > plan.candidates
        ? plan.candidates + ' de ' + plan.inRadius + ' portais ' + (plan.origin ? 'no raio ' : '') + 'considerados (com chave e mais próximos primeiro)'
        : plan.candidates + ' portal(is) no raio') + ' · ' + plan.elapsedMs + ' ms';
    out.appendChild(el('p', { class: 'muted small', text: meta }));

    if (!plan.links.length) {
      out.appendChild(el('p', { class: 'muted', text: 'Nenhum link possível.' }));
      // diz qual é o motivo mais provável, em vez de uma lista genérica
      // só os portais que entram no cálculo (dentro do raio, quando há GPS)
      var noRaio = db.portals.filter(function (p) { return !plan.origin || FPGeo.haversine(plan.origin, p) <= db.settings.radius; });
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

    renderKeys(out, kn);
  }

  /** Chaves consumidas, faltantes e lista de farm, sempre com as chaves de agora (db.portals). */
  function renderKeys(out, kn) {
    var keyRow = function (k) { return el('li', null, [el('b', { text: pname(k.portal) }), el('span', { class: 'muted', text: ' · faltam ' + k.missing + ' (precisa ' + k.need + ', tem ' + k.have + ')' })]); };
    if (kn.used.length) {
      out.appendChild(el('h3', { text: 'Chaves consumidas' }));
      var tb = el('tbody');
      kn.used.forEach(function (k) {
        tb.appendChild(el('tr', { class: k.used > k.have ? 'short' : '' }, [el('td', { text: pname(k.portal) }), el('td', { class: 'n', text: String(k.used) }), el('td', { class: 'n', text: String(k.have) })]));
      });
      out.appendChild(el('table', null, [el('thead', null, [el('tr', null, [el('th', { text: 'Portal' }), el('th', { class: 'n', text: 'usar' }), el('th', { class: 'n', text: 'tem' })])]), tb]));
    }
    if (kn.missing.length) {
      out.appendChild(el('h3', { text: plan.simulation ? '🔑 Lista de farm' : 'Chaves faltantes' }));
      out.appendChild(el('p', { class: 'farm-total', text: 'Faltam ' + kn.totalMissing + ' chave(s) em ' + kn.missing.length + ' portal(is) para executar este plano.' }));
      var ul = el('ul', { class: 'list' });
      kn.missing.forEach(function (k) { ul.appendChild(keyRow(k)); });
      out.appendChild(ul);
    }
    if (kn.extra.length) {
      out.appendChild(el('h3', { text: 'Chaves para mais campos' }));
      var gain = plan.potentialFields - plan.fields.length;
      if (gain > 0) out.appendChild(el('p', { class: 'muted small', text: 'Com essas chaves, a mesma rota renderia ' + plan.potentialFields + ' campos (+' + gain + ').' }));
      var ux = el('ul', { class: 'list' });
      kn.extra.forEach(function (k) { ux.appendChild(keyRow(k)); });
      out.appendChild(ux);
    }
  }

  /* ------------------------------------------------------------ */
  /* Exportar: rota no Google Maps e relatório em PDF.             */
  /* ------------------------------------------------------------ */

  var mapsMode = 'walk';
  // sem transporte público: nesse modo o Google Maps não aceita paradas intermediárias
  var MAPS_MODE_NAMES = { walk: '🚶 a pé', car: '🚗 carro', bike: '🚲 bicicleta' };

  /** Paradas do plano, na ordem, como {lat,lng,nome}. */
  function planStops() {
    var out = [];
    if (plan) plan.steps.forEach(function (s, i) { var p = portalById(s.portal); if (p) out.push({ lat: p.lat, lng: p.lng, step: i + 1 }); });
    return out;
  }
  /** Links do Google Maps com from/to = número do passo no plano. */
  function planMapsLinks(stops) {
    return FPGeo.mapsRouteUrls(stops, mapsMode).map(function (r) {
      return { url: r.url, from: stops[r.from - 1].step, to: stops[r.to - 1].step };
    });
  }

  function mapsLinkEls(links, total) {
    return links.map(function (r, i) {
      var label = links.length === 1 ? 'Abrir rota no Google Maps (' + total + ' paradas)'
        : 'Trecho ' + (i + 1) + ': paradas ' + r.from + '–' + r.to;
      return el('a', { class: 'btn grow', href: r.url, target: '_blank', rel: 'noopener noreferrer', text: '🧭 ' + label });
    });
  }

  function renderRouteExport(out) {
    var stops = planStops();
    if (!stops.length) return;
    var links = planMapsLinks(stops);
    var sel = el('select', { 'aria-label': 'Modo da rota', onchange: function (e) { mapsMode = e.target.value; renderPlanPanel(); } });
    Object.keys(MAPS_MODE_NAMES).forEach(function (k) {
      var o = el('option', { value: k, text: MAPS_MODE_NAMES[k] });
      if (k === mapsMode) o.selected = true;
      sel.appendChild(o);
    });
    var box = el('div', { class: 'export-box' }, [
      el('div', { class: 'row' }, [el('b', { class: 'grow', text: 'Rota no Google Maps' }), sel])
    ]);
    mapsLinkEls(links, stops.length).forEach(function (a) { box.appendChild(el('div', { class: 'row' }, [a])); });
    box.appendChild(el('p', { class: 'muted small', text: (links.length > 1
      ? 'O Google Maps aceita até ' + (FPGeo.MAPS_MAX_WAYPOINTS + 1) + ' paradas por rota: abra um trecho de cada vez (cada um começa onde o anterior terminou). '
      : '') + 'A rota parte da sua posição atual. Funciona melhor no app Google Maps (no navegador do celular o Google pode aceitar menos paradas). ' +
      'Abrir o link é com você: o app não envia nada ao Google.' }));
    box.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn grow', text: '📄 Exportar plano em PDF', onclick: printPlan })]));
    out.appendChild(box);
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  /** Croqui do plano em SVG (sem mapa de fundo): campos, links numerados, rota e paradas. */
  function planSketch() {
    var ids = Object.create(null);
    plan.links.forEach(function (l) { ids[l.from] = ids[l.to] = true; });
    plan.steps.forEach(function (s) { ids[s.portal] = true; });
    var pts = Object.keys(ids).map(portalById).filter(Boolean);
    if (plan.origin) pts.push(plan.origin);
    if (!pts.length) return null;
    var pr = FPGeo.makeProjection(FPGeo.centroid(pts));
    var xy = pts.map(pr.toXY);
    var minX = Math.min.apply(null, xy.map(function (q) { return q.x; })), maxX = Math.max.apply(null, xy.map(function (q) { return q.x; }));
    var minY = Math.min.apply(null, xy.map(function (q) { return q.y; })), maxY = Math.max.apply(null, xy.map(function (q) { return q.y; }));
    var W = 700, H = 460, pad = 30;
    var k = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1), (H - 2 * pad) / Math.max(maxY - minY, 1));
    var ox = (W - (maxX - minX) * k) / 2, oy = (H - (maxY - minY) * k) / 2;
    var P = function (p) { var q = pr.toXY(p); return { x: ox + (q.x - minX) * k, y: H - (oy + (q.y - minY) * k) }; }; // norte para cima
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'sketch', role: 'img', 'aria-label': 'Croqui do plano' });
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff', stroke: '#999' }));
    plan.fields.forEach(function (f) {
      var q = f.portals.map(portalById);
      if (q.some(function (p) { return !p; })) return;
      svg.appendChild(svgEl('polygon', { points: q.map(P).map(function (c) { return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' '),
        fill: '#2dd4bf', 'fill-opacity': '0.18', stroke: '#0f766e', 'stroke-width': '0.8' }));
    });
    var route = [];
    if (plan.origin) route.push(P(plan.origin));
    plan.steps.forEach(function (s) { var p = portalById(s.portal); if (p) route.push(P(p)); });
    if (route.length > 1) svg.appendChild(svgEl('polyline', { points: route.map(function (c) { return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' '),
      fill: 'none', stroke: '#d97706', 'stroke-width': '1.5', 'stroke-dasharray': '6 4' }));
    plan.links.forEach(function (l) {
      var a = portalById(l.from), b = portalById(l.to);
      if (!a || !b) return;
      var A = P(a), B = P(b);
      svg.appendChild(svgEl('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: '#0f766e', 'stroke-width': '1.6' }));
      var mx = A.x + (B.x - A.x) * 0.4, my = A.y + (B.y - A.y) * 0.4;
      svg.appendChild(svgEl('text', { x: mx, y: my + 3, 'font-size': '9', 'text-anchor': 'middle', fill: '#0f766e', stroke: '#fff', 'stroke-width': '2.5', 'paint-order': 'stroke' }, String(l.n)));
    });
    pts.forEach(function (p) {
      if (p === plan.origin) return;
      var c = P(p);
      svg.appendChild(svgEl('circle', { cx: c.x, cy: c.y, r: 4, fill: '#f59e0b', stroke: '#78350f', 'stroke-width': '1' }));
    });
    if (plan.origin) {
      var o = P(plan.origin);
      svg.appendChild(svgEl('circle', { cx: o.x, cy: o.y, r: 7, fill: '#2563eb' }));
      svg.appendChild(svgEl('text', { x: o.x, y: o.y + 3.5, 'font-size': '9', 'text-anchor': 'middle', fill: '#fff', 'font-weight': 'bold' }, 'A'));
    }
    plan.steps.forEach(function (s, i) {
      var p = portalById(s.portal);
      if (!p) return;
      var c = P(p);
      svg.appendChild(svgEl('text', { x: c.x + 6, y: c.y - 6, 'font-size': '11', 'font-weight': 'bold', fill: '#b45309', stroke: '#fff', 'stroke-width': '3', 'paint-order': 'stroke' }, String(i + 1)));
    });
    // escala: barra de 100/200/500 m… que caiba em ~1/4 da largura
    var opts = [50, 100, 200, 500, 1000, 2000, 5000], len = opts[0];
    opts.forEach(function (m) { if (m * k <= W / 4) len = m; });
    if (len * k <= W - 28) {
      svg.appendChild(svgEl('line', { x1: 14, y1: H - 14, x2: 14 + len * k, y2: H - 14, stroke: '#111', 'stroke-width': '2' }));
      svg.appendChild(svgEl('text', { x: 14, y: H - 20, 'font-size': '10', fill: '#111' }, fmtDist(len)));
    }
    svg.appendChild(svgEl('text', { x: W - 14, y: 20, 'font-size': '12', 'text-anchor': 'end', fill: '#111' }, 'N ↑'));
    return svg;
  }

  function buildPrintReport() {
    var r = $('#printReport');
    r.textContent = '';
    var now = new Date();
    r.appendChild(el('h1', { text: 'Plano de campos' }));
    r.appendChild(el('p', { class: 'pr-meta', text: 'Field Planner v' + VERSION + ' · ' + now.toLocaleString('pt-BR') +
      (plan.origin ? ' · partida A: ' + plan.origin.lat.toFixed(5) + ', ' + plan.origin.lng.toFixed(5) : '') +
      (isPinned() ? ' · 📌 plano fixado, calculado em ' + new Date(db.plan.ts).toLocaleString('pt-BR') : '') }));
    if (plan.simulation) r.appendChild(el('p', { class: 'pr-warn', text: 'Simulação: plano ideal pela posição dos portais, sem considerar suas chaves. Use a lista de farm para buscar as chaves antes de executar.' }));
    var tt = FPGeo.travelTimes(plan.steps.map(function (s) { return s.walk; }), plan.links.length);
    r.appendChild(el('table', { class: 'pr-stats' }, [el('tbody', null, [
      el('tr', null, [el('th', { text: 'Campos' }), el('td', { text: String(plan.fields.length) }), el('th', { text: 'Links' }), el('td', { text: String(plan.links.length) }),
        el('th', { text: 'AP' }), el('td', { text: fmtNum(plan.ap) })]),
      el('tr', null, [el('th', { text: 'Distância' }), el('td', { text: fmtDist(plan.distance) }), el('th', { text: 'Área' }), el('td', { text: fmtArea(plan.area) }),
        el('th', { text: 'Estratégia' }), el('td', { text: STRAT_NAMES[plan.strategy] || '–' })]),
      el('tr', null, [el('th', { text: 'A pé' }), el('td', { text: fmtMin(tt.walk) }), el('th', { text: 'Carro' }), el('td', { text: fmtMin(tt.car) }),
        el('th', { text: 'Transporte' }), el('td', { text: fmtMin(tt.transit) })])
    ])]));
    var sk = planSketch();
    if (sk) {
      r.appendChild(el('h2', { text: 'Croqui' }));
      r.appendChild(sk);
      r.appendChild(el('p', { class: 'pr-note', text: 'Laranja: rota a pé (A = partida, números = paradas). Verde: links (número = ordem) e campos. Sem mapa de fundo; escala aproximada.' }));
    }
    var stops = planStops();
    if (stops.length) {
      r.appendChild(el('h2', { text: 'Rota no Google Maps (' + MAPS_MODE_NAMES[mapsMode].replace(/^\S+\s/, '') + ')' }));
      var ul = el('ul', { class: 'pr-links' });
      planMapsLinks(stops).forEach(function (x, i, all) {
        ul.appendChild(el('li', null, [el('a', { href: x.url, text: all.length === 1 ? 'Rota completa (' + stops.length + ' paradas)' : 'Trecho ' + (i + 1) + ': paradas ' + x.from + '–' + x.to })]));
      });
      r.appendChild(ul);
    }
    r.appendChild(el('h2', { text: 'Passos' }));
    var tb = el('tbody');
    plan.steps.forEach(function (s, i) {
      var p = portalById(s.portal);
      tb.appendChild(el('tr', null, [
        el('td', { class: 'n', text: String(i + 1) }),
        el('td', null, [el('b', { text: pname(s.portal) }), p ? el('div', { class: 'pr-ll', text: p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + ' · L' + p.nivel }) : null]),
        el('td', { class: 'n', text: fmtDist(s.walk) }),
        el('td', { text: s.links.map(function (l) {
          return '#' + l.n + ' → ' + pname(l.to) + (l.fields ? ' (+' + l.fields + ' campo' + (l.fields > 1 ? 's' : '') + ')' : '');
        }).join('; ') })
      ]));
    });
    r.appendChild(el('table', { class: 'pr-table' }, [el('thead', null, [el('tr', null, [
      el('th', { class: 'n', text: '#' }), el('th', { text: 'Ir até' }), el('th', { class: 'n', text: 'Andar' }), el('th', { text: 'Links' })])]), tb]));
    var kn = FPPlan.keyNeeds(plan, db.portals); // chaves de agora, não as do momento do cálculo
    if (kn.used.length) {
      r.appendChild(el('h2', { text: 'Chaves consumidas' }));
      var kb = el('tbody');
      kn.used.forEach(function (k) {
        kb.appendChild(el('tr', null, [el('td', { text: pname(k.portal) }), el('td', { class: 'n', text: String(k.used) }), el('td', { class: 'n', text: String(k.have) })]));
      });
      r.appendChild(el('table', { class: 'pr-table' }, [el('thead', null, [el('tr', null, [el('th', { text: 'Portal' }), el('th', { class: 'n', text: 'Usar' }), el('th', { class: 'n', text: 'Tem' })])]), kb]));
    }
    [[kn.missing, plan.simulation ? 'Lista de farm' : 'Chaves faltantes'], [kn.extra, 'Chaves para mais campos']].forEach(function (sec) {
      if (!sec[0].length) return;
      var total = sec[0].reduce(function (a, k) { return a + k.missing; }, 0);
      r.appendChild(el('h2', { text: sec[1] }));
      r.appendChild(el('p', { text: 'Faltam ' + total + ' chave(s) em ' + sec[0].length + ' portal(is).' }));
      var fb = el('tbody');
      sec[0].forEach(function (k) {
        fb.appendChild(el('tr', null, [el('td', { text: '☐ ' + pname(k.portal) }), el('td', { class: 'n', text: String(k.missing) }), el('td', { class: 'n', text: k.have + ' / ' + k.need })]));
      });
      r.appendChild(el('table', { class: 'pr-table' }, [el('thead', null, [el('tr', null, [el('th', { text: 'Portal' }), el('th', { class: 'n', text: 'Faltam' }), el('th', { class: 'n', text: 'Tem / precisa' })])]), fb]));
    });
    r.appendChild(el('p', { class: 'pr-note', text: 'Gerado no aparelho pelo Field Planner. Posições inseridas pelo usuário (podem ser aproximadas); confira no jogo. O plano não substitui o jogo: toda ação acontece em campo.' }));
  }

  var printing = false;
  function printPlan() {
    if (!plan || !plan.steps.length) { toast('Calcule um plano antes'); return; }
    if (typeof window.print !== 'function') { toast('Este navegador não permite imprimir/salvar PDF', 4000); return; }
    if (printing) return;
    printing = true;
    buildPrintReport();
    var title = document.title, d = new Date();
    // o nome do PDF sugerido pelo navegador vem do título da página
    document.title = 'plano-campos-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    document.body.classList.add('printing');
    var restore = function () {
      if (!printing) return;
      printing = false;
      document.title = title;
      document.body.classList.remove('printing');
      window.removeEventListener('afterprint', restore);
      document.removeEventListener('pointerdown', restore, true);
    };
    // no Android window.print() não bloqueia e afterprint nem sempre chega: volta ao normal no afterprint
    // ou no primeiro toque depois de fechar a janela de impressão (nunca por tempo, para não imprimir em branco)
    window.addEventListener('afterprint', restore);
    setTimeout(function () { document.addEventListener('pointerdown', restore, true); }, 1500);
    toast('Na janela de impressão, escolha "Salvar como PDF"', 4000);
    setTimeout(function () { window.print(); }, 50);
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

  var lastKeyUndo = null;
  function bumpKeys(p, d) {
    // o desfazer restaura todos os portais: cada mudança precisa do seu ponto de volta; toques seguidos
    // no mesmo portal (até 10 s) contam como um só, para não empurrar os links feitos para fora da pilha
    var now = Date.now();
    // undoPushes (não o tamanho da pilha, que fica fixo em 30 quando cheia) diz se outra ação entrou no meio
    if (!lastKeyUndo || lastKeyUndo.id !== p.id || now - lastKeyUndo.t > 10000 || lastKeyUndo.pushes !== undoPushes) pushUndo();
    lastKeyUndo = { id: p.id, t: now, pushes: undoPushes };
    p.chaves = clampInt(p.chaves + d, 0, 999, 0);
    save();
    renderPortals();
    renderPortalList();
    renderPlanPanel(); // "tem", farm e faltantes vêm das chaves de agora
    renderField();
    restartPending(); // cálculo a caminho foi pedido com as chaves de antes
  }

  var levelSel = $('#portalForm').elements.nivel;
  for (var lv = 1; lv <= 8; lv++) levelSel.appendChild(el('option', { value: String(lv), text: 'L' + lv }));

  var editing = null;
  function openPortalDlg(p, latlng, prefill) {
    editing = p;
    var f = $('#portalForm').elements;
    $('#portalDlgTitle').textContent = p ? 'Editar portal' : 'Novo portal';
    $('#portalDelete').hidden = !p;
    $('#portalMove').hidden = !p;
    f.nome.value = p ? p.nome : (prefill && prefill.nome) || '';
    f.link.value = '';
    var ll = p || latlng || (prefill && prefill.coords) || null;
    f.lat.value = ll ? (+ll.lat).toFixed(6) : '';
    f.lng.value = ll ? (+ll.lng).toFixed(6) : '';
    f.nivel.value = String(p ? p.nivel : DEFAULT_LEVEL);
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
      if (editing) { pushUndo(); Object.assign(editing, data); } else db.portals.push(data);
      save();
      invalidatePlan();
      toast(editing ? 'Portal atualizado' : 'Portal adicionado');
    } else if (v === 'move' && editing) {
      startMove(editing);
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

  // Mover portal no mapa: arrastar o marcador ou tocar no ponto certo.
  // Útil para corrigir posições vindas de importação crua (print de mapa).
  var moving = null;
  function resetPageZoom() {
    var vv = window.visualViewport, meta = document.querySelector('meta[name=viewport]');
    if (!vv || !meta || vv.scale <= 1.01) return;
    var c = meta.getAttribute('content');
    meta.setAttribute('content', c.replace(/,?\s*maximum-scale=[^,]*/, '') + ', maximum-scale=1');
    setTimeout(function () { meta.setAttribute('content', c); }, 300);
  }
  function startMove(p) {
    endMove(false); // nunca dois pinos ao mesmo tempo
    resetPageZoom(); // página ampliada no celular deixa a barra de salvar fora da tela
    var orig = { lat: p.lat, lng: p.lng };
    var mk = L.marker([p.lat, p.lng], { draggable: true, autoPan: true, zIndexOffset: 2000,
      icon: L.divIcon({ className: '', html: '<div class="move-pin"></div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(map);
    var ghost = L.polyline([[orig.lat, orig.lng], [orig.lat, orig.lng]], { color: '#d29922', weight: 2, dashArray: '4 4', interactive: false }).addTo(map);
    moving = { p: p, orig: orig, mk: mk, ghost: ghost };
    function upd() {
      var ll = mk.getLatLng();
      ghost.setLatLngs([[orig.lat, orig.lng], ll]);
      var d = FPGeo.haversine(orig, { lat: ll.lat, lng: ll.lng });
      $('#moveInfo').textContent = p.nome + (d >= 1 ? ' · ' + (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(2) + ' km') : '');
    }
    mk.on('drag dragend', upd);
    moving.onMapClick = function (e) { mk.setLatLng(e.latlng); upd(); };
    map.on('click', moving.onMapClick);
    sheet.classList.add('min');
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 18));
    $('#moveBar').hidden = false;
    upd();
  }
  function endMove(saveIt) {
    if (!moving) return;
    var m = moving; moving = null;
    var ll = m.mk.getLatLng().wrap();
    map.off('click', m.onMapClick);
    map.removeLayer(m.mk); map.removeLayer(m.ghost);
    $('#moveBar').hidden = true;
    if (!saveIt) return;
    var data = sanitizePortal(Object.assign({}, m.p, { lat: ll.lat, lng: ll.lng }));
    if (!data) { toast('Coordenadas inválidas'); return; }
    if (data.lat === m.orig.lat && data.lng === m.orig.lng) return;
    pushUndo();
    m.p.lat = data.lat; m.p.lng = data.lng;
    save();
    invalidatePlan();
    toast('Posição atualizada');
  }
  $('#moveSave').addEventListener('click', function () { endMove(true); });
  $('#moveCancel').addEventListener('click', function () { endMove(false); });
  $('#moveDelete').addEventListener('click', function () {
    if (!moving) return;
    var p = moving.p;
    confirmDialog('Excluir portal', 'Excluir “' + p.nome + '” e links associados?').then(function (ok) {
      if (!ok) return;
      endMove(false);
      var gone = Object.create(null); gone[p.id] = true;
      removePortals(gone);
      save();
      invalidatePlan();
      toast('Portal excluído');
    });
  });

  // Mudança de dados invalida o plano (recalcula se já havia um e não está fixado; o fixado só é revalidado).
  function invalidatePlan() {
    if (plan) autoOptimize('dados alterados');
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
    var data = FPPlan.exportPayload(db); // lista fechada: chave da API e prints nunca entram
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
    pushUndo(); // atualizações de portais existentes pelo arquivo voltam com ↶ (os novos saem por "Desfazer última importação")
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
    var rec = Array.isArray(data) ? null : FPPlan.sanitizeRecord(data.plan);
    if (rec && rec.result.links.length) offerPlanRestore(rec);
  }

  /** Arquivo com plano: oferece restaurar (substitui o plano atual, sem recalcular). */
  function offerPlanRestore(rec) {
    var r = rec.result;
    confirmDialog('Plano no arquivo', 'O arquivo traz um plano' + (rec.pinned ? ' fixado' : '') + (r.simulation ? ' de simulação' : '') +
      (rec.ts ? ' calculado em ' + new Date(rec.ts).toLocaleString('pt-BR') : '') + ', com ' + r.links.length + ' link(s) e ' + r.fields.length +
      ' campo(s). Restaurar? Ele substitui o plano atual.').then(function (ok) {
      if (!ok) return;
      cancelPending(); // um recálculo disparado pela importação não pode sobrescrever o plano restaurado
      setPlanRecord(rec);
      renderAll();
      var v = planValidation();
      toast(v && !v.ok ? '⚠ Plano restaurado, mas não bate com os dados atuais: veja o aviso no painel' : 'Plano restaurado', 5000);
    });
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
    if (moving && gone[moving.p.id]) endMove(false);
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
  bulkForm.nivel.value = String(DEFAULT_LEVEL);

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
    var nivel = clampInt(bulkForm.nivel.value, 1, 8, DEFAULT_LEVEL), chaves = clampInt(bulkForm.chaves.value, 0, 999, 0);
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
    confirmDialog('Apagar tudo', 'Remove todos os portais, bloqueadores e configurações deste aparelho, inclusive a chave da API da Anthropic, ' +
      'as observações de prints (com as posições de onde você tirou cada um) e as preferências de "Nomear por print". Exporte antes se quiser guardar.').then(function (ok) {
      if (!ok) return;
      endMove(false);
      cancelPending(); // resposta a caminho não pode recriar um plano com portais apagados
      db = emptyDb(); plan = null; undoStack = [];
      save();
      wipeNaming();
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
      if (pos && lastOptPos && FPGeo.haversine(pos, lastOptPos) > MOVE_RECALC_M) autoOptimize('posição atualizada');
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
      $('#fLink').textContent = isPinned() ? 'Plano fixado concluído. Toque em Recalcular para um plano novo.' : 'Toque em Recalcular se algo mudou.';
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
    var val = busy ? null : planValidation();
    var bad = val ? val.issues.filter(function (x) { return x.n === l.n; }) : [];
    if (bad.length) link.appendChild(el('div', { class: 'field-warn', text: '⚠ ' + bad.map(function (x) { return x.text; }).join('; ') }));
  }

  function snapshot() {
    return JSON.stringify({ done: db.done, excluded: db.excluded, blockers: db.blockers, coveredManual: db.coveredManual,
      // chaves, nome, nível e posição: o desfazer cobre também o "Nomear por print"
      portals: db.portals.map(function (p) { return [p.id, p.chaves, p.nome, p.nivel, p.lat, p.lng, p.observacao]; }),
      // plano fixado não é recalculado: o desfazer devolve também os passos que tinham saído dele,
      // mas só ao mesmo plano (gen); outro plano fixado depois disso não recebe passos de um antigo
      plan: plan ? { gen: planGen, steps: plan.steps, links: plan.links } : null });
  }
  var undoPushes = 0;
  function pushUndo() { undoPushes++; undoStack.push(snapshot()); if (undoStack.length > 30) undoStack.shift(); }

  // Remove o link atual do plano local para a UI responder na hora; o recálculo substitui depois.
  function advanceLocal() {
    var s = currentStep();
    if (!s) return;
    var l = s.links.shift();
    plan.links = plan.links.filter(function (x) { return x.n !== l.n; });
    if (!s.links.length) plan.steps.shift();
    save(); // o progresso fica no plano salvo
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
    autoOptimize('link #' + l.n + ' concluído');
    renderPlanPanel();
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
      openBlockerDlg(null, null, function () {
        pushUndoAfter();
        if (!autoOptimize('bloqueador adicionado')) {
          var cur = currentLink(); // plano fixado: pula o link bloqueado e segue na mesma ordem
          if (cur && cur.from === l.from && cur.to === l.to) advanceLocal();
          toast('Plano fixado: link pulado, sem recalcular. Use ⟳ Recalcular se quiser outro plano.', 4000);
        }
        renderAll();
      });
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
    if (!autoOptimize('link #' + l.n + ' falhou')) toast('Plano fixado: link pulado, sem recalcular. Use ⟳ Recalcular se quiser outro plano.', 4000);
    renderAll();
  });
  // Desfazer de bloqueador: o snapshot é tirado antes do push; reconstruímos removendo o último.
  function pushUndoAfter() {
    var last = db.blockers[db.blockers.length - 1];
    var snap = JSON.parse(snapshot());
    snap.blockers = snap.blockers.filter(function (b) { return b !== last && b.id !== last.id; });
    undoPushes++;
    undoStack.push(JSON.stringify(snap));
  }

  function undoLast() {
    var s = undoStack.pop();
    if (!s) { toast('Nada para desfazer'); return; }
    var snap = JSON.parse(s);
    db.done = snap.done; db.excluded = snap.excluded; db.blockers = snap.blockers; db.coveredManual = snap.coveredManual;
    snap.portals.forEach(function (v) {
      var p = portalById(v[0]);
      if (p) { p.chaves = v[1]; p.nome = v[2]; p.nivel = v[3]; p.lat = v[4]; p.lng = v[5]; p.observacao = v[6]; }
    });
    if (snap.plan && isPinned() && snap.plan.gen === planGen) { plan.steps = snap.plan.steps; plan.links = snap.plan.links; }
    else if (isPinned()) toast('Desfeito nos dados; o plano fixado é outro e não foi alterado', 4000);
    save();
    autoOptimize('desfeito');
    renderAll();
    if (typeof refreshSuggestions === 'function') { refreshSuggestions(); renderNameBox(); }
  }
  $('#fUndo').addEventListener('click', undoLast);
  $('#fRecalc').addEventListener('click', function () { manualOptimize('recalculado manualmente'); });
  $('#fExit').addEventListener('click', function () { setFieldMode(false); });

  /* ------------------------------------------------------------ */
  /* Nomear por print (Ajustes). Desligado por padrão.             */
  /* Imagens ficam só na memória desta tela; a leitura usa a API   */
  /* da Anthropic com a chave do usuário; o casamento é local      */
  /* (matching.js) e nada muda sem confirmação.                    */
  /* ------------------------------------------------------------ */

  var OBS_STORE = 'fieldplanner.v1.obs'; // observações de listas de chaves, só neste aparelho
  var MAX_IMG_SIDE = 1568;               // a API reduz imagens maiores; mandamos já reduzida
  var GPS_WARN_ACC = 25;
  var prefs = FPRead.loadPrefs(localStorage);
  var nm = { items: [], mapSugs: [], singles: [], busy: false, origin: null, manualOrigin: '', editing: null, sharedQueue: [], skipped: Object.create(null), gen: 0, hashes: Object.create(null), doneRegistered: Object.create(null) };

  function loadObs() {
    try { var a = JSON.parse(localStorage.getItem(OBS_STORE) || '[]'); return Array.isArray(a) ? a.filter(function (o) { return o && o.nome && o.origem; }) : []; }
    catch (e) { return []; }
  }
  function saveObs(list) {
    try { localStorage.setItem(OBS_STORE, JSON.stringify(list.slice(-2000))); } catch (e) { toastError('Não foi possível salvar as observações'); }
  }
  var observations = loadObs();

  /** Posição do print = GPS no momento em que a imagem chega ao app (ou digitada). */
  function captureOrigin() {
    var typed = FPGeo.parseCoords(nm.manualOrigin);
    if (typed) return Promise.resolve({ lat: typed.lat, lng: typed.lng, precisao: 10, manual: true });
    if (!pos) return Promise.resolve(null);
    var o = { lat: pos.lat, lng: pos.lng, precisao: Math.round(pos.accuracy || 0) };
    if (o.precisao <= GPS_WARN_ACC) return Promise.resolve(o);
    return confirmDialog('GPS impreciso', 'A precisão do GPS agora é de ±' + o.precisao + ' m (acima de ' + GPS_WARN_ACC + ' m). ' +
      'As distâncias da lista de chaves ficam menos confiáveis. Usar mesmo assim?').then(function (ok) { return ok ? o : null; });
  }

  /** Reduz a imagem (lado maior ≤ 1568 px) e devolve { b64, dataUrl, w, h } só em memória. */
  function prepImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, MAX_IMG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/jpeg', 0.85);
        resolve({ b64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl: dataUrl, w: w, h: h });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('imagem ilegível')); };
      img.src = url;
    });
  }

  function processFiles(files) {
    files = Array.prototype.filter.call(files || [], function (f) { return /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name); });
    if (!files.length) return;
    var key = FPRead.loadKey(localStorage);
    if (!prefs.enabled || !key) { toast('Ligue "Nomear por print" e salve a chave da API em Ajustes'); return; }
    var fresh;
    Promise.all(files.slice(0, 20).map(fileHash)).then(function (hashes) {
      // mesma imagem (mesmo conteúdo) já lida nesta sessão: ignorada, para não ler nem listar de novo
      var batch = Object.create(null);
      fresh = files.slice(0, 20).filter(function (f, i) {
        if (nm.hashes[hashes[i]] || batch[hashes[i]]) return false;
        batch[hashes[i]] = true; f._fpHash = hashes[i]; return true; // marcado como lido só se a leitura der certo
      });
      var rep = Math.min(files.length, 20) - fresh.length;
      if (rep) toast(rep + ' imagem(ns) já lida(s) ignorada(s)', 4000);
      if (files.length > 20) toast('Máximo de 20 imagens por vez; o resto foi ignorado', 4000);
      return fresh.length ? captureOrigin() : null;
    }).then(function (origin) {
      if (!fresh.length) return;
      nm.origin = origin;
      var items = fresh.map(function (f) { return { name: f.name || 'print', status: 'na fila', file: f, origin: origin, hash: f._fpHash }; });
      nm.items = nm.items.concat(items);
      renderNameBox();
      // uma de cada vez: o progresso aparece por imagem e o limite da API sofre menos
      var gen = nm.gen;
      return items.reduce(function (chain, it) { return chain.then(function () { return readOne(it, key, gen); }); }, Promise.resolve());
    }).then(function () { refreshSuggestions(); renderNameBox(); });
  }

  /** SHA-256 do conteúdo (contexto seguro); sem crypto.subtle, nome + tamanho + data. */
  function fileHash(f) {
    var weak = 'w:' + f.name + ':' + f.size + ':' + f.lastModified;
    if (!(window.crypto && crypto.subtle && f.arrayBuffer)) return Promise.resolve(weak);
    return f.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }).catch(function () { return weak; });
  }

  /** A fila ainda vale? "Apagar tudo" e "Desligar" mudam nm.gen; a chave também precisa continuar salva. */
  function stillValid(gen, key) { return gen === nm.gen && prefs.enabled && FPRead.loadKey(localStorage) === key; }
  function readOne(it, key, gen) {
    if (!stillValid(gen, key)) { it.file = null; return Promise.resolve(); }
    it.status = 'preparando…'; renderNameBox();
    return prepImage(it.file).then(function (im) {
      it.file = null; // a imagem original sai da memória; fica só a miniatura reduzida
      if (!stillValid(gen, key)) return { ok: false, cancelled: true };
      it.thumb = im.dataUrl; it.w = im.w; it.h = im.h;
      it.status = 'lendo com a IA…'; renderNameBox();
      return FPRead.readImage(fetch.bind(window), key, prefs.model, im.b64, 'image/jpeg');
    }).then(function (r) {
      if (r.cancelled || !stillValid(gen, key)) return; // apagado ou desligado no meio: nada é gravado
      if (!r.ok) { it.status = '⚠ ' + r.error; it.error = true; renderNameBox(); return; }
      it.reading = r.value;
      if (it.hash) nm.hashes[it.hash] = true; // erro, 429 ou cancelamento: o mesmo print pode ser reenviado
      applyReading(it);
      renderNameBox();
    }).catch(function (e) { it.status = '⚠ ' + (e && e.message || 'falha'); it.error = true; renderNameBox(); });
  }

  /** Leitura validada → observações (lista de chaves), sugestões de mapa ou portal único. Nada é gravado em portal. */
  function applyReading(it) {
    var rd = it.reading, n = rd.portais.length;
    if (rd.tipo === 'lista_chaves') {
      if (!it.origin) { it.status = '⚠ lista de chaves sem posição: informe a posição do print e envie de novo'; it.error = true; return; }
      var ts = Date.now(), added = 0, dup = 0;
      rd.portais.forEach(function (p) {
        if (p.distancia_m == null) return;
        var o = { nome: p.nome, endereco: p.endereco, distancia_m: p.distancia_m, nivel: p.nivel, chaves: p.chaves,
          origem: { lat: it.origin.lat, lng: it.origin.lng, precisao: it.origin.precisao }, ts: ts };
        // mesmo nome, mesma distância, origem a < 5 m: o mesmo dado de outro print (ou do mesmo print reenviado)
        if (observations.some(function (x) { return FPMatch.isDuplicateObs(x, o); })) { dup++; return; }
        observations.push(o);
        added++;
      });
      saveObs(observations);
      it.status = '✓ lista de chaves: ' + added + ' nova(s) de ' + n + (dup ? ' (' + dup + ' repetida(s))' : '');
    } else if (rd.tipo === 'mapa') {
      var r = FPMatch.matchMap(rd, db.portals);
      if (!r.ok) { it.status = '⚠ mapa: ' + r.reason; it.error = true; return; }
      r.matches.forEach(function (m) {
        var p = portalById(m.portal), pt = rd.portais[m.idx];
        if (!p || FPMatch.nameSimilarity(p.nome, pt.nome) >= FPMatch.SAME_NAME) return; // já tem esse nome
        if (!FPMatch.isProvisional(p.nome)) return; // só renomeia provisórios
        var taken = FPMatch.sameNamePortal(pt.nome, db.portals, m.portal);
        nm.mapSugs.push({ src: 'mapa', item: it, nome: pt.nome, portal: m.portal, confidence: m.confidence, dist: m.dist,
          keys: pt.chaves, nivel: pt.nivel, px: { x: pt.x, y: pt.y }, nameTakenBy: taken ? taken.id : null });
      });
      it.status = '✓ mapa: ' + r.inliers + ' de ' + n + ' pontos casados' + (r.ambiguous ? ' (alinhamento ambíguo: confira um a um)' : '');
    } else {
      var s = FPMatch.matchSingle(rd, db.portals, it.origin);
      if (!s.ok) { it.status = '⚠ portal único: nenhum candidato'; it.error = true; return; }
      var p0 = rd.portais[0];
      nm.singles.push({ src: 'unico', item: it, nome: p0.nome, candidates: s.candidates.map(function (c) { return c.portal; }), keys: p0.chaves, nivel: p0.nivel });
      it.status = '✓ portal único: ' + s.candidates.length + ' candidato(s), confirme abaixo';
    }
  }

  var keySugs = [], keyPending = [], keyRegistered = [];
  function refreshSuggestions() {
    var r = FPMatch.matchKeyList(observations, db.portals);
    keySugs = r.suggestions.filter(function (s) { return !nm.skipped[s.key + '\u0000' + s.portal]; })
      .map(function (s) { return Object.assign({ src: 'lista', dist: null }, s); });
    keyPending = r.pending;
    keyRegistered = r.registered;
    // mapa: descarta sugestões cujo portal já foi renomeado ou excluído
    nm.mapSugs = nm.mapSugs.filter(function (s) { var p = portalById(s.portal); return p && FPMatch.isProvisional(p.nome); });
    nm.mapSugs.forEach(function (s) { var t = FPMatch.sameNamePortal(s.nome, db.portals, s.portal); s.nameTakenBy = t ? t.id : null; });
  }
  /** Sugestões em conflito: o mesmo portal com nomes diferentes, ou o mesmo nome em portais diferentes (mapa × lista, mapa × mapa). */
  function sugConflicts(sugs) {
    var out = new Set();
    // nome que já pertence a outro portal do app (mesma identidade de nome)
    sugs.forEach(function (s) { if (s.nameTakenBy || FPMatch.sameNamePortal(s.nome, db.portals, s.portal)) out.add(s); });
    // mesmo portal com nomes diferentes (nome inteiro: "Mural 1" e "Mural 2" são diferentes)
    var byP = Object.create(null);
    sugs.forEach(function (s) { (byP[s.portal] = byP[s.portal] || []).push(s); });
    Object.keys(byP).forEach(function (k) {
      var g = byP[k];
      if (new Set(g.map(function (s) { return FPMatch.normName(s.nome); })).size > 1) g.forEach(function (s) { out.add(s); });
    });
    // mesmo nome (por similaridade: "Manhathan" ≈ "Manhattan") em portais diferentes
    sugs.forEach(function (s, i) {
      sugs.forEach(function (t, j) {
        if (j > i && s.portal !== t.portal && (FPMatch.normName(s.nome) === FPMatch.normName(t.nome) || FPMatch.nameSimilarity(s.nome, t.nome) >= FPMatch.SAME_NAME)) { out.add(s); out.add(t); }
      });
    });
    return out;
  }
  function allSugs() {
    return keySugs.concat(nm.mapSugs).sort(function (a, b) { return b.confidence - a.confidence; });
  }

  /** Aplica um nome confirmado. opts: { keys, nivel, move } (todos desmarcados por padrão). */
  function acceptName(portalId, nome, sug, opts) {
    var p = portalById(portalId);
    var clean = String(nome || '').trim().slice(0, 80);
    if (!p || !clean) { toast('Nada a aplicar'); return Promise.resolve(false); }
    var dup = FPMatch.sameNamePortal(clean, db.portals, p.id);
    if (dup) { // nome único: dois portais nunca ficam com o mesmo nome
      toastError('“' + clean + '” já é o portal “' + dup.nome + '”. Use “É este” para atualizar aquele portal.');
      return Promise.resolve(false);
    }
    return acceptNameNow(p, clean, sug, opts);
  }
  function acceptNameNow(p, clean, sug, opts) {
    var moveTo = opts && opts.move && sug && sug.estimate ? sug.estimate : null;
    var ask = moveTo ? confirmDialog('Ajustar posição', 'Mover “' + p.nome + '” ' + fmtDist(FPGeo.haversine(p, moveTo)) +
      ' para a posição estimada pelos prints (resíduo ' + moveTo.residual + ' m)?') : Promise.resolve(false);
    return ask.then(function (doMove) {
      pushUndo();
      var geom = false;
      p.nome = clean;
      if (opts && opts.keys && sug && sug.keys != null) { p.chaves = clampInt(sug.keys, 0, 999, p.chaves); geom = true; }
      if (opts && opts.nivel && sug && sug.nivel != null) { p.nivel = clampInt(sug.nivel, 1, 8, p.nivel); geom = true; }
      if (doMove) { p.lat = moveTo.lat; p.lng = moveTo.lng; geom = true; }
      save();
      // renomear não mexe no plano; chaves, nível e posição passam pelo caminho de sempre
      // (plano fixado não recalcula; mover > 30 m aparece no aviso de validação)
      if (geom) invalidatePlan(); else renderAll();
      refreshSuggestions();
      renderNameBox();
      return true;
    });
  }

  /** "✓ já cadastrado" / "É este": nunca renomeia; só chaves, nível e (com confirmação) posição, se marcados. */
  function updateExisting(portalId, s, opts) {
    var p = portalById(portalId);
    if (!p) return Promise.resolve(false);
    opts = opts || {};
    if (!opts.keys && !opts.nivel && !opts.move) {
      if (s.src === 'mapa' || s.src === 'lista') skipSug(s);
      toast('“' + p.nome + '” já está cadastrado: nada a mudar');
      return Promise.resolve(false);
    }
    var moveTo = opts.move && s.estimate ? s.estimate : null;
    var ask = moveTo ? confirmDialog('Ajustar posição', 'Mover “' + p.nome + '” ' + fmtDist(FPGeo.haversine(p, moveTo)) +
      ' para a posição estimada pelos prints (resíduo ' + moveTo.residual + ' m)?') : Promise.resolve(false);
    return ask.then(function (doMove) {
      pushUndo();
      if (opts.keys && s.keys != null) p.chaves = clampInt(s.keys, 0, 999, p.chaves);
      if (opts.nivel && s.nivel != null) p.nivel = clampInt(s.nivel, 1, 8, p.nivel);
      if (doMove) { p.lat = moveTo.lat; p.lng = moveTo.lng; }
      save();
      invalidatePlan();
      if (s.src === 'mapa' || s.src === 'lista') skipSug(s);
      if (s.key) nm.doneRegistered[s.key] = true;
      refreshSuggestions();
      renderNameBox();
      toast('“' + p.nome + '” atualizado');
      return true;
    });
  }

  function registeredRow(g) {
    var p = portalById(g.portal);
    if (!p) return null;
    var optKeys = el('input', { type: 'checkbox' }), optLv = el('input', { type: 'checkbox' }), optMove = el('input', { type: 'checkbox' });
    var opts = el('div', { class: 'nm-opts small' });
    if (g.keys != null && g.keys !== p.chaves) opts.appendChild(el('label', null, [optKeys, ' atualizar chaves (' + p.chaves + ' → ' + g.keys + ')']));
    if (g.nivel != null && g.nivel !== p.nivel) opts.appendChild(el('label', null, [optLv, ' atualizar nível (L' + p.nivel + ' → L' + g.nivel + ')']));
    if (g.estimate) opts.appendChild(el('label', null, [optMove, ' ajustar posição para a estimada (desloca ' + fmtDist(g.estimate.shift) + ')']));
    var li = el('li', null, [
      el('div', null, [el('b', { text: '✓ ' + g.nome }), el('span', { class: 'muted small', text: ' já cadastrado como “' + p.nome + '”' })]),
      el('div', { class: 'muted small', text: g.obs + ' observação(ões) · diferença de ' + g.delta + ' m entre a distância do print e a posição do app' })
    ]);
    if (opts.childNodes.length) {
      li.appendChild(opts);
      li.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn sm', text: 'Atualizar marcados', onclick: function () {
        updateExisting(g.portal, Object.assign({ src: 'cadastrado' }, g), { keys: optKeys.checked, nivel: optLv.checked, move: optMove.checked });
      } })]));
    }
    return li;
  }

  function skipSug(s) {
    if (s.src === 'mapa') nm.mapSugs = nm.mapSugs.filter(function (x) { return x !== s; });
    else if (s.src === 'unico') nm.singles = nm.singles.filter(function (x) { return x !== s; });
    else { keySugs = keySugs.filter(function (x) { return x !== s; }); nm.skipped[s.key + '\u0000' + s.portal] = true; }
    renderNameBox();
  }

  /** Miniatura do print com o ponto marcado (só para print de mapa). */
  function thumbEl(s) {
    if (!s.item || !s.item.thumb) return null;
    var c = document.createElement('canvas'), W = 96, k = W / s.item.w;
    c.width = W; c.height = Math.round(s.item.h * k); c.className = 'nm-thumb';
    var img = new Image();
    img.onload = function () {
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      if (s.px) { g.strokeStyle = '#ff2d55'; g.lineWidth = 3; g.beginPath(); g.arc(s.px.x * k, s.px.y * k, 7, 0, 2 * Math.PI); g.stroke(); }
    };
    img.src = s.item.thumb;
    return c;
  }

  function candidateList(nearId) {
    var ref = nearId ? portalById(nearId) : null;
    var list = db.portals.filter(function (p) { return FPMatch.isProvisional(p.nome) || p.id === nearId; });
    if (ref) list.sort(function (a, b) { return FPGeo.haversine(ref, a) - FPGeo.haversine(ref, b); });
    return list.slice(0, 15);
  }

  function sugRow(s, conflict) {
    var p = portalById(s.portal);
    var taken = s.nameTakenBy ? portalById(s.nameTakenBy) : FPMatch.sameNamePortal(s.nome, db.portals, s.portal);
    var tgt = taken || p; // com o nome já cadastrado, as caixas valem para "É este" (o portal cadastrado)
    var optKeys = el('input', { type: 'checkbox' }), optLv = el('input', { type: 'checkbox' }), optMove = el('input', { type: 'checkbox' });
    var opts = el('div', { class: 'nm-opts small' });
    if (s.keys != null) opts.appendChild(el('label', null, [optKeys, ' atualizar chaves (' + (tgt ? tgt.chaves : '?') + ' → ' + s.keys + ')']));
    if (s.nivel != null) opts.appendChild(el('label', null, [optLv, ' atualizar nível (L' + (tgt ? tgt.nivel : '?') + ' → L' + s.nivel + ')']));
    if (s.estimate) opts.appendChild(el('label', null, [optMove, ' ajustar posição para a estimada (desloca ' +
      fmtDist(tgt ? FPGeo.haversine(tgt, s.estimate) : s.estimate.shift) + ')']));
    var detail = (s.src === 'mapa' ? 'print de mapa · ponto a ' + s.dist + ' m do portal'
      : 'lista de chaves · ' + s.obs + ' observação(ões) de ' + s.origins + ' ponto(s)') + ' · confiança ' + Math.round(s.confidence * 100) + '%';
    var getOpts = function () { return { keys: optKeys.checked, nivel: optLv.checked, move: optMove.checked }; };
    var accept = el('button', { class: 'btn sm ok', text: '✅ Aceitar', onclick: function () { acceptName(s.portal, s.nome, s, getOpts()); } });
    accept.disabled = !!taken; // nome único: o nome já é de outro portal
    var li = el('li', { class: 'nm-sug' }, [
      thumbEl(s),
      el('div', { class: 'grow' }, [
        el('div', null, [el('span', { class: 'muted', text: (p ? p.nome : '(removido)') + ' → ' }), el('b', { text: s.nome })]),
        el('div', { class: 'muted small', text: detail }),
        taken ? el('div', { class: 'small nm-conflict', text: '⚠ “' + s.nome + '” já é o portal “' + taken.nome + '”' +
          (FPGeo.haversine(taken, p || taken) >= 1 ? ' (a ' + fmtDist(FPGeo.haversine(taken, p || taken)) + ' deste)' : '') + '. Renomear criaria dois portais com o mesmo nome.' }) : null,
        !taken && conflict ? el('div', { class: 'small nm-conflict', text: '⚠ conflito: outra sugestão usa este portal ou este nome. Fica fora do "aceitar todos"; decida um a um.' }) : null,
        opts,
        el('div', { class: 'row' }, [
          accept,
          taken ? el('button', { class: 'btn sm', text: 'É este: ' + taken.nome, onclick: function () { updateExisting(taken.id, s, getOpts()); } }) : null,
          el('button', { class: 'btn sm', text: '✏️ Corrigir', onclick: function () { nm.editing = s; renderNameBox(); } }),
          el('button', { class: 'btn sm ghost', text: '⏭️ Pular', onclick: function () { skipSug(s); } })
        ])
      ])
    ]);
    if (nm.editing === s) li.appendChild(editBox(s, getOpts));
    return li;
  }

  function editBox(s, getOpts) {
    var name = el('input', { type: 'text', maxlength: '80', 'aria-label': 'Nome correto' });
    name.value = s.nome;
    var sel = el('select', { 'aria-label': 'Portal' });
    var ids = s.candidates && s.candidates.length ? s.candidates.map(portalById).filter(Boolean) : candidateList(s.portal);
    ids.forEach(function (p) {
      var o = el('option', { value: p.id, text: p.nome + (s.portal && p.id !== s.portal && portalById(s.portal) ? ' · ' + fmtDist(FPGeo.haversine(portalById(s.portal), p)) : '') });
      if (p.id === s.portal) o.selected = true;
      sel.appendChild(o);
    });
    return el('div', { class: 'stack nm-edit' }, [
      el('label', { class: 'f' }, ['Nome', name]),
      el('label', { class: 'f' }, ['Portal do app', sel]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn sm ok', text: 'Salvar correção', onclick: function () {
          nm.editing = null;
          acceptName(sel.value, name.value, sel.value === s.portal ? s : Object.assign({}, s, { estimate: null }), getOpts ? getOpts() : {});
        } }),
        el('button', { class: 'btn sm ghost', text: 'Cancelar', onclick: function () { nm.editing = null; renderNameBox(); } })
      ])
    ]);
  }

  function pendingRow(pd, origin) {
    var li = el('li', null, [
      el('div', null, [el('b', { text: pd.nome }), el('span', { class: 'muted small', text: ' · ' + pd.obs + ' observação(ões) de ' + pd.origins + ' ponto(s)' })]),
      el('div', { class: 'muted small', text: pd.hint })
    ]);
    // empate: o jogador decide qual é (o app nunca escolhe sozinho)
    var row = el('div', { class: 'row' });
    pd.candidates.slice(0, 6).forEach(function (id) {
      var p = portalById(id);
      if (!p) return;
      row.appendChild(el('button', { class: 'btn sm', text: 'É este: ' + p.nome + (origin ? ' · ' + fmtDist(FPGeo.haversine(origin, p)) : ''),
        onclick: function () {
          confirmDialog('Confirmar nome', 'Renomear “' + p.nome + '” para “' + pd.nome + '”?').then(function (ok) { if (ok) acceptName(id, pd.nome, null, {}); });
        } }));
    });
    if (row.childNodes.length) li.appendChild(row);
    return li;
  }

  function renderNameBox() {
    var box = $('#nameBox');
    if (!box) return;
    box.textContent = '';
    var key = FPRead.loadKey(localStorage);
    if (!prefs.enabled) {
      box.appendChild(el('p', { class: 'muted small', text: 'Troca nomes provisórios (BK 001, Portal 07…) pelos nomes reais a partir dos seus screenshots do jogo, com confirmação um a um. ' +
        'Desligado: nenhuma imagem sai do aparelho.' }));
      box.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn grow', text: 'Ligar Nomear por print', onclick: function () {
        confirmDialog('Nomear por print', 'As imagens selecionadas são enviadas à API da Anthropic. Nenhum serviço da Niantic é acessado. ' +
          'A leitura usa a sua chave da API e é cobrada na sua conta Anthropic. Os prints não ficam guardados no aparelho. Ligar?').then(function (ok) {
          if (!ok) return;
          prefs.enabled = true; FPRead.savePrefs(localStorage, prefs); renderNameBox();
        });
      } })]));
      return;
    }
    // chave da API
    if (key) {
      box.appendChild(el('div', { class: 'row' }, [
        el('span', { class: 'grow small', text: '🔑 Chave da API: ' + FPRead.maskKey(key) }),
        el('button', { class: 'btn sm bad', text: 'Apagar chave', onclick: function () { FPRead.clearKey(localStorage); renderNameBox(); toast('Chave apagada deste aparelho'); } })
      ]));
    } else {
      var kin = el('input', { type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…', 'aria-label': 'Chave da API da Anthropic' });
      box.appendChild(el('p', { class: 'muted small', text: 'Sem chave da API o recurso fica desabilitado. Crie uma chave no console da Anthropic e cole aqui. ' +
        'Ela fica só neste aparelho (não entra no JSON exportado).' }));
      box.appendChild(el('div', { class: 'row' }, [kin, el('button', { class: 'btn sm', text: 'Salvar chave', onclick: function () {
        var v = kin.value.trim();
        if (!/^sk-ant-[A-Za-z0-9_\-]{10,}$/.test(v)) { toast('Isso não parece uma chave da API da Anthropic'); return; }
        FPRead.saveKey(localStorage, v); kin.value = ''; renderNameBox();
      } })]));
    }
    var model = el('input', { type: 'text', value: prefs.model, 'aria-label': 'Modelo', maxlength: '60' });
    model.addEventListener('change', function () {
      var v = model.value.trim();
      if (/^[a-z0-9.\-]{3,60}$/.test(v)) { prefs.model = v; FPRead.savePrefs(localStorage, prefs); } else { model.value = prefs.model; toast('Nome de modelo inválido'); }
    });
    var pct = el('input', { type: 'number', min: '80', max: '100', value: String(prefs.autoPct), 'aria-label': 'Aceitar todos acima de (%)' });
    pct.addEventListener('change', function () { prefs.autoPct = clampInt(pct.value, 80, 100, 80); pct.value = prefs.autoPct; FPRead.savePrefs(localStorage, prefs); renderNameBox(); });
    box.appendChild(el('div', { class: 'row small' }, [el('label', { class: 'grow' }, ['Modelo ', model])]));
    // posição do print
    var gpsTxt = pos ? 'GPS agora: ±' + Math.round(pos.accuracy || 0) + ' m' + ((pos.accuracy || 0) > GPS_WARN_ACC ? ' (impreciso)' : '') : 'sem GPS';
    var oin = el('input', { type: 'text', placeholder: 'ou digite: -23.5505, -46.6333', 'aria-label': 'Posição do print', value: nm.manualOrigin });
    oin.addEventListener('change', function () { nm.manualOrigin = oin.value; flushSharedQueue(); });
    box.appendChild(el('p', { class: 'muted small', text: 'Lista de chaves: tire o print e mande para cá parado no mesmo lugar. O app grava a posição do GPS quando a imagem chega (' + gpsTxt + ').' }));
    box.appendChild(el('div', { class: 'row' }, [oin]));
    var pick = el('button', { class: 'btn primary grow', text: '📷 Escolher prints', onclick: function () { $('#printFiles').click(); } });
    pick.disabled = !key;
    box.appendChild(el('div', { class: 'row' }, [pick]));
    // progresso
    if (nm.items.length) {
      var ul = el('ul', { class: 'list' });
      nm.items.forEach(function (it) { ul.appendChild(el('li', { class: 'small' + (it.error ? ' bad' : '') }, [el('b', { text: it.name }), ' · ' + it.status])); });
      box.appendChild(ul);
      box.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn sm ghost', text: 'Limpar imagens desta tela', onclick: function () {
        nm.items = []; nm.mapSugs = []; nm.singles = []; nm.hashes = Object.create(null); renderNameBox();
      } })]));
    }
    // sugestões
    var sugs = allSugs();
    if (sugs.length) {
      box.appendChild(el('h4', { text: 'Sugestões (' + sugs.length + ')' }));
      var conflicts = sugConflicts(sugs);
      // lote: só acima do limite (nunca abaixo do mínimo de auto-aceite) e sem conflito de portal ou de nome
      var high = sugs.filter(function (s) { return s.confidence >= FPMatch.AUTO_ACCEPT && s.confidence * 100 >= prefs.autoPct && !conflicts.has(s); });
      var allBtn = el('button', { class: 'btn sm', text: 'Aceitar todos acima de ' + prefs.autoPct + '% (' + high.length + ')', onclick: function () {
          if (!high.length) return;
          confirmDialog('Aceitar vários', 'Renomear ' + high.length + ' portal(is) só com o nome (sem mudar chaves, nível ou posição)?').then(function (ok) {
            if (!ok) return;
            pushUndo(); // um único desfazer para o lote
            high.forEach(function (s) { var p = portalById(s.portal); if (p) p.nome = String(s.nome).slice(0, 80); });
            save(); renderAll(); refreshSuggestions(); renderNameBox();
            toast(high.length + ' portal(is) renomeado(s). ↶ Desfazer volta todos.', 4000);
          });
        } });
      allBtn.disabled = !high.length;
      box.appendChild(el('div', { class: 'row small' }, [allBtn, el('label', null, [' limite ', pct, '%'])]));
      var sl = el('ul', { class: 'list' });
      sugs.forEach(function (s) { sl.appendChild(sugRow(s, conflicts.has(s))); });
      box.appendChild(sl);
    }
    // já cadastrados: o nome bate com um portal do app; só atualizar chaves/nível/posição, nunca renomear
    var regs = keyRegistered.filter(function (g) { return !nm.doneRegistered[g.key]; });
    if (regs.length) {
      box.appendChild(el('h4', { text: '✓ Já cadastrados (' + regs.length + ')' }));
      var rl = el('ul', { class: 'list' });
      regs.forEach(function (g) { var row = registeredRow(g); if (row) rl.appendChild(row); });
      box.appendChild(rl);
    }
    // portal único e pendentes: confirmação obrigatória
    if (nm.singles.length || keyPending.length) {
      box.appendChild(el('h4', { text: 'Pendentes (' + (nm.singles.length + keyPending.length) + ')' }));
      var pl = el('ul', { class: 'list' });
      nm.singles.forEach(function (s) {
        pl.appendChild(pendingRow({ nome: s.nome, obs: 1, origins: 1, candidates: s.candidates, hint: 'print de um portal: escolha qual é' }, s.item.origin));
      });
      var lastOrigin = observations.length ? observations[observations.length - 1].origem : null;
      keyPending.forEach(function (pd) { pl.appendChild(pendingRow(pd, lastOrigin)); });
      box.appendChild(pl);
    }
    box.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'btn sm', text: '↶ Desfazer', onclick: undoLast }),
      el('button', { class: 'btn sm ghost', text: 'Esquecer observações (' + observations.length + ')', onclick: function () {
        confirmDialog('Esquecer observações', 'Apagar as ' + observations.length + ' distâncias lidas de listas de chaves? Os nomes já aceitos ficam.').then(function (ok) {
          if (!ok) return;
          nm.gen++; // leitura de lista em andamento não regrava o que acabou de ser esquecido
          nm.hashes = Object.create(null); nm.doneRegistered = Object.create(null); // os mesmos prints podem ser lidos de novo
          observations = []; saveObs(observations); refreshSuggestions(); renderNameBox();
        });
      } }),
      el('button', { class: 'btn sm ghost', text: 'Desligar', onclick: function () {
        prefs.enabled = false; FPRead.savePrefs(localStorage, prefs); nm.gen++; nm.items = []; nm.mapSugs = []; nm.singles = [];
        nm.hashes = Object.create(null); renderNameBox();
      } })
    ]));
  }

  $('#printFiles').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    processFiles(files);
  });

  // Prints compartilhados pelo Android (Web Share Target): o service worker guarda por instantes e o app
  // apaga assim que lê. A posição é a do GPS no recebimento.
  function takeSharedPrints() {
    if (!('caches' in window)) return;
    // abriu sem o parâmetro (redirect perdido, aba fechada): nada fica esquecido no cache
    if (!/[?&]compartilhado=1/.test(location.search)) { caches.delete('share-inbox').catch(function () {}); return; }
    history.replaceState(null, '', location.pathname);
    caches.open('share-inbox').then(function (c) {
      return c.keys().then(function (reqs) {
        return Promise.all(reqs.map(function (rq) {
          return c.match(rq).then(function (res) {
            return res.blob().then(function (b) {
              c.delete(rq);
              return new File([b], decodeURIComponent(rq.url.split('/').pop()) || 'print', { type: b.type || 'image/jpeg' });
            });
          });
        }));
      });
    }).then(function (files) {
      if (!files.length) return;
      if (!prefs.enabled || !FPRead.loadKey(localStorage)) {
        toast('Print recebido e descartado: ligue "Nomear por print" e salve a chave em Ajustes', 6000);
        return;
      }
      document.querySelector('.tabs button[data-tab="ajustes"]').click();
      if (pos || FPGeo.parseCoords(nm.manualOrigin)) { processFiles(files); return; }
      nm.sharedQueue = files; // espera o primeiro GPS (ou a posição digitada)
      toast('Print recebido: aguardando o GPS para gravar a posição', 5000);
    }).catch(function (e) { console.warn('[FP] prints compartilhados', e && e.message); });
  }
  /** "Apagar tudo": chave, preferências, observações, imagens desta tela e o cache de compartilhados. */
  function wipeNaming() {
    FPRead.clearKey(localStorage);
    try { localStorage.removeItem(FPRead.PREFS_STORE); localStorage.removeItem(OBS_STORE); } catch (e) { /* nada a apagar */ }
    if ('caches' in window) caches.delete('share-inbox').catch(function () {});
    prefs = FPRead.loadPrefs(localStorage);
    observations = [];
    nm.gen++; // leituras em andamento param e não gravam nada
    nm.items = []; nm.mapSugs = []; nm.singles = []; nm.sharedQueue = []; nm.editing = null; nm.skipped = Object.create(null);
    nm.hashes = Object.create(null); nm.doneRegistered = Object.create(null);
    nm.manualOrigin = '';
    refreshSuggestions();
    renderNameBox();
  }
  function flushSharedQueue() {
    if (!nm.sharedQueue.length || !(pos || FPGeo.parseCoords(nm.manualOrigin))) return;
    var f = nm.sharedQueue; nm.sharedQueue = [];
    processFiles(f);
  }

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
      var busyUi = fieldMode || moving || document.querySelector('dialog[open]'); // o plano fica salvo: recarregar não o perde
      if (justOpened && !busyUi) { location.reload(); return; } // acabou de abrir: troca já
      var bar = $('#updateBar');
      if (bar) bar.hidden = false;
    });
    var updBar = $('#updateBar');
    if (updBar) updBar.addEventListener('click', function () { location.reload(); });
  }

  refreshSuggestions();
  renderNameBox();
  takeSharedPrints();
  renderAll();
})();
