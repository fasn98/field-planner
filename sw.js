/*
 * Field Planner — service worker (offline-first).
 * App shell: cache-first por VERSION (nunca mistura arquivos de versões diferentes). A página
 * procura sw.js novo ao abrir, ao voltar ao primeiro plano e a cada 30 min; o SW novo baixa tudo
 * ignorando o cache HTTP e assume na hora. A página então recarrega sozinha (se acabou de abrir e
 * não está no modo em campo) ou mostra "Nova versão disponível".
 * Tiles OSM: cache-first com rede como fallback, só os que você já visualizou (sem download em massa,
 * conforme a política de uso de tiles do OSM). Qualquer outra origem: não intercepta.
 */
var VERSION = 'fp-v1.7.1';
var SHELL = 'shell-' + VERSION;
var TILES = 'tiles-v2'; // v1 guardava respostas opacas, incompatíveis com requests CORS
var TILE_HOST = 'tile.openstreetmap.org';
var MAX_TILES = 3000;

var ASSETS = [
  './', 'index.html', 'app.js', 'geo.js', 'optimizer.js', 'worker.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png'
];

self.addEventListener('install', function (e) {
  // cache: 'reload' ignora o cache HTTP do navegador (o GitHub Pages manda max-age=600)
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return (k.indexOf('shell-') === 0 && k !== SHELL) || (k.indexOf('tiles-') === 0 && k !== TILES);
    })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function trimTiles() {
  return caches.open(TILES).then(function (c) {
    return c.keys().then(function (keys) {
      var extra = keys.length - MAX_TILES;
      return Promise.all(keys.slice(0, Math.max(0, extra)).map(function (k) { return c.delete(k); }));
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // cache-first, coerente por VERSION: todos os arquivos do app vêm sempre da mesma versão.
    // Versão nova = sw.js novo, que baixa tudo de novo na instalação (cache: 'reload').
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(req).catch(function () {
          return req.mode === 'navigate' ? c.match('index.html') : Response.error();
        });
      });
    }));
    return;
  }

  if (url.hostname === TILE_HOST) {
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit && hit.type !== 'opaque') return hit;
        return fetch(req).then(function (res) {
          // só respostas CORS OK: opacas contam ~7 MB cada na cota do Chrome
          if (res.ok) c.put(req, res.clone()).then(trimTiles).catch(function () {});
          return res;
        });
      });
    }));
  }
  // demais origens: não intercepta (e a CSP da página já as bloqueia)
});
