# Handoff: claude → reviewer — Fase 1 da simulação (v1.3.0)

## Entregue
- `optimizer.js`:
  - `State.area` soma a área dos campos planejados (m², via `G.triangleArea`);
  - `finish` devolve `area`;
  - objetivo novo `mu`: `score = área − distância`; na gulosa, o ganho vem da área que o link fecha (×10, +1 por campo);
  - com `ignoreKeys`, o corte de candidatos usa só a distância;
  - saída: `area` por campo e por link, `out.area`, `out.simulation`; na simulação, `keysMissing` vira a lista de farm (`need` = usado, `have` = informado).
- `index.html`: caixa "Simular sem chaves" (`#cfgSimulate`), objetivo "Máx. área (≈ MU)" e estilos `.sim-toggle`, `.sim-banner`, `.farm-total`.
- `app.js`:
  - `settings.simulate` é persistido, aceito no import e repassado como `ignoreKeys`;
  - ligar ou desligar a simulação recalcula o plano, se já houver um;
  - `fmtArea` é novo;
  - painel: aviso de simulação, área total, área por link nos passos e "🔑 Lista de farm" com o total de chaves;
  - o modo em campo fica desabilitado na simulação;
  - limite do raio subiu de 20 km para 100 km (campos grandes, como o do usuário: Riacho Grande–Mauá–Santo André).
- `tests/simulation.test.js`: 5 testes (farm, comportamento sem simulação preservado, área 300×260 m, `mu` ≥ `campos` em área, corte por distância na simulação). `npm test` 68/68.
- VERSION 1.3.0 em `app.js`, `sw.js` e `package.json`.

Verificado no Chrome headless com 3 portais aproximados (Riacho Grande, Mauá, Santo André):
- simulação: 1 campo de 44,02 km², 3 links, farm de 3 chaves em 2 portais, modo em campo desabilitado;
- simulação desligada: 0 links e a dica de chaves;
- 0 exceções.

## O que falta
- Revisar se a lista de farm está correta: `need` conta só os destinos de links do plano.
- Revisar se o objetivo `mu` com o fanfield e com a busca exaustiva escolhe pela área.
- Conformidade: nada novo de rede.

## Riscos
- Raio de até 100 km: a projeção local é uma aproximação; com lados de dezenas de km, o erro do teste de cruzamento cresce, mas segue pequeno nessa escala.
- A área serve como estimativa de MU só dentro de uma mesma região (a densidade varia).

## Adendo: correções da revisão e multicamada (ainda v1.3.0)
- I1: `geo.js` makeProjection agora é gnomônica centrada na referência (geodésicas viram retas). No `optimizer.js` whyNot, alcance e "mesma posição" usam `G.haversine`. Testes novos em `tests/intersection.test.js`: o ponto médio da geodésica de ~60 km cai a menos de 0,5 m da reta projetada, e um cruzamento a 10 m da geodésica é decidido certo. Os dois FALHAM com a projeção equiretangular antiga (conferido rodando contra uma cópia com a projeção antiga).
- M1: score `mu` = área − distância × 1e-3.
- Pedido novo do usuário: estratégia "multicamada" (`optimizer.js` layerChain/layerPlans e policy `layers` no simulate).
  - base A–B entre todos os pares; de cada lado, a maior cadeia encaixada C1 ⊃ … ⊃ Cn por DP, com peso 1 ou área no `mu`;
  - ordem: A→B, depois Cn→A/B … C1→A/B, do miolo para fora;
  - orçamento do automático: fan ≤ 1/3, multicamada ≤ 2/3, triangulação até o fim;
  - saída `base` e `layers`;
  - UI: opção "Multicamada", e o resumo mostra "base: A – B · N camada(s)".
- `tests/multilayer.test.js`: 6 testes. `npm test` 76/76.
- Headless com 2 âncoras a 9 km e 6 centrais encaixados (simulação + mu): o automático escolheu a triangulação, com 12 campos e 116 km² (a multicamada pura daria ≈90 km²); 0 exceções.
