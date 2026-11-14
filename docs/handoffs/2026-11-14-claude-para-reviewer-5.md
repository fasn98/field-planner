# Handoff: claude → reviewer — desfazer importação e importações grandes (v1.5.0)

## Entregue
- `app.js`:
  - `db.lastImport = {ts, label, ids}`: só os portais adicionados (updates não entram); é saneado no `load()`;
  - `recordImport` é chamado no import JSON e no lote de links;
  - `removePortals(gone)` foi extraído do excluir: remove portais e tudo que aponta para eles, e ajusta `lastImport`;
  - botão "Desfazer última importação (N portais, origem)" em Ajustes, com confirmação; `renderUndoImport` roda no `renderAll`;
  - `importJsonText` passou a devolver Promise: acima de `BIG_IMPORT` (300) pede `confirmDialog` com o aviso sobre ruído de prints; os chamadores usam `.catch`;
  - `nearIndex`: grade de ~22 m (0,0002°) com busca nas 3×3 células vizinhas; substitui as buscas O(n²) do import JSON e do lote.
- `index.html`: `#undoImportBtn`.
- VERSION 1.5.0.

Verificado: `npm test` 81/81. Headless com o arquivo de 796 pontos do usuário, o do Campo Belo (12) e um sintético de 12 mil pontos:
- arquivo grande: aparece o diálogo; cancelar → 0 portais; confirmar → 796;
- arquivo pequeno: sem diálogo; desfazer → volta a 796;
- 12 mil pontos: gravados em ~0,5 s, e desfazer volta a 796;
- 0 exceções.

## O que falta
- Revisar se `nearIndex` encontra todo vizinho a menos de 10 m: célula de 0,0002° ≈ 22 m em latitude e ≈ 20 m em longitude perto de -23°; em latitudes altas a célula em longitude encolhe, mas a busca 3×3 ainda cobre 10 m até ~60°.
- Desfazer guarda só 1 nível.

## Riscos
- `app.js` continua sem teste automatizado: o fluxo de desfazer foi verificado só no headless.
