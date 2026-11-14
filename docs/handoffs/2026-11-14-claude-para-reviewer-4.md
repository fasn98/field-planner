# Handoff: claude → reviewer — plano no mapa e tempo estimado (v1.4.0)

## Entregue
- `geo.js`: `travelTimes(legs, links)` e `TRAVEL`, com as hipóteses no comentário. Cada trecho é a distância em linha reta × desvio das ruas.
  - a pé: 4,5 km/h;
  - carro: 20 km/h, +3 min por parada; trecho < 400 m vai a pé;
  - transporte: 15 km/h, +10 min de espera; trecho < 1 km vai a pé;
  - +1 min por link e por parada.
- `app.js`:
  - `renderPlanOnMap`: campos com contorno; nova `routeLayer` com polyline A→1→2… (`lastOptPos` + `plan.steps`) e marcadores `.route-num`;
  - `renderPortals`: rótulo permanente (`.plabel`) só nos portais do plano (origem ou destino de link);
  - `showPlanOnMap` recolhe o painel e faz `fitBounds`;
  - painel: tempos 🚶/🚗/🚌, aviso de que é estimativa sem serviço de rotas, e botão "Ver plano no mapa";
  - `fmtMin` é novo.
- `index.html`: estilos `.route-num`, `.plabel`, `.times`.
- `tests/travel.test.js`: 4 testes. `npm test` 81/81.
- VERSION 1.4.0 em `app.js`, `sw.js` e `package.json`.

Verificado no Chrome headless com o arquivo de 796 pontos do usuário (L5, simulação, raio 1500 m):
- 51 campos e 79 links; 30 marcadores de rota (A + 29 passos) e 30 rótulos;
- o painel recolheu; 0 exceções.

## O que falta
- Rótulos: o nome passa por `esc()` antes do Leaflet (que trata o tooltip como HTML).
- Desempenho de render com muitos links e rótulos: não medido em celular.
- Conformidade: nada de rede; os tempos são calculados localmente.
