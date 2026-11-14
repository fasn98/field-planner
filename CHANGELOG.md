# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Datas no formato AAAA-MM-DD.

## [1.2.2] — 2026-11-14
### Adicionado
- Atualização automática: o service worker serve os arquivos de um cache por `VERSION`, sem misturar versões. A instalação baixa tudo com `cache: 'reload'`, o registro usa `updateViaCache: 'none'`, e o app procura versão nova ao abrir, ao voltar para o app e a cada 30 min (`sw.js:25-28`, `app.js:1029-1032`).
- Quando uma versão nova assume logo após a abertura (menos de 20 s), sem modo em campo, plano nem diálogo aberto, o app recarrega sozinho; nos outros casos mostra "Nova versão disponível" (`app.js:1035-1044`).
- Aba Portais: o contador de chaves ganha o rótulo "🔑 Chaves", zero aparece em vermelho com "sem chave: não recebe links", e a linha mostra nível e alcance (`app.js:467-476`).
- Plano sem links explica o motivo provável: portais sem chave, portais em L1, poucos portais no raio (`app.js:405-416`).
- Teste confirma que `VERSION` é a mesma em `app.js`, `sw.js` e `package.json`.

### Corrigido
- Importar de novo um JSON cujos portais não têm `id` não duplica: portal a menos de 10 m de um existente é tratado como o mesmo e mantém chaves e nível já ajustados (`app.js:665-666`).
- O import de JSON aceita `latitude`, `longitude` e `lon` além de `lat`/`lng` (`app.js:66-68`).
- Mensagens de erro ficam 10 s na tela (`app.js:141`).
- O botão `+` da aba Portais não é mais cortado no celular.

### Conhecido
- Quem está na 1.2.1 precisa de uma recarga extra para a 1.2.2 assumir.

## [1.2.1] — 2026-11-14
### Corrigido
- O import de JSON aceita a chave `"portais"` além de `"portals"` (`app.js:655`).
- **Não revisado:** esta mudança não passou pelo reviewer.

## [1.2.0] — 2026-11-14
### Adicionado
- "Importar lista de links" na aba Portais: uma linha por portal, com link do Google Maps ou coordenadas; o nome é opcional e, sem ele, o portal vira "Portal NN" (próximo número livre). Mostra prévia editável antes de salvar, com nível e chaves padrão para o lote (`index.html`, `app.js:673`).
- Portais a menos de 10 m de um já cadastrado ou de outra linha da lista entram desmarcados na prévia (`app.js:673`, `app.js:723`).
- Aceita arquivos `.txt`, `.csv` e `.json` (máx. 5 MB, `app.js:690`); um `.json` válido usa o import completo de JSON. A lista lê até 2000 linhas (`geo.js:219`, `app.js:713`).

### Corrigido
- `parseCoords` prioriza `!3d…!4d…` (pino do lugar) sobre `@` (centro da tela), e `pll=` sobre `ll=` (`geo.js:163-165`). Links com `!3d` e `?q=` ao mesmo tempo passam a dar outro resultado.

### Conhecido
- Links curtos (`maps.app.goo.gl`) não têm coordenadas e são recusados; o app nunca abre links.

## [1.1.2] — 2026-11-13
### Corrigido
- Importação de JSON: a chave de deduplicação de links feitos e de bloqueadores usa `\u0000` como separador (`app.js:82`, `app.js:95`). Antes, ids contendo `>` ou `|` podiam colidir e descartar itens válidos. Ids não podem conter caracteres de controle (`app.js:14`), então o separador é inequívoco.
- **Não revisado:** esta mudança não passou pelo reviewer.

## [1.1.1] — 2026-11-13
### Corrigido
- Ids de portal com `.`, `:` ou espaço (ex.: `a1b2.16`, `x:y`, `com espaço`) são preservados; antes eram trocados e deixavam bloqueadores e links feitos órfãos. `ID_RE` aceita 1–64 caracteres sem caracteres de controle (`app.js:14`).
- Cache de tiles renomeado para `tiles-v2`; o service worker apaga caches `tiles-*` antigos ao ativar e ignora respostas opacas já guardadas, buscando o tile de novo (`sw.js:9`, `sw.js:28`, `sw.js:60`).
- Marcação de portais do plano usa objeto sem protótipo (`app.js:181`).

### Conhecido
- `sanitizePairs` ainda trata A→B e B→A como pares distintos, e ambos podem coexistir. Sem correção.

## [1.1.0] — 2026-11-13
### Corrigido
- Diálogo "Falhou": o link em questão fica congelado enquanto o diálogo está aberto, e o app só avança o passo se o plano não mudou nesse intervalo (`app.js:770`, `app.js:796`).
- Ids como `constructor`, `toString` e `__proto__` em portais, bloqueadores, links feitos e excluídos não causam exceção nem geram links; portais sem id string são ignorados (`optimizer.js:23`, `optimizer.js:26`, `app.js:78`).
- Tiles do mapa são pedidos com CORS (`crossOrigin: true`, `app.js:161`) e o service worker só guarda respostas `ok`, sem quebrar se a gravação falhar (`sw.js:63`).
- Importação de JSON deduplica links feitos, excluídos e bloqueadores, e passa a ler `coveredManual` e `settings` (`app.js:634`, `app.js:645`, `app.js:648`).
- Recálculo por movimento (> 100 m) só ocorre no modo em campo, e dispara também quando o GPS aparece depois de um cálculo feito sem GPS (`app.js:280`).
- Erro no Web Worker é tratado (`app.js:305`).
- Fanfield: portal visitado sem links entra na prioridade de destinos, em ordem de visita (`optimizer.js:174`, `optimizer.js:183`).
- Dois portais a menos de 1 m um do outro nunca recebem link entre si (`optimizer.js:127`).

### Adicionado
- O app pede armazenamento persistente com `navigator.storage.persist()` (`app.js:843`).
- `tests/review-fixes.test.js`, com 9 testes para os itens de `optimizer.js` acima.

### Não coberto por testes automatizados
- Os fluxos de `app.js` e `sw.js` listados acima: sem export, só tiveram smoke test manual.

## [1.0.0] — 2026-11-13
### Adicionado
- PWA offline para planejar campos pequenos a pé, com cadastro manual de portais (formulário, toque longo no mapa, colar link de mapa) e importação/exportação em JSON.
- Otimizador em Web Worker com duas estratégias (fanfield e triangulação gulosa), três objetivos (máx. campos, máx. AP, mín. distância), rota a pé e relatório de chaves faltantes.
- Modo em campo: passo atual, distância e rumo, botões Concluído, Falhou, Desfazer e Recalcular, com recálculo automático.
- GPS somente leitura.
- Service worker offline-first e manifesto PWA.
- Política de conformidade verificada por testes (sem domínios da Niantic; CSP restrita ao OSM).
- 37 testes com `npm test`.
