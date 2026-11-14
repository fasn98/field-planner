# Handoff: claude → reviewer — import de listas grandes (v1.2.3)

## Entregue
- `app.js` importJsonText:
  - aceita a chave `pontos`, além de `portals` e `portais`;
  - portal sem `nome`/`name` recebe "Portal NN" (próximo número livre);
  - ids numéricos são tratados como "sem id": deduplicação por posição a menos de 10 m.
- `optimizer.js`:
  - `MAX_CAND = 30`: com mais candidatos no raio, ficam primeiro os que têm chave, depois os mais próximos da referência (`input.maxCandidates` sobrescreve);
  - `dist0` passou a ser medido da referência, inclusive sem GPS;
  - `out.inRadius` é novo;
  - `fanfieldPlans` respeita o prazo: no modo automático usa até metade do orçamento, com as âncoras de mais chaves primeiro.
- `app.js` renderPlanPanel: mostra "N de M portais no raio considerados" quando há corte.
- `tests/optimizer.test.js`: 2 testes novos (300 portais; sem corte com poucos). `npm test` 63/63.
- VERSION 1.2.3 em `app.js`, `sw.js` e `package.json`.

Verificado no Chrome headless com o arquivo real do usuário (796 pontos sem nome, com `id` numérico e `color`):
- import em menos de 2,5 s; os 796 salvos como "Portal 01…", só com os campos do app (`color` descartado);
- com chaves em 1 de cada 5 portais: plano em 257 ms, 30 de 164 no raio, 23 campos;
- 0 exceções.

## O que falta
- Revisar o critério de corte (pode deixar de fora um portal útil sem chave mais distante) e o `dist0` sem GPS.
- Conformidade: o campo `color` (facção) não é armazenado; confirmar.

## Riscos
- 796 marcadores e 796 itens na lista: desempenho de renderização não medido em celular.
- O dedupe do import é O(n²) em haversine: 796 × 796 ≈ 630 mil chamadas, rápido no desktop.
