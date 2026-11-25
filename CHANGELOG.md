# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Datas no formato AAAA-MM-DD.

## [1.13.0] — 2026-11-25
### Adicionado
- **Ajustes → Importar print do Intel** (ADR-0005): lê no aparelho, por canvas, um print do Intel (mapa escuro) que o usuário tirou. Sem IA e sem nenhuma requisição; a imagem não é guardada.
  - Detecção por cores fixas: neutros (miolo 86,86,86 ±3 com anel branco), verde/azul (miolo cercado pelo anel de ressonadores), Machina (vermelho/rosa); links verdes/azuis por Hough; portais sob campo pela sombra do campo; interface ignorada.
  - Georreferência por 1 a 3 portais tocados no print (portal cadastrado ou link do Google Maps): 1 ponto só translada com a escala padrão 156543.03·cos(lat)/2^z/DPR (z=15, DPR do aparelho, editáveis); 2+ ajustam a escala e mostram o resíduo de cada ponto; acima de 30 m não grava.
  - Prévia sobre o print antes de gravar. Portais novos "Print NN" ("ESTIMADO pelo print DD/MM HH:MM"); a < 15 m de um existente só atualiza a facção. Links viram bloqueadores com origem e data; ponta fora do print vira o novo bloqueador **segmento** (sem portal), respeitado pelo otimizador e pela validação do plano. Portais sob campo entram em `coveredManual`. ↶ Desfazer volta tudo.
- Bloqueadores de print mostram a idade; **Apagar bloqueios de print com mais de X dias** (padrão 3).
- Portal guarda a **facção** (`faccao`, só a cor). A regra 4 da política de conformidade foi atualizada.
- 11 testes novos (`tests/intelprint.test.js`, prints sintéticos) e 3 com os prints reais de 25/11 (`tests/intel-real-25112026.test.js`, pulados sem as fixtures locais).

## [1.12.0] — 2026-11-25
### Adicionado
- **Ajustes → Máx. chaves por portal** (padrão 8, faixa 1–50, `settings.maxKeys`): o otimizador nunca planeja mais links chegando num portal do que o limite, também em modo Simulação. Fora da simulação o limite efetivo é min(maxKeys, chaves que tenho).
- **Fanfield com várias âncoras:** com o limite, testa pares e trios de âncoras (cada uma com até maxKeys links de entrada) e fica com o plano que mais rende no objetivo escolhido, sem cruzar links e respeitando o limite de links de saída.
- Resumo do plano e PDF mostram "maior demanda de chaves: X (portal Y)"; lista de farm e PDF nunca passam de maxKeys num portal.
- `maxKeys` entra no export/import JSON (arquivo sem ele → 8) e no registro do plano (`settings.maxKeys`, `result.maxKeys`, `result.anchors`, `result.maxKeyDemand`).
- 8 testes novos (`tests/max-keys.test.js`), incluindo a comparação com o otimizador da v1.11.0 (`tests/fixtures/optimizer-1.11.0.js`) para maxKeys=50.

## [1.11.2] — 2026-11-18
### Adicionado
- **Observações de listas de chaves no export/import do JSON**, para juntar as leituras de dois aparelhos (computador e celular) na trilateração.
  - Exportar pergunta "Incluir observações?" quando há observações: elas guardam a posição, a data e a hora de cada print. Cancelar exporta sem elas.
  - O arquivo leva só os campos de uma observação (`observacoes`: nome, endereço, distância, nível, chaves, origem e hora). A chave da API e as imagens nunca entram.
  - Importar **pergunta antes** ("Importe só se forem SUAS": observações de outro jogador não podem ser guardadas) e então junta as observações às deste aparelho, sem repetir, com cada uma validada (`sanitizeObservation`, `mergeObservations` em `matching.js`, indexada por nome), e guarda as 2000 mais recentes. Hora no futuro vira a hora atual.
- 6 testes novos (`tests/observations-export.test.js`), incluindo 2 leituras num aparelho + 1 no outro dando a posição estimada só depois de juntar.

