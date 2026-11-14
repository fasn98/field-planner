# Handoff: claude → reviewer — fim do cache "eterno" (v1.2.2)

## Entregue
- `sw.js`:
  - o shell da própria origem agora é "rede primeiro" (`networkFirst`): `fetch(req, {cache:'no-cache'})`, com o cache como reserva se a rede falhar ou demorar mais de 3 s (`NET_TIMEOUT_MS`);
  - a instalação baixa os arquivos com `cache:'reload'`;
  - os tiles não mudaram.
- `app.js`:
  - o registro usa `updateViaCache:'none'`;
  - `reg.update()` roda quando o app volta ao primeiro plano e a cada 30 min;
  - no `controllerchange`, aparece o botão `#updateBar` ("Nova versão disponível"); não recarrega sozinho;
  - `toastError` mostra o erro por 10 s e some ao toque.
- `index.html`: `#updateBar` e o estilo dele.
- VERSION 1.2.2 em `app.js`, `sw.js` e `package.json`.

Verificado com `npm test` 60/60 e com uma simulação no Chrome headless servindo uma cópia do site:
- deploy só do `app.js`: chega com 1 recarga;
- deploy com `sw.js` novo: o aviso aparece sem recarregar, e tocar nele carrega a versão nova;
- offline: o app carrega do cache.
0 exceções.

## O que falta
- Revisar `networkFirst`: corrida rede × timeout; caso sem cache e sem rede; requisições da própria origem com querystring (`ignoreSearch` no match).
- Conformidade: nenhuma origem nova.

## Riscos
- Quem tem a v1.2.1 (cache-first) ainda precisa de uma recarga extra para a v1.2.2 assumir.
- Com rede lenta, a abertura pode esperar até 3 s antes de cair no cache.
