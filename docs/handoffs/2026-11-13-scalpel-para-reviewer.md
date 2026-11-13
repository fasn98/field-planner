# Handoff: scalpel -> reviewer — testes das correções v1.1.0

## Entregue
- `tests/review-fixes.test.js` (9 testes novos). Suíte completa: 46 pass, 0 fail (37 anteriores + 9).
- I2: ids `__proto__`/`constructor`/`toString`/`hasOwnProperty` em portais, blockers, done e excluded; portal sem id string.
- M8: par coincidente nunca linkado (via optimize e via whyNot).
- M5: portal visitado sem links vira destino do fan (via `simulate`).

## Não coberto
- I1, M1-M4, I3 (tiles/sw.js), VERSION: vivem em `app.js`/`sw.js` (IIFE sem exports); sem refatorar não há como testar em node. Só smoke test manual.
- M5: verifica apenas que o portal visitado sem links vira destino, não a ordem entre vários.
- Não fiz mutação (reverter o fix) para provar que os testes de I2/M5 falhariam sem a correção, pois não altero a implementação.

## Testes falhando
Nenhum.