## [1.11.1] — 2026-11-18
### Alterado
- **Importar lista de links confere nome, além de distância** (a mesma regra de todas as formas de cadastro):
  - entram desmarcadas, com aviso, as linhas com nome igual ao de um portal do app ou ao de uma linha anterior da lista, e as que ficam a menos de 30 m de um portal do app ou de outra linha (antes só a menos de 10 m);
  - `Portal NN`, automático das linhas sem nome ou digitado, não conta como nome repetido;
  - o aviso é refeito ao editar o nome na prévia;
  - marcar de novo uma linha com aviso e importar pede confirmação; cancelar volta à prévia sem perder nada;
  - a regra é uma função pura, `bulkDuplicates` em `matching.js`, com 9 testes (`tests/bulk-duplicates.test.js`).
- Decisão registrada: geocodificar o endereço do print (ADR-0004) foi **rejeitada** pelo dono; a política de conformidade não muda.

## [1.11.0] — 2026-11-18
### Adicionado
- **Nomear por print → Chaves sem portal no app:** o nome lido que não casa com nenhum portal do app vira um "portal potencial" para cadastrar. A seção substitui "Longe daqui".
  - **Posição estimada** (3+ prints de 3+ pontos espalhados): trilateração que também usa as distâncias arredondadas do jogo (≥ 1 km), com peso pelo arredondamento. O erro mostrado é 1,5× o esperado pela geometria mais 3× o resíduo (cobriu 99% em simulação com leituras certas); só com erro até 150 m. Com 4+ pontos, conferência deixando um de fora; com 3, a estimativa fica marcada "sem conferência" (um print lido errado pode passar). **➕ Cadastrar aqui**, **Ver no mapa** e seleção múltipla com **Cadastrar selecionados**.
  - **Falta posição:** dica de quantos pontos faltam, **📎 Cadastrar pelo link** (com chaves e nível do print) e **📍 Marcar no mapa** (anéis no mapa; o toque longo dentro de um anel abre o formulário preenchido; fora dos anéis pede confirmação).
  - `matching.js`: `matchKeyList` devolve `unregistered` (`far` continua, por compatibilidade); `trilaterate(obs, { all: true })`.
### Alterado
- **Nunca duplicar portal:**
  - nome igual a um portal do app (em qualquer lugar) ou pedaço do nome de um cadastrado não vira portal potencial; nome que é começo de outro da lista fica marcado como cortado, sem cadastro;
  - portal do app dentro do erro da estimativa (mínimo 30 m) tira o nome do lote, mostra aviso e, para provisórios, **É este** (renomeia em vez de criar); cadastrar mesmo assim pede confirmação;
  - o formulário de portal novo pede confirmação para nome igual a um existente ("Nome repetido"), além da regra de 30 m que já existia.
- **↶ Desfazer remove portais cadastrados** depois do último passo: cadastro pelo formulário, lista de links, importação e Nomear por print. O aviso diz quantos foram removidos.
- **Importar JSON:** portal com id de outro aparelho, no mesmo lugar (< 30 m) e com o mesmo nome de um portal do app, não entra de novo (conta como mantido); bloqueadores, links feitos e plano do arquivo ligados a ele passam a apontar para o portal mantido.
- "Cadastrar selecionados" bloqueia o lote quando dois itens têm o mesmo nome (duas grafias lidas do mesmo portal); duas estimativas a menos da soma dos erros pedem confirmação. O raio de "pode ser o mesmo" soma a incerteza da posição cadastrada (20 m estimada, 5 m confirmada). Portal do app cujo nome é começo do lido ("Igreja Nossa Senhora" × "… da Conceição") vira aviso, fora do lote. "Marcar no mapa" pede confirmação fora de qualquer um dos anéis.
- Corrigido: depois de um ↶, tocar 🔑 em menos de 10 s não empilhava passo, e o ↶ seguinte voltava dois passos.
- Um nome pendente sem candidato aparece só em "Chaves sem portal no app", não também em Pendentes.
- 23 testes novos (`tests/unregistered.test.js`). Nome provisório lido do print ("BK 009") nunca vira portal potencial; `cutOf` aponta para o nome mais longo.

