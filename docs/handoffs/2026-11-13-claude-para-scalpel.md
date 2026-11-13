# Handoff: claude → scalpel — correções pós-revisão (v1.1.0)

## Entregue
Correções dos achados de `docs/handoffs/2026-11-13-claude-para-reviewer.md` (relatório do reviewer):
- I1 — `app.js`: `failTarget` congela o link quando o diálogo "Falhou" abre; `advanceLocal` só roda se o plano não mudou.
- I2 — `optimizer.js` buildWorld/State: `idx`, `excluded` e `pairs` usam `Object.create(null)`; portais sem id string são ignorados. `app.js`: `ID_RE`, `idSet`, `sanitizePairs`; `load()` também saneia dados já salvos.
- I3 — `app.js` tileLayer `crossOrigin: true`; `sw.js` só cacheia `res.ok`, com `.catch` no put; `navigator.storage.persist()`.
- M1/M2 — import deduplica done/excluded/bloqueadores e passa a ler `coveredManual` e `settings`.
- M3 — recálculo por movimento só no modo em campo, e dispara quando o GPS aparece depois de um cálculo sem GPS.
- M4 — `worker.onerror`.
- M5 — `optimizer.js` simulate: `visitOrder` substitui `Object.keys(visited)`.
- M8 — `optimizer.js` whyNot: 'portais na mesma posição' (< 1 m).
- VERSION 1.1.0 em `app.js` e `sw.js`.

Verificado por mim: `npm test` 37/37. Smoke no Chrome headless: plano ok; tiles em cache com tipo `cors` (antes eram opacos); ids `constructor`/`toString`/`__proto__` no localStorage não geram exceção.

## O que falta
1. Testes node para I2 no otimizador: `optimize()` com portal de id `"__proto__"`, bloqueador com `portalA: "constructor"` e done `{from: "toString"}` não lança e não gera link envolvendo esses ids.
2. Teste para M8: dois portais na mesma coordenada nunca recebem link entre si.
3. Teste para M5: no fanfield, um portal visitado sem links entra na prioridade em ordem de visita (opcional, se der para observar).
4. I1, M1-M4 vivem em `app.js` (IIFE sem exports) e não têm teste em node. Se não der para testar sem refatorar, registre como não coberto em vez de mexer em app.js.

## Riscos
- `app.js` não tem nenhum teste automatizado; o fluxo do modo em campo foi validado só por smoke test.
