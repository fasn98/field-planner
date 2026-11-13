'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../geo.js');

test('extrai coordenadas de links e textos comuns', () => {
  const cases = [
    ['https://www.openstreetmap.org/?mlat=-23.5&mlon=-46.6#map=17/-23.55052/-46.63331&ll=-23.55052,-46.63331', -23.55052, -46.63331],
    ['https://maps.google.com/?q=-23.561414,-46.655881', -23.561414, -46.655881],
    ['https://www.google.com/maps/place/X/@-22.951916,-43.210487,17z', -22.951916, -43.210487],
    ['https://example.org/?pll=-15.799700,-47.864200', -15.7997, -47.8642],
    ['geo:-3.731862,-38.526669', -3.731862, -38.526669],
    ['Praça XV -22.9028, -43.1729', -22.9028, -43.1729],
    ['https://example.org/?lat=-30.0346&lng=-51.2177', -30.0346, -51.2177]
  ];
  for (const [txt, lat, lng] of cases) {
    const r = G.parseCoords(txt);
    assert.ok(r, `não extraiu de ${txt}`);
    assert.ok(Math.abs(r.lat - lat) < 1e-6 && Math.abs(r.lng - lng) < 1e-6, `${txt} → ${JSON.stringify(r)}`);
  }
});

test('texto sem coordenadas devolve null', () => {
  assert.equal(G.parseCoords('https://example.org/portal/abc123'), null);
  assert.equal(G.parseCoords(''), null);
});

// Conformidade: nenhum arquivo de código do app referencia domínios da Niantic.
test('código do app não contém domínios da Niantic', () => {
  const root = path.join(__dirname, '..');
  const files = ['index.html', 'app.js', 'geo.js', 'optimizer.js', 'worker.js', 'sw.js', 'manifest.webmanifest'];
  const forbidden = /(ingress\.com|nianticlabs\.com|nianticspatial\.com|niantic\.com)/i;
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.equal(forbidden.test(src), false, `${f} referencia domínio proibido`);
  }
});

test('CSP da página só permite rede para tiles do OSM', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(m, 'CSP ausente');
  const csp = m[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  const hosts = csp.match(/https:\/\/[^\s;]+/g) || [];
  for (const h of hosts) assert.match(h, /tile\.openstreetmap\.org$/, `host inesperado na CSP: ${h}`);
});