## [1.10.2] — 2026-11-16
### Alterado
- **Nomear por print, lista de chaves: menos ruído nos pendentes** (teste em campo de 16/11, 13 pendentes, a maioria sem decisão possível).
  - O pedido à IA manda pular portal com nome cortado pela tela, em vez de copiar o pedaço visível ("Quadra de Squash do", "Ninhos D").
  - Um pedaço que ainda vier é trocado pelo nome inteiro quando a mesma linha aparece inteira em outro print do mesmo ponto (origem a < 5 m), com a mesma distância, abaixo de 1 km. Fica a observação inteira, com o endereço, as chaves e o nível dela. Acima de 1 km a distância é arredondada pelo jogo e não junta.
  - Chaves de portais a mais de 5 km (de outras cidades) saem dos pendentes para um grupo recolhido, **Longe daqui**. Portal longe já cadastrado continua em "Já cadastrados".
- 16 testes novos (`tests/keylist-scenario.test.js`, `tests/printread.test.js`).

## [1.10.1] — 2026-11-16
### Alterado
- **Nomear por print, lista de chaves: a rua do print filtra os candidatos.** Se nenhum portal do anel fica na rua do endereço lido (a comparação normaliza "Av."/"Avenida", acentos e preposições) e todos os candidatos dizem a sua rua, o pendente mostra "provavelmente não cadastrado". Nesse caso não aparecem os botões "É este" para portais de outra rua; aparece **📎 Cadastrar pelo link**, que abre "Colar link" com o nome do print já preenchido.
  - Caso real: "Estatua Loro Mania" (Av. Santo Amaro, 852,7 m) listava CB 026 (R. Nova York) e BW 078 (R. Ipurinás).
  - Candidato sem rua no nome, como "Portal 07", não é descartado pela rua. Endereço que não começa por uma rua ("Shopping …, Av. …") também não descarta ninguém. Na observação, a rua só conta num campo explícito ("Rua: …").
  - O sufixo de rua do provisório é só a rua mais próxima e pode não bater (portal de esquina). Por isso continua havendo **É este mesmo assim**, com uma confirmação que avisa que a rua não bate.
- **Cadastrar portal novo a menos de 30 m de outro pede confirmação.** Isso evita duplicata ao cadastrar pelo link um portal que já existia com nome provisório.
- `tests/keylist-scenario.test.js` com 3 casos novos; `tests/real-16112026.test.js` com a Loro Mania (só local).

## [1.10.0] — 2026-11-16
A v1.9.0 está reservada para o sync na nuvem (ADR-0002, ainda em decisão).

### Adicionado
- **Nomear por print** (Ajustes, desligado por padrão; ADR-0003): troca nomes provisórios pelos nomes reais a partir de screenshots, com confirmação um a um.
  - A leitura vai direto do navegador à API da Anthropic, com a chave do usuário e modelo configurável (padrão `claude-sonnet-5-5`). A resposta vem em JSON estrito e o app a valida de novo (`printread.js`).
  - O casamento é determinístico e sem rede (`matching.js`):
    - mapa: RANSAC, mínimos quadrados e atribuição húngara até 40 m;
    - lista de chaves: anéis de distância a partir do GPS do recebimento, combinados entre prints, com trilateração;
    - portal único: sempre confirmado.
  - Revisão: aceitar, corrigir ou pular; "aceitar todos acima de X%"; e, só quando marcados, atualizar chaves e nível e ajustar posição.
    - Num empate, o jogador escolhe ("É este").
    - Dois nomes no mesmo portal ficam os dois pendentes, com aviso de conflito.
    - O lote exige no mínimo 80% e deixa de fora as sugestões em conflito.
  - Desfazer cobre nome, chaves, nível e posição. Renomear não recalcula o plano fixado.
