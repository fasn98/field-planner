# Handoff: claude → reviewer — correção das regressões N1/N2 (v1.1.1)

## Entregue
- N1 — `app.js:12-14`: `ID_RE` aceita qualquer string de 1–64 caracteres sem caracteres de controle. Ids com ".", ":" e espaço são preservados, e as referências não ficam órfãs.
- N2 — `sw.js`: cache renomeado para `tiles-v2`; o `activate` apaga `tiles-*` antigos; hits opacos são ignorados e buscados de novo.
- Nota — `app.js` renderPortals: `inPlan = Object.create(null)`.
- VERSION 1.1.1 em `app.js` e `sw.js`.

Verificado: `npm test` 46/46. Teste de upgrade no Chrome headless, partindo de um perfil com `tiles-v1` opaco e portais de id `a1b2.16`, `x:y` e `com espaço`. Depois do upgrade: `tiles-v1` apagado, 12/12 tiles carregados (cors), ids, bloqueador e done preservados, 0 exceções.

## O que falta
- Conferir as três correções por leitura.

## Riscos
- `sanitizePairs` ainda deduplica por direção (A→B e B→A coexistem). Ficou como nota, sem correção.
