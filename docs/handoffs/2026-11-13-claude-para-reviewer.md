# Handoff: claude → reviewer — Field Planner v1.0.0

## Entregue
- `index.html` (UI + CSP), `app.js` (estado, mapa, modo em campo, GPS só leitura)
- `geo.js` (haversine, `segmentsCross`, `pointInTriangle`, `linkRange`, `parseCoords`)
- `optimizer.js` (fanfield, triangulação gulosa, rota NN + 2-opt, chaves faltantes), `worker.js`
- `sw.js` (offline-first; só intercepta a própria origem e tile.openstreetmap.org), `manifest.webmanifest`
- `tests/*.test.js` — 37/37 passando com `npm test`
- `README.md` — política de conformidade
- Sem ADRs: a especificação do usuário foi tratada como a decisão aprovada.

## O que falta
1. Revisão de correção: `optimizer.js` (State.whyNot, fieldsFor, simulate) e `geo.js:segmentsCross`.
2. Revisão de segurança: XSS (nomes de portal em tooltips Leaflet, `app.js` renderPortals/renderLinks), validação no import JSON (`app.js` sanitizePortal/sanitizeBlocker), CSP em `index.html:6`.
3. Conformidade: confirmar que nenhum caminho faz requisição fora da própria origem + OSM (`sw.js`, `app.js`).
4. Fluxo do modo em campo: desfazer (`app.js` pushUndo/pushUndoAfter), recálculo >100 m / 5 min.

## Riscos
- `sed` apagou e reinseriu o `return out` final de `optimize()` — conferir o fim da função.
- Campos inimigos são inferidos de triângulos de bloqueadores (aproximação documentada).
- Não testado em celular real (toque longo, GPS real, instalação).