- **Correções do teste real de 16/11** (4 prints da lista de chaves):
  - **Identidade por nome antes da distância.** O nome do print é comparado com TODOS os portais. A comparação ignora acentos, pontuação, o sufixo de rua depois de " - ", artigos e preposições, e aceita palavras quase iguais ("Manhathan" ≈ "Manhattan"). Similaridade ≥ 0,85 com o portal dentro do anel ×2 vira "✓ já cadastrado": o app só oferece atualizar chaves e nível (e ajustar posição com 3 ou mais observações) e nunca propõe renomear outro portal com esse nome. Antes, os 10 portais já nomeados à mão viravam sugestão de renomear um BK vizinho, ou "nenhum portal nesse anel".
  - **Só portais provisórios recebem nome:** BK, CB, BW, GJ, ENS, "Portal NN" e "Enseada NN", e só os que nenhuma outra observação já reconheceu pelo nome.
  - **Nome único:** o Aceitar fica bloqueado quando o nome já é de outro portal. A tela mostra qual é e oferece "É este".
  - **Tolerância do anel:** 12 m + precisão do GPS (posição digitada: 10 m) + incerteza do portal (20 m se estimado ou nunca confirmado, 5 m se confirmado). Com 1 km ou mais, mais 60 m, e esse anel nunca decide sozinho. Antes ficava de fora, por exemplo, o cb-039 a 597,9 m de um portal a 575,2 m.
  - **Uma observação só** nunca passa de 45% de confiança; duas origens, 70%; três, 85%.
  - **Deduplicação:** a mesma imagem (pelo hash do conteúdo) é ignorada. A mesma observação (nome, origem a menos de 5 m e mesma distância) não conta de novo, mesmo vinda de outro print.
  - **Checkboxes** "atualizar chaves/nível" com tamanho padrão, alinhados ao rótulo, com alvo de toque de 44 px.
  - `tests/keylist-scenario.test.js`: cenário sintético com a mesma estrutura, com nomes e lugares inventados.
  - `tests/real-16112026.test.js`: o caso real, que roda só no computador do dono, porque as fixtures em `tests/fixtures-local/` (fora do git) têm a posição de onde os prints foram tirados. Sem elas, o teste é pulado.
- **Receber prints compartilhados** pelo Android (Web Share Target, só imagens). O app grava a posição do GPS no recebimento e avisa se a precisão passar de 25 m.
- `tests/matching.test.js`, `tests/printread.test.js`, `tests/keylist-scenario.test.js` e `tests/real-16112026.test.js`: 140 testes com as fixtures locais; 134, mais 6 pulados, sem elas.

### Alterado
- **Política de conformidade:** ganha a regra 7, uma exceção explícita para chamadas à API da Anthropic iniciadas pelo usuário. O texto da aba Ajustes acompanha.
- **CSP:** `connect-src` passa a liberar só `https://api.anthropic.com`, além da própria origem. O teste de conformidade exige exatamente isso.
- **Exportar JSON:** usa uma lista fechada de campos (`plan.js`, `exportPayload`). Chave da API, preferências e observações de prints nunca entram.
- **Desfazer:** passa a guardar também nome, nível, posição e observação dos portais. Editar, mover, 🔑 + / − e importar ganham o seu próprio ponto de desfazer; toques seguidos de 🔑 no mesmo portal contam como um só.
  - Depois de uma importação, o ↶ volta as atualizações de portais existentes, os bloqueadores e os links marcados. Não volta as configurações vindas do arquivo. Os portais novos saem por "Desfazer última importação".
- **Apagar todos os dados:** passa a apagar também a chave da API, as preferências e as observações de prints, além do cache de compartilhados.

