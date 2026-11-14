# Handoff claude → reviewer — v1.6.0 mover/excluir portal no mapa

## Entregue
- `app.js`: modo "mover portal" (`startMove`/`endMove`, botão `#moveDelete`), guarda `moving` no clique de portal, no `contextmenu` do mapa e no `controllerchange` do service worker; VERSION 1.6.0.
- `index.html`: botão `#portalMove` no diálogo do portal, barra `#moveBar` (Cancelar / Excluir / Salvar posição), estilos `.move-pin`, `#moveBar`.
- `sw.js`, `package.json`: versão 1.6.0.
- Sem ADR (feature pequena de UI, reversível).

## Testes
- `npm test`: 81 passando, 0 falhas.
- Smoke em Chrome headless 412×860 (script no scratchpad `mover.mjs`): abrir diálogo → Mover → arrastar 60 px (33 m) → Cancelar não grava; tocar no mapa (125 m) → Salvar grava e mostra toast; Excluir pela barra pede confirmação e remove; 0 exceções.
- Não testado em celular real (toque/arraste com dedo).

## O que falta
- Revisão de código/segurança (nome do portal vai para `textContent`; `confirmDialog` usa `textContent`).
- CHANGELOG/README depois da revisão.

## Riscos
- Durante o modo mover, o clique no mapa move o pino; se o modo em campo estiver ativo, salvar recalcula o plano (`invalidatePlan`).

## Resultado da revisão (reviewer): APROVADO COM RESSALVAS — corrigidas
- IMPORTANTE `startMove` sem encerrar mover anterior (telas largas) → `startMove` chama `endMove(false)` primeiro.
- NOTA apagar tudo / desfazer importação / excluir durante mover → `removePortals` e `#wipeBtn` encerram o mover.
- NOTA longitude fora de ±180 → `getLatLng().wrap()`.
- NOTA tocar em cima de outro portal não move o pino → mantido (usabilidade, sem mudança).
- Depois das correções: `npm test` 81/81, smoke `mover.mjs` sem exceções.
