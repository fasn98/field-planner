/*
 * Field Planner — geometria pura.
 * Sem DOM, sem rede. Carregado pela página, pelo Web Worker (importScripts) e pelos testes (require).
 *
 * Convenção: geodésicas são aproximadas por segmentos retos numa projeção equiretangular local
 * (x = leste, y = norte, em metros) centrada numa referência próxima. Para campos "a pé"
 * (poucos km) o erro é desprezível frente à precisão do GPS.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FPGeo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 6371008.8; // raio médio da Terra (m)
  var DEG = Math.PI / 180;
  var EPS = 1e-9;

  /** Distância haversine em metros entre {lat,lng}. */
  function haversine(a, b) {
    var dLat = (b.lat - a.lat) * DEG;
    var dLng = (b.lng - a.lng) * DEG;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Rumo inicial (graus, 0 = norte, sentido horário) de a para b. */
  function bearing(a, b) {
    var y = Math.sin((b.lng - a.lng) * DEG) * Math.cos(b.lat * DEG);
    var x = Math.cos(a.lat * DEG) * Math.sin(b.lat * DEG) -
      Math.sin(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos((b.lng - a.lng) * DEG);
    return (Math.atan2(y, x) / DEG + 360) % 360;
  }

  /** Cria uma projeção local equiretangular centrada em ref. */
  function makeProjection(ref) {
    var k = Math.cos(ref.lat * DEG);
    return {
      toXY: function (p) {
        return { x: (p.lng - ref.lng) * DEG * R * k, y: (p.lat - ref.lat) * DEG * R };
      }
    };
  }

  /** Centroide simples de uma lista {lat,lng}. */
  function centroid(points) {
    var lat = 0, lng = 0;
    for (var i = 0; i < points.length; i++) { lat += points[i].lat; lng += points[i].lng; }
    return { lat: lat / points.length, lng: lng / points.length };
  }

  /** Produto vetorial (b-a)×(c-a): >0 se c está à esquerda de a→b. */
  function orient(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function samePoint(p, q) {
    return Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
  }

  function sign(v, scale) {
    var tol = EPS * scale;
    return v > tol ? 1 : v < -tol ? -1 : 0;
  }

  function onSegment(a, b, p) {
    return Math.min(a.x, b.x) - 1e-6 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-6 &&
      Math.min(a.y, b.y) - 1e-6 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-6;
  }

  /**
   * Teste de cruzamento de dois links (segmentos planares).
   * Links que compartilham um portal (extremidade) NÃO se cruzam — é assim no jogo.
   * Toque em ponto interior (T) ou sobreposição colinear contam como cruzamento.
   */
  function segmentsCross(a, b, c, d) {
    var sharedAC = samePoint(a, c), sharedAD = samePoint(a, d);
    var sharedBC = samePoint(b, c), sharedBD = samePoint(b, d);
    var shared = (sharedAC || sharedAD ? 1 : 0) + (sharedBC || sharedBD ? 1 : 0);
    if (shared === 2) return false; // mesmo link (duplicidade é tratada à parte)

    var scale = Math.max(1, Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + Math.abs(d.x - c.x) + Math.abs(d.y - c.y));
    scale = scale * scale;
    var o1 = sign(orient(a, b, c), scale), o2 = sign(orient(a, b, d), scale);
    var o3 = sign(orient(c, d, a), scale), o4 = sign(orient(c, d, b), scale);

    if (shared === 1) {
      // Compartilham uma extremidade: só "cruzam" se forem colineares e se sobrepuserem.
      if (o1 !== 0 || o2 !== 0) return false;
      var p = sharedAC || sharedAD ? a : b;          // ponto comum
      var u = p === a ? b : a;                        // outra ponta do 1º
      var v = sharedAC || sharedBC ? d : c;           // outra ponta do 2º
      // sobreposição se u e v estão do mesmo lado de p
      return ((u.x - p.x) * (v.x - p.x) + (u.y - p.y) * (v.y - p.y)) > 0;
    }

    if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return true;
    // casos degenerados: um ponto sobre o outro segmento
    if (o1 === 0 && onSegment(a, b, c)) return true;
    if (o2 === 0 && onSegment(a, b, d)) return true;
    if (o3 === 0 && onSegment(c, d, a)) return true;
    if (o4 === 0 && onSegment(c, d, b)) return true;
    return false;
  }

  /**
   * Ponto estritamente dentro do triângulo (vértices e arestas NÃO contam).
   * Usado na regra "portal sob campo não gera link de saída".
   */
  function pointInTriangle(p, a, b, c) {
    if (samePoint(p, a) || samePoint(p, b) || samePoint(p, c)) return false;
    var area = Math.abs(orient(a, b, c));
    if (area < 1e-6) return false; // triângulo degenerado não cobre nada
    var scale = area;
    var d1 = sign(orient(a, b, p), scale);
    var d2 = sign(orient(b, c, p), scale);
    var d3 = sign(orient(c, a, p), scale);
    if (d1 === 0 || d2 === 0 || d3 === 0) return false; // sobre a aresta
    return d1 === d2 && d2 === d3;
  }

  function triangleArea(a, b, c) {
    return Math.abs(orient(a, b, c)) / 2;
  }

  /** Alcance de link (m) pelo nível do portal, sem mods: 160 × nível⁴. */
  function linkRange(level) {
    var l = Math.max(1, Math.min(8, Number(level) || 1));
    return 160 * Math.pow(l, 4);
  }

  /* Versões em lat/lng, convenientes para a UI e para os testes. */
  function linksCrossLL(a, b, c, d) {
    var pr = makeProjection(centroid([a, b, c, d]));
    return segmentsCross(pr.toXY(a), pr.toXY(b), pr.toXY(c), pr.toXY(d));
  }
  function portalUnderFieldLL(p, a, b, c) {
    var pr = makeProjection(centroid([a, b, c]));
    return pointInTriangle(pr.toXY(p), pr.toXY(a), pr.toXY(b), pr.toXY(c));
  }

  /**
   * Extrai lat,lng de um texto colado (link de compartilhamento de mapa, texto livre).
   * Apenas regex local — nunca abre nem busca a URL.
   */
  function parseCoords(text) {
    if (!text) return null;
    var s = String(text);
    try { s = decodeURIComponent(s); } catch (e) { /* mantém original */ }
    var num = '(-?\\d{1,3}(?:\\.\\d+)?)';
    var patterns = [
      new RegExp('[?&#](?:pll|ll|q|query|center|daddr|destination)=' + num + '\\s*,\\s*' + num, 'i'),
      new RegExp('@' + num + ',' + num),
      new RegExp('[?&]lat(?:itude)?=' + num + '[^#]*?[&]l(?:ng|on|ongitude)=' + num, 'i'),
      new RegExp('!3d' + num + '!4d' + num),
      new RegExp('geo:' + num + ',' + num, 'i'),
      new RegExp('(?:^|[^\\d.])' + '(-?\\d{1,2}\\.\\d{3,})' + '\\s*[,;\\s]\\s*' + '(-?\\d{1,3}\\.\\d{3,})')
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = s.match(patterns[i]);
      if (m) {
        var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return { lat: lat, lng: lng };
        }
      }
    }
    return null;
  }

  return {
    R: R,
    haversine: haversine,
    bearing: bearing,
    makeProjection: makeProjection,
    centroid: centroid,
    orient: orient,
    segmentsCross: segmentsCross,
    pointInTriangle: pointInTriangle,
    triangleArea: triangleArea,
    linkRange: linkRange,
    linksCrossLL: linksCrossLL,
    portalUnderFieldLL: portalUnderFieldLL,
    parseCoords: parseCoords
  };
});