## [1.8.0] — 2026-11-16
### Adicionado
- **Plano fixo**: o plano fica salvo no aparelho (`db.plan` no localStorage) com o resultado completo e as entradas usadas no cálculo: partida, configurações, ids dos candidatos, data/hora e versão do app. Ao reabrir, o app restaura o plano como está, sem recalcular (`plan.js`, `makeRecord`/`sanitizeRecord`).
- **📌 Fixar plano** (aba Plano): um plano fixado nunca é recalculado sozinho, nem por GPS (> 100 m), nem a cada 5 min, nem por dados alterados, nem por troca de simulação. Só pelo **⟳ Recalcular**, que pede confirmação ("Isso substitui o plano fixado. Continuar?"). Plano calculado em simulação é fixado automaticamente (`plan.js`, `autoRecalcReason`).
- **Validação do plano salvo** contra os dados atuais, sem recalcular: refaz os links restantes na mesma ordem e avisa, com os passos afetados, quando um portal do plano foi excluído ou movido mais de 30 m, quando um link passou a cruzar um bloqueador, ou quando um link fecha menos campos que antes. No modo em campo, o aviso aparece no link atual (`plan.js`, `validate`).
- **Simulação → campo sem recalcular**: com o plano de simulação fixado e todas as chaves da lista de farm, **Modo em campo** (ou desligar a simulação) usa a mesma ordem e os mesmos links, conferidos com as chaves reais. Se faltar chave ou algum link não for mais possível, o plano continua como simulação e o app diz qual passo falha (`plan.js`, `toFieldPlan`).
- Exportar JSON inclui o plano (chave `plan`). Importar um arquivo com plano pergunta se deve restaurá-lo.
- `tests/plan.test.js` (97 testes no total).

### Corrigido
- "Tem", "Chaves consumidas", lista de farm, chaves faltantes e o total agora vêm das chaves de agora, não do momento do cálculo. Tocar em 🔑 + / − atualiza o plano na hora. Antes, o PDF mostrava "Tem 0" para portais com chave.

### Alterado
- Em campo, **✓ Concluído** e **✕ Falhou** num plano fixado avançam para o próximo link sem recalcular, e o progresso fica salvo. **↶ Desfazer** devolve o link ao plano.
- Uma atualização do app pode recarregar a página com um plano aberto, porque o plano não se perde mais.

## [1.7.1] — 2026-11-15
### Alterado
- **Nível padrão L5**: portal novo, importação em lote e arquivo importado sem nível entram como L5, não mais L1 (L1 alcança só 160 m e quase nunca fecha campo). Portais já cadastrados não mudam.

## [1.7.0] — 2026-11-15
### Adicionado
- **Rota no Google Maps** (aba Plano): links que abrem as paradas do plano, na ordem, no Google Maps (a pé, carro ou bicicleta), partindo da posição atual. Planos com mais de 10 paradas viram trechos encadeados, porque o Google Maps aceita até 9 paradas intermediárias por rota. O app não faz requisição: só monta o link (`geo.js`, `mapsRouteUrls`).
- **Exportar plano em PDF**: relatório pela janela de impressão do navegador ("Salvar como PDF") com resumo, croqui em SVG (rota, links numerados, campos e escala), links da rota, passos com coordenadas, chaves consumidas e lista de farm.
- `tests/maps-route.test.js` (86 testes no total).

## [1.6.2] — 2026-11-15
### Corrigido
- Android: em "Importar lista de links → Abrir arquivo", arquivos .txt/.csv apareciam cinza e não podiam ser escolhidos (o seletor filtrava pelo tipo do arquivo, e arquivos recebidos por apps de conversa costumam vir com tipo genérico). O botão agora aceita qualquer arquivo; o conteúdo continua validado (máx. 5 MB, linhas sem coordenadas aparecem como erro na prévia).

## [1.6.1] — 2026-11-14
### Corrigido
- Celular: a barra "Salvar posição" do modo mover podia ficar fora da tela quando a página estava ampliada (zoom do navegador ao tocar nos campos). Campos agora usam fonte de 16 px, a página não amplia (`maximum-scale=1`; o mapa continua com zoom normal) e o modo mover desfaz a ampliação ao começar.

## [1.6.0] — 2026-11-14
### Adicionado
- **Mover portal no mapa**: no diálogo do portal, "📍 Mover no mapa" abre um pino que dá para arrastar, ou basta tocar no lugar certo. A barra mostra a distância do ajuste e tem Cancelar / Salvar posição. Serve para corrigir posições de importações cruas (prints de mapa).
- **Excluir** direto pela barra de mover (com confirmação), para limpar pontos falsos rapidamente.

 — 2026-11-14
### Adicionado
- **Desfazer última importação** (Ajustes): remove os portais adicionados na última importação (arquivo JSON ou lista de links), com bloqueadores e links feitos ligados a eles. Atualizações de portais existentes e configurações vindas do arquivo não são revertidas. Só 1 nível.
- Confirmação antes de importar arquivos com mais de 300 pontos, com aviso sobre ruído em listas detectadas de prints.

