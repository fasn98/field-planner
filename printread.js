/*
 * Field Planner — leitura de prints pela API da Anthropic (Messages API, visão).
 * Só roda quando o usuário liga "Nomear por print" e escolhe imagens. A imagem vai direto do navegador
 * para api.anthropic.com com a chave do próprio usuário; nada passa por outro servidor. Nenhum serviço da
 * Niantic é acessado. A resposta é validada aqui antes de qualquer uso: JSON fora do formato é recusado.
 * A chave da API nunca é escrita em log nem entra no export (fica numa chave própria do localStorage).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FPRead = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var API_URL = 'https://api.anthropic.com/v1/messages';
  var DEFAULT_MODEL = 'claude-sonnet-5-5';
  var KEY_STORE = 'fieldplanner.v1.apikey';     // fora do db: o export nunca a vê
  var PREFS_STORE = 'fieldplanner.v1.print';    // { enabled, model, autoPct }
  var MAX_PORTAIS = 200;

  var SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['tipo', 'portais', 'escala_m_por_px', 'norte_para_cima'],
    properties: {
      tipo: { type: 'string', enum: ['mapa', 'lista_chaves', 'portal_unico'] },
      portais: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['nome', 'x', 'y', 'endereco', 'distancia_m', 'nivel', 'chaves'],
          properties: {
            nome: { type: 'string' },
            x: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            y: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            endereco: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            distancia_m: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            nivel: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            chaves: { anyOf: [{ type: 'integer' }, { type: 'null' }] }
          }
        }
      },
      escala_m_por_px: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      norte_para_cima: { anyOf: [{ type: 'boolean' }, { type: 'null' }] }
    }
  };

  var SYSTEM = [
    'Você lê screenshots do jogo Ingress tirados pelo próprio usuário e transcreve dados de PORTAIS (lugares), em JSON.',
    'Regras:',
    '- Transcreva só o que está visível na imagem. Não invente nem complete nomes. Se o nome de um portal estiver cortado (pela borda da tela, por reticências ou por estar parcialmente coberto), pule esse portal inteiro: não o coloque no JSON.',
    '- IGNORE nomes de agentes, donos de portal, mensagens do COMM e qualquer dado de jogadores. Nunca os coloque no JSON.',
    '- tipo "mapa": mapa/intel com vários portais. Para cada portal com nome visível, dê x e y em pixels da imagem (origem no canto superior esquerdo). escala_m_por_px só se houver barra de escala legível; norte_para_cima = false só se o mapa estiver claramente girado.',
    '- tipo "lista_chaves": lista do inventário de chaves. Para cada linha: nome, endereco (se aparecer), distancia_m (converta km para metros; "1,2 km" = 1200), nivel e chaves (quantidade) se aparecerem. x e y = null.',
    '- tipo "portal_unico": tela de um único portal. nome, endereco, nivel, chaves e distancia_m se aparecerem.',
    '- Campo ausente ou ilegível = null.'
  ].join('\n');

  /* ------------------------------------------------------------ */
  /* Validação da resposta (o app nunca confia no formato).        */
  /* ------------------------------------------------------------ */

  function numOrNull(v, lo, hi) {
    if (v === null || v === undefined) return { ok: true, v: null };
    if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) return { ok: false };
    return { ok: true, v: v };
  }
  function intOrNull(v, lo, hi) {
    var r = numOrNull(v, lo, hi);
    return r.ok && r.v !== null && Math.round(r.v) !== r.v ? { ok: false } : r;
  }
  function str(v, max) { return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }

  /** Valida o objeto lido. Devolve { ok: true, value } ou { ok: false, error }. Não altera nada. */
  function validateReading(obj) {
    var fail = function (m) { return { ok: false, error: 'resposta fora do formato: ' + m }; };
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('não é um objeto');
    var allowed = { tipo: 1, portais: 1, escala_m_por_px: 1, norte_para_cima: 1 };
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && !allowed[k]) return fail('campo inesperado "' + str(k, 30) + '"');
    if (['mapa', 'lista_chaves', 'portal_unico'].indexOf(obj.tipo) < 0) return fail('tipo inválido');
    if (!Array.isArray(obj.portais)) return fail('portais não é lista');
    if (obj.portais.length > MAX_PORTAIS) return fail('portais demais');
    var esc = numOrNull(obj.escala_m_por_px, 0.01, 1000);
    if (!esc.ok) return fail('escala inválida');
    if (obj.norte_para_cima !== null && obj.norte_para_cima !== undefined && typeof obj.norte_para_cima !== 'boolean') return fail('norte_para_cima inválido');
    var portais = [];
    for (var i = 0; i < obj.portais.length; i++) {
      var p = obj.portais[i];
      if (!p || typeof p !== 'object' || Array.isArray(p)) return fail('portal ' + (i + 1) + ' não é objeto');
      var pk = { nome: 1, x: 1, y: 1, endereco: 1, distancia_m: 1, nivel: 1, chaves: 1 };
      for (var f in p) if (Object.prototype.hasOwnProperty.call(p, f) && !pk[f]) return fail('portal ' + (i + 1) + ': campo inesperado "' + str(f, 30) + '"');
      if (typeof p.nome !== 'string' || !str(p.nome, 80)) return fail('portal ' + (i + 1) + ' sem nome');
      var x = numOrNull(p.x, -10000, 100000), y = numOrNull(p.y, -10000, 100000);
      var d = numOrNull(p.distancia_m, 0, 20000000), lv = intOrNull(p.nivel, 1, 8), ch = intOrNull(p.chaves, 0, 9999);
      if (!x.ok || !y.ok) return fail('portal ' + (i + 1) + ': x/y inválidos');
      if (!d.ok) return fail('portal ' + (i + 1) + ': distância inválida');
      if (!lv.ok) return fail('portal ' + (i + 1) + ': nível inválido');
      if (!ch.ok) return fail('portal ' + (i + 1) + ': chaves inválidas');
      if (p.endereco !== null && p.endereco !== undefined && typeof p.endereco !== 'string') return fail('portal ' + (i + 1) + ': endereço inválido');
      portais.push({ nome: str(p.nome, 80), x: x.v, y: y.v, endereco: p.endereco ? str(p.endereco, 160) : null,
        distancia_m: d.v, nivel: lv.v, chaves: ch.v });
    }
    if (obj.tipo === 'mapa' && portais.some(function (p) { return (p.x === null) !== (p.y === null); })) return fail('ponto com só x ou só y');
    return { ok: true, value: { tipo: obj.tipo, portais: portais, escala_m_por_px: esc.v,
      norte_para_cima: typeof obj.norte_para_cima === 'boolean' ? obj.norte_para_cima : null } };
  }

  /** Extrai e valida o JSON da resposta da Messages API. */
  function parseResponse(body) {
    if (!body || typeof body !== 'object') return { ok: false, error: 'resposta vazia da API' };
    if (body.stop_reason === 'refusal') return { ok: false, error: 'a API recusou ler esta imagem' };
    if (body.stop_reason === 'max_tokens') return { ok: false, error: 'resposta cortada (imagem com dados demais)' };
    var text = (Array.isArray(body.content) ? body.content : []).filter(function (b) { return b && b.type === 'text'; })
      .map(function (b) { return b.text; }).join('');
    if (!text) return { ok: false, error: 'a API não devolveu texto' };
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'resposta não é JSON válido' }; }
    return validateReading(obj);
  }

  /* ------------------------------------------------------------ */
  /* Pedido e chamada.                                             */
  /* ------------------------------------------------------------ */

  /** Monta o pedido (sem enviar). imageB64 sem prefixo data:. */
  function buildRequest(apiKey, model, imageB64, mediaType) {
    return {
      url: API_URL,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-beta': 'server-side-fallback-2026-07-01'
        },
        body: JSON.stringify({
          model: model || DEFAULT_MODEL,
          max_tokens: 16000,
          fallbacks: 'default',
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
          system: SYSTEM,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
            { type: 'text', text: 'Transcreva os portais deste screenshot no formato pedido.' }
          ] }]
        })
      }
    };
  }

  /** Mensagem clara por status HTTP (nunca inclui a chave). */
  function httpError(status, retryAfter) {
    if (status === 401) return 'Chave da API inválida ou revogada (401). Confira em Ajustes → Nomear por print.';
    if (status === 403) return 'A chave não tem permissão para este modelo (403).';
    if (status === 404) return 'Modelo não encontrado (404). Confira o nome do modelo em Ajustes.';
    if (status === 413) return 'Imagem grande demais para a API (413).';
    if (status === 429) return 'Limite de uso da API atingido (429).' + (retryAfter ? ' Tente de novo em ' + retryAfter + ' s.' : ' Tente de novo em instantes.');
    if (status === 529 || status >= 500) return 'API da Anthropic indisponível ou sobrecarregada (' + status + '). Tente de novo em instantes.';
    if (status === 400) return 'Pedido recusado pela API (400).';
    return 'Erro da API (' + status + ').';
  }

  /**
   * Lê uma imagem. fetchFn = fetch (injetável nos testes). Devolve { ok, value } ou { ok: false, error, status }.
   */
  function readImage(fetchFn, apiKey, model, imageB64, mediaType) {
    if (!apiKey) return Promise.resolve({ ok: false, error: 'sem chave da API' });
    var rq = buildRequest(apiKey, model, imageB64, mediaType);
    return fetchFn(rq.url, rq.init).then(function (res) {
      if (!res.ok) {
        var ra = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
        return { ok: false, status: res.status, error: httpError(res.status, ra) };
      }
      return res.json().then(parseResponse, function () { return { ok: false, error: 'resposta da API ilegível' }; });
    }, function () {
      return { ok: false, error: 'Sem conexão com a API da Anthropic (rede). Tente de novo com internet.' };
    });
  }

  /* ------------------------------------------------------------ */
  /* Chave da API e preferências (localStorage, fora do db).       */
  /* ------------------------------------------------------------ */

  function loadKey(storage) { try { return storage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function saveKey(storage, key) { storage.setItem(KEY_STORE, String(key || '').trim()); }
  function clearKey(storage) { try { storage.removeItem(KEY_STORE); } catch (e) { /* nada a apagar */ } }
  function maskKey(key) { return key ? '••••' + String(key).slice(-4) : ''; }
  function loadPrefs(storage) {
    var d = { enabled: false, model: DEFAULT_MODEL, autoPct: 80 };
    try {
      var p = JSON.parse(storage.getItem(PREFS_STORE) || '{}');
      return { enabled: p.enabled === true, model: typeof p.model === 'string' && /^[a-z0-9.\-]{3,60}$/.test(p.model) ? p.model : d.model,
        autoPct: Math.max(80, Math.min(100, Math.round(Number(p.autoPct)) || d.autoPct)) };
    } catch (e) { return d; }
  }
  function savePrefs(storage, p) { storage.setItem(PREFS_STORE, JSON.stringify({ enabled: !!p.enabled, model: p.model, autoPct: p.autoPct })); }

  return {
    API_URL: API_URL, DEFAULT_MODEL: DEFAULT_MODEL, KEY_STORE: KEY_STORE, PREFS_STORE: PREFS_STORE, SCHEMA: SCHEMA, SYSTEM: SYSTEM,
    validateReading: validateReading, parseResponse: parseResponse, buildRequest: buildRequest, httpError: httpError, readImage: readImage,
    loadKey: loadKey, saveKey: saveKey, clearKey: clearKey, maskKey: maskKey, loadPrefs: loadPrefs, savePrefs: savePrefs
  };
});
