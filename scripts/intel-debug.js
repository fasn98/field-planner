#!/usr/bin/env node
'use strict';
// Imagem de depuração do "Importar print do Intel": desenha sobre o print os portais detectados (cor da
// facção), os links e os portais sob campo, e lista as contagens. Roda só no computador (Playwright).
//   node scripts/intel-debug.js tests/fixtures-local/intel-25112026/print-1138.png saida.png [zoom] [dpr]
const fs = require('fs');
const path = require('path');
const I = require('../intelprint.js');

const [src, out, zoom, dpr] = process.argv.slice(2);
if (!src || !out) { console.error('uso: node scripts/intel-debug.js <print.png|jpg> <saida.png> [zoom] [dpr]'); process.exit(2); }
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    const b64 = fs.readFileSync(src).toString('base64'), mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
    const img = await page.evaluate(async ([b64, mime]) => {
      const im = new Image(); im.src = 'data:' + mime + ';base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      return { width: d.width, height: d.height, data: Array.from(d.data) };
    }, [b64, mime]);
    const an = I.analyze({ width: img.width, height: img.height, data: Uint8ClampedArray.from(img.data) },
      { zoom: Number(zoom) || 15, dpr: Number(dpr) || 2 });
    const png = await page.evaluate(async ([b64, mime, an]) => {
      const im = new Image(); im.src = 'data:' + mime + ';base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, c.width, an.area.y0); g.fillRect(0, an.area.y1, c.width, c.height - an.area.y1);
      const col = { neutro: '#ffffff', verde: '#00ff3c', azul: '#00b4ff', machina: '#ff3030' };
      g.lineWidth = 3;
      an.links.forEach(l => { g.strokeStyle = l.cor === 'verde' ? '#ffe066' : '#ff66ff'; g.setLineDash(l.a.fora || l.b.fora ? [10, 8] : []);
        g.beginPath(); g.moveTo(l.a.x, l.a.y); g.lineTo(l.b.x, l.b.y); g.stroke(); });
      g.setLineDash([]);
      an.portals.forEach((p, i) => {
        g.strokeStyle = col[p.faccao]; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, p.r + 6, 0, 2 * Math.PI); g.stroke();
        g.strokeStyle = '#ff00ff'; g.lineWidth = 1; g.beginPath(); g.moveTo(p.x - 4, p.y); g.lineTo(p.x + 4, p.y); g.moveTo(p.x, p.y - 4); g.lineTo(p.x, p.y + 4); g.stroke();
        if (p.coberto) { g.fillStyle = 'rgba(255,224,102,.45)'; g.beginPath(); g.arc(p.x, p.y, p.r + 6, 0, 2 * Math.PI); g.fill(); }
        g.fillStyle = col[p.faccao]; g.font = 'bold 13px system-ui'; g.fillText(String(i + 1), p.x + p.r + 7, p.y - p.r - 2);
      });
      return c.toDataURL('image/png').split(',')[1];
    }, [b64, mime, an]);
    fs.writeFileSync(out, Buffer.from(png, 'base64'));
    const by = {}; an.portals.forEach(p => { by[p.faccao] = (by[p.faccao] || 0) + 1; });
    console.log(path.basename(src) + ': ' + an.portals.length + ' portais ' + JSON.stringify(by) + ', ' + an.links.length + ' links, ' +
      an.portals.filter(p => p.coberto).length + ' sob campo → ' + out);
    an.portals.forEach((p, i) => console.log(String(i + 1).padStart(3) + ' ' + p.faccao.padEnd(7) + ' (' + Math.round(p.x) + ',' + Math.round(p.y) + ')' + (p.coberto ? ' sob campo ' + p.coberto : '')));
  } finally { await b.close(); }
})();