### Alterado
- Checagem de duplicados (import JSON e lista de links) usa um índice espacial em grade (~22 m, ajustado à latitude) em vez de comparar todos com todos: 12 mil pontos são gravados em ~0,5 s.

## [1.4.0] — 2026-11-14
### Adicionado
- Plano no mapa: rota amarela tracejada A → 1 → 2… (A = posição usada no cálculo), links numerados, rótulo "nome · 🔑N" nos portais do plano e campos com contorno e sombra (`app.js:232-270`, `app.js:207`).
- Botão "Ver plano no mapa": recolhe o painel e enquadra o plano (`app.js:275`).
- Tempo estimado a pé, de carro e de transporte público, calculado localmente a partir da linha reta × desvio das ruas, com +1 min por link e por parada (`geo.js:240-263`). Não é rota real: o app não consulta serviços de rotas.
- `tests/travel.test.js` (81 testes no total).

## [1.3.1] — 2026-11-14
### Alterado
- Texto de conformidade na aba Ajustes alinhado à política do README: portais inseridos pelo usuário (digitados, links colados ou arquivos importados); o plano só simula. **Não revisado:** mudança só de texto.

## [1.3.0] — 2026-11-14
### Adicionado
- "Simular sem chaves" em Ajustes: mostra o melhor plano pela posição dos portais e a lista de farm (chaves que faltam por portal, com total). O modo em campo fica desabilitado na simulação (`app.js:354`, `app.js:400`).
- Objetivo "Máx. área (≈ MU)": a área decide e a caminhada só desempata; o plano mostra a área por campo, por link e o total (`optimizer.js:267`).
- Estratégia "Multicamada": base A–B e cadeia de portais centrais encaixados, executada do miolo para fora; compete no modo automático (`optimizer.js:386`).
- O raio a pé vai até 100 km, antes 20 km (`app.js:378`).
- `tests/simulation.test.js` e `tests/multilayer.test.js`; novos testes de geodésica em `tests/intersection.test.js` (77 testes no total).

### Alterado
- Orçamento do modo automático: 1/3 fanfield, 1/3 multicamada, resto triangulação (`optimizer.js:461-462`).

### Corrigido
- Geometria exata para links longos: a projeção passou a ser gnomônica (geodésicas viram retas) e o alcance é medido por haversine (`geo.js:36-50`). Antes, cruzamentos de links de dezenas de km podiam ser decididos errado. Portais a mais de ~80° da referência ficam fora da conta (`optimizer.js:16`).

### Conhecido
- A área serve como estimativa de MU só dentro de uma mesma região; a densidade populacional varia.

## [1.2.3] — 2026-11-14
### Adicionado
- O import de JSON aceita a chave `"pontos"`; portal sem nome recebe "Portal NN" quando é adicionado. Atualizar por `id` preserva o nome existente (`app.js:657`, `app.js:668-676`).
- O plano mostra "N de M portais considerados" quando há mais de 30 no raio (`app.js:401`).

### Corrigido
- Listas grandes: o otimizador considera no máximo 30 portais por cálculo, com chave e mais próximos primeiro (`optimizer.js:15`, `optimizer.js:63-72`). O fanfield passa a respeitar o prazo: testa âncoras com mais chaves primeiro e, no modo automático, usa no máximo metade do orçamento (`optimizer.js:305-310`, `optimizer.js:385`).
- Campos extras dos arquivos importados, como cor ou facção, não são armazenados (`sanitizePortal`, `app.js:64`).

### Documentação
- README: a regra 5 da política de conformidade passa a descrever a origem dos dados (digitados, link colado ou arquivo que o usuário prepara e importa, inclusive coordenadas estimadas de prints; o app não captura tela nem lê serviços do jogo).
- README: nova regra 6, "O plano não substitui o jogo", e descarte de campos extras na regra 4, com linha na tabela de garantias.
- README: nota sobre listas grandes (máx. 30 portais, conferir coordenadas estimadas).

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
