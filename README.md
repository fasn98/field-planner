# Field Planner

PWA offline para planejar **campos pequenos de Ingress a pé**. Você cadastra os portais à mão, o app
calcula uma sequência de links/campos e uma rota a pé, e o **modo em campo** te guia passo a passo,
recalculando quando algo muda.

> Ferramenta independente, sem afiliação, endosso ou vínculo com a Niantic. "Ingress" é marca de seus
> respectivos donos.

---

## Política de conformidade

Estas regras são **inegociáveis** e fazem parte do design, não são opções:

1. **Zero requisições a domínios da Niantic** (`ingress.com`, `intel.ingress.com`, `nianticspatial.com`
   e afins). Nenhum scraping, crawler, bot ou chamada automática de qualquer tipo.
2. **Nenhuma integração, injeção ou leitura do app Ingress.** O Field Planner não lê tela, memória,
   notificações, arquivos nem tráfego do jogo. Um screenshot só é lido quando o próprio usuário o escolhe
   ou compartilha com o app (regra 7).
3. **GPS somente leitura** via `navigator.geolocation.watchPosition`. O app nunca altera, simula ou
   falsifica posição. Sem GPS, ele planeja a partir do centro dos portais cadastrados — e diz isso na tela.
4. **Nenhum dado de outros jogadores é armazenado.** Links bloqueadores guardam só os dois portais e a
   origem (`inimigo`/`aliado`) — nunca nome de agente. O campo de observação avisa para não registrar nomes.
   Campos extras de arquivos importados, como cor ou facção, são descartados: só posição, nome, nível,
   chaves e observação são guardados (`sanitizePortal`, `app.js:64`).
5. **Os portais entram por ação manual do usuário**: digitados, link colado, ou arquivo JSON/texto que ele
   mesmo prepara e importa. Isso inclui coordenadas que ele estima a partir de prints de mapa. O app nunca
   captura tela, não lê nem baixa nada de serviços do jogo e não automatiza a coleta: só lê o arquivo que o
   usuário escolhe. Os dados ficam apenas no aparelho (`localStorage`) e nada é enviado a servidor algum,
   salvo a exceção da regra 7.
6. **O plano não substitui o jogo.** O app só planeja; toda ação acontece no jogo, a pé. Sem a chave do
   portal (obtida em campo), não há link; sem link, não há campo; sem campo, não há MU. Todo link do plano
   usa só chaves que o usuário informou ter (`optimizer.js:137`). Nenhuma forma automatizada de agir no
   jogo ou de contornar suas regras faz parte do escopo.
7. **Exceção explícita: API da Anthropic, iniciada pelo usuário** (ADR-0003). Com **Ajustes → Nomear por
   print** ligado (vem desligado), as imagens que você escolhe ou compartilha vão direto do navegador para
   `api.anthropic.com`, com a sua chave da API, para a IA transcrever nomes de portais.
   - Nenhum serviço da Niantic é acessado.
   - Os screenshots não ficam guardados.
   - A imagem é enviada inteira, com o que estiver nela (inclusive nomes de agentes visíveis).
   - A IA é instruída a ignorar agentes, donos e COMM, e o app recusa qualquer resposta que traga campo fora
     da lista: nome, posição no print, endereço, distância, nível e chaves. Nada de outros jogadores é
     guardado (regra 4).
   - Nenhum nome é aplicado sem a sua confirmação.
   - A chave da API fica só neste aparelho e nunca entra no JSON exportado.

### Como isso é garantido no código

| Garantia | Onde |
| :- | :- |
| A página só pode buscar recursos de si mesma, imagens de `tile.openstreetmap.org` e chamar `api.anthropic.com` | CSP em `index.html` (`default-src 'self'`, `connect-src 'self' https://api.anthropic.com`) |
| Só `printread.js` chama a API da Anthropic, e só com o recurso ligado e a chave salva | `readImage` em `printread.js`; teste em `tests/parse-and-compliance.test.js` |
| Resposta da IA fora do formato (inclusive com campo de jogador) é recusada inteira | `validateReading` em `printread.js`; `tests/printread.test.js` |
| A chave da API não entra no export nem em log | `exportPayload` em `plan.js` (lista fechada); `tests/printread.test.js` |
| O service worker só intercepta a própria origem e os tiles do OSM | `sw.js` |
| Import guarda só id, nome, posição, nível, chaves e observação; descarta qualquer outro campo (ex.: facção) | `sanitizePortal` em `app.js:64` |
| Colar link **não abre** a URL: só extrai `lat,lng` por regex local | `parseCoords` em `geo.js` |
| Teste automatizado falha se qualquer arquivo de código citar domínio da Niantic | `tests/parse-and-compliance.test.js` |
| Teste automatizado falha se a CSP liberar outro host além do OSM (imagens) e da API da Anthropic (conexão) | `tests/parse-and-compliance.test.js` |

Rede usada:
- **Tiles do OpenStreetMap,** apenas os que você visualiza (cache conforme você navega, sem download em massa,
  respeitando a [política de uso de tiles do OSM](https://operations.osmfoundation.org/policies/tiles/)).
- **API da Anthropic,** só com "Nomear por print" ligado e só para as imagens que você escolher.

---

## Usar

```bash
npm start            # python3 -m http.server 8080
# abra http://localhost:8080
```

Geolocalização e service worker exigem **contexto seguro**: `localhost` funciona; no celular, sirva por
HTTPS (GitHub Pages, Netlify, etc. — são só arquivos estáticos). Depois do primeiro acesso, "Adicionar à
tela inicial" instala o app e ele abre sem internet (os tiles já visualizados ficam em cache).

> **Aviso — seus dados ficam só no `localStorage` deste navegador.** O app pede armazenamento persistente
> (`navigator.storage.persist`), mas o Safari/iOS pode apagar dados de sites não instalados após 7 dias
> sem uso. Instale o app na tela inicial e exporte o JSON regularmente (Ajustes → Exportar).

> **Atualização:** é automática. O app procura versão nova ao abrir, ao voltar para ele e a cada 30 min.
> Logo depois de abrir, se não houver modo em campo nem diálogo aberto, ele recarrega sozinho (o plano fica salvo). Com o
> app em uso, aparece o aviso "Nova versão disponível": toque para recarregar. A versão aparece no fim da
> aba Ajustes.

> **Listas grandes:** o cálculo considera no máximo 30 portais (os que têm chave e os mais próximos
> primeiro, `optimizer.js:15`); o plano mostra "N de M considerados". Coordenadas estimadas de prints têm
> erro de dezenas de metros: confira os portais do campo antes de sair. (Os próprios arquivos de exemplo declaram precisão de 10–30 m e de 20–80 m.)

### Simulação e lista de farm

- **Ajustes → Simular sem chaves** → calcula o melhor plano que a posição dos portais permite, ignorando
  as chaves que você tem. O plano mostra um aviso de simulação e a **Lista de farm**: quantas chaves
  faltam de cada portal, com o total (`app.js:354`).
- Na simulação, os candidatos são cortados só por distância. O plano de simulação é **fixado
  automaticamente** (ver Plano fixo). O **modo em campo** só libera quando você tiver todas as chaves da lista
  de farm, e então executa **o mesmo plano**, na mesma ordem e com os mesmos links, conferido com as chaves
  reais, sem recalcular.
- **Ajustes → Objetivo → Máx. área (≈ MU)** → a área decide o plano. A área é só um proxy do MU: o MU
  real depende da densidade populacional, que o app não conhece. Compare áreas apenas dentro da mesma
  região. Cada camada conta: campos empilhados somam a área de todos.
- **Nível de portal neutro:** informe o nível que o portal terá depois que você o capturar e montar, não o
  atual. Um agente sozinho pode colocar no máximo 1×R8, 1×R7, 2×R6, 2×R5 e 4×R4 (para completar 8: R8, R7,
  2×R6, 2×R5 e 2×R4), média 5,6: informe **L5**, que já alcança 100 km (160 m × 5⁴, `geo.js` `linkRange`).
  Com ajuda de outros agentes o portal sobe de nível. L1 alcança só 160 m.

### Cadastrar portais

- **Toque longo no mapa** → formulário já com a coordenada.
- **Portais → + Portal** → formulário (nome, lat, lng, nível 1–8, chaves, observação).
- **Portais → Colar link** → cole um link de mapa ou texto com coordenadas; reconhece `?ll=`, `?pll=`,
  `?q=`, `@lat,lng`, `!3d…!4d…`, `geo:`, `lat=…&lng=…` e pares soltos como `-23.55, -46.63`.
  Links sem coordenadas (ex.: só com identificador) não são resolvidos — digite lat/lng.
- **Portais → Importar lista de links** → cole ou abra um arquivo `.txt`, `.csv` ou `.json` (máx. 5 MB,
  até 2000 linhas) com **uma linha por portal**: um link do Google Maps ou coordenadas, com nome opcional
  em qualquer ordem. Exemplos de linha: `Masp; -23.5614, -46.6558` ou `https://www.google.com/maps/place/…`.
  Sem nome na linha, usa o nome do lugar de um link `/maps/place/…`; sem nenhum nome, o portal vira `Portal 01`, `Portal 02`… (próximo número livre). A prévia é editável, aceita
  nível e chaves padrão, e deixa desmarcadas, com aviso, as linhas que podem ser duplicata (a mesma regra
  dos outros cadastros): portal a menos de 10 m de outro (o mesmo), portal do app ou outra linha a menos de 30 m, nome igual
  ao de um portal do app ou ao de outra linha. `Portal NN` (automático ou digitado) não conta como nome
  repetido. Marcar de novo uma linha com aviso e importar pede confirmação; cancelar volta à prévia.
  Links nunca são abertos.
  **Links curtos** (`maps.app.goo.gl`) não têm coordenadas e são recusados: abra o link no navegador e
  copie o endereço completo, ou toque e segure no mapa do Google Maps e copie as coordenadas.
- **Ajustes → Importar/Exportar JSON** (formato abaixo).
  Aceita a chave `"portals"` ou `"portais"` e `lat`/`lng` ou `latitude`/`longitude`/`lon`. A chave de lista também pode ser `"pontos"`; portal sem nome vira `Portal NN`. Reimportar um
  arquivo sem `id` não duplica: portal a menos de 10 m de um existente é o mesmo e mantém chaves e nível.
- **Ajustes → Desfazer última importação** remove os portais adicionados na última importação (com bloqueadores e links feitos ligados a eles). Importações com mais de 300 pontos pedem confirmação antes.
- **Portais → 🔑 Chaves** → quantas chaves de cada portal você tem. Cada link *para* um portal gasta uma
  chave dele; portal com zero chaves (em vermelho) não recebe links.

Na lista de portais, os botões `−`/`+` ajustam chaves rapidamente.

### Nomear por print

Troca nomes provisórios (BK 001, CB 050, "Portal 07"…) pelos nomes reais a partir dos seus screenshots do
jogo, com confirmação um a um. Fica em **Ajustes → Nomear por print** e vem desligado.

1. **Ligar:** o app avisa que as imagens vão para a API da Anthropic. Cole a sua chave da API (`sk-ant-…`).
   Ela fica só neste aparelho; **Apagar chave** a remove. Sem chave, o recurso fica desabilitado. O modelo é
   configurável; o padrão é `claude-sonnet-5-5`. Cada imagem é uma chamada cobrada na sua conta Anthropic.
2. **Lista de chaves (modo principal):**
   - Parado no lugar, tire o print do inventário de chaves no Ingress e **compartilhe direto com o Field
     Planner** (Android, app instalado), ou toque em **📷 Escolher prints**.
   - O app grava a posição do GPS e a precisão no momento em que a imagem chega. Com precisão acima de 25 m,
     ele avisa e pede confirmação. Sem GPS, digite a posição.
   - Cada linha lida vira uma observação: nome, endereço, distância, nível, chaves e a origem. A mesma imagem
     reenviada é ignorada, e a mesma linha vinda de outro print não conta duas vezes.
   - **Primeiro o nome:** se o nome do print bate (≥ 85%) com um portal já cadastrado, e esse portal está dentro do
     anel ampliado, ele aparece em **✓ Já cadastrados**. Ali dá para atualizar chaves e nível, e ajustar posição
     com 3 ou mais observações; o app nunca renomeia. A comparação ignora acentos, pontuação, o sufixo de rua
     depois de " - ", artigos e preposições, e aceita palavras quase iguais.
   - A observação vira um anel em volta da origem: ±(12 m + precisão do GPS + incerteza do portal). A
     incerteza é de 20 m para portal estimado ou nunca confirmado e de 5 m para portal confirmado. A partir de
     1 km, mais 60 m, e esse anel nunca decide sozinho.
   - Só portais com nome provisório (BK, CB, BW, GJ, ENS, Portal NN, Enseada NN) recebem nome novo.
   - **1 observação:** um único portal provisório no anel vira sugestão abaixo de 50%. A rua do endereço ajuda
     a desempatar.
   - **Observações de pontos diferentes** (a 30 m ou mais um do outro): os anéis se cruzam e os candidatos
     diminuem.
   - **3 ou mais, bem espalhadas:** trilateração. Com resíduo e erro esperado baixos, aparece também "ajustar
     posição para a estimada (desloca X m)".
   - Dois nomes nunca ficam com o mesmo portal: a atribuição é global.
   - **Rua do print:** se nenhum candidato do anel fica na rua do endereço lido, e todos dizem a sua rua no nome
     ("BK 070 - R. Arizona") ou na observação, o nome aparece como **provavelmente não cadastrado**, sem "É este".
     O botão **📎 Cadastrar pelo link** abre "Colar link" com o nome já preenchido. Se você sabe que é um dos
     portais do anel (o sufixo de rua do provisório é só a rua mais próxima), use **É este mesmo assim**.
     Endereço que não começa por rua ("Shopping …") não descarta candidatos. Cadastrar um portal a menos de
     30 m de outro pede confirmação.
   - **Pendentes:** nomes com mais de um candidato. Você toca em **É este** no certo (o app nunca escolhe num
     empate), ou tira outro print a uns 100 m dali.
   - **Nome cortado:** a IA pula portal com nome cortado pela tela. Se mesmo assim um pedaço vier ("Ninhos D") e
     a linha inteira aparecer em outro print tirado do mesmo ponto, com a mesma distância (abaixo de 1 km), o
     pedaço vira o nome inteiro.
   - **Chaves sem portal no app:** todo nome lido que não tem portal com esse nome no app, nem provisório
     candidato no anel, vira um **portal potencial** nesta seção (inclui as chaves de outras cidades, que antes
     ficavam em "Longe daqui"). Cada nome aparece uma vez só: ou aqui ou em Pendentes.
     - **Posição estimada:** com 3 ou mais prints tirados de 3 ou mais pontos espalhados (para chaves a km
       de distância, pontos a uns 2 km um do outro), o app trilatera. Acima de 1 km a distância do jogo é
       arredondada; o "erro ~X m" mostrado é 1,5× o erro esperado pela geometria mais 3× o resíduo e, em
       simulação com leituras certas, cobriu 99% dos casos. Só aparece com erro até 150 m.
       Com 4 ou mais pontos o app confere: tirar qualquer print não pode mover a estimativa além do erro
       mostrado, senão não estima. **Com só 3 pontos não há conferência:** um print lido errado (100 m ou
       mais) ainda passa em 3% a 20% dos casos, com a posição errada, e o app marca "sem conferência". **➕ Cadastrar aqui** cria o portal na posição
       estimada, com chaves e nível do print e a observação "posição estimada por N prints, erro ~X m;
       conferir no Intel". **Ver no mapa** mostra os anéis e o círculo do erro. A caixa de seleção e
       **Cadastrar selecionados** cadastram vários de uma vez (um desfazer só).
     - **Falta posição:** mostra quantas observações e de quantos pontos, e quantos pontos faltam.
       **📎 Cadastrar pelo link** abre "Colar link" com nome, chaves e nível do print. **📍 Marcar no mapa**
       desenha os anéis (linha cheia: a distância; tracejadas: a tolerância); o próximo toque longo dentro
       de um anel abre o formulário já com nome, chaves e nível. Fora de todos os anéis, o app pede
       confirmação.
     - **Nunca duplicar:**
       - Nome igual a um portal do app (mesmo em outro lugar, mesmo com a posição errada) não entra na seção.
         Pedaço do nome de um portal cadastrado também não. Nome que é começo de outro da lista é marcado
         como provavelmente cortado, sem botão de cadastro.
       - Portal do app cujo nome é começo do lido ("Igreja Nossa Senhora" × "Igreja Nossa Senhora da
         Conceição"): aviso, fora do lote. Duas grafias do mesmo nome no lote bloqueiam o lote.
       - Portal do app dentro do erro da estimativa (mais a incerteza da posição dele; mínimo 30 m): o nome fica fora do lote, aparece o aviso
         e, para provisórios, **É este** (renomeia o provisório em vez de criar outro). Cadastrar mesmo assim
         pede confirmação.
       - Em qualquer cadastro novo, pelo formulário inclusive: nome igual a um portal existente pede
         confirmação ("Nome repetido"), e outro portal a menos de 30 m também ("Portal perto").
     - Todo cadastro novo entra no **↶ Desfazer**, que remove o portal (o aviso diz quantos). Importar o JSON de
       outro aparelho não duplica portal no mesmo lugar e com o mesmo nome.
3. **Print de mapa:**
   - A IA marca a posição de cada nome na imagem.
   - O app acha escala e deslocamento entre o print e os portais cadastrados (rotação só se o mapa estiver
     girado) e casa um-para-um, até 40 m.
   - Com menos de 3 pontos casados, não sugere nada.
   - Numa grade regular de ruas, se outro alinhamento casar quase tão bem, o print fica marcado como ambíguo e
     nenhuma sugestão passa do limite de auto-aceite.
4. **Revisão:**
   - A lista mostra cada sugestão, ordenada por confiança: nome atual → nome sugerido, distância do ajuste e
     miniatura do print com o ponto marcado.
   - **✅ Aceitar**, **✏️ Corrigir** (outro nome ou outro portal) ou **⏭️ Pular**. Se o nome já é de outro
     portal, o Aceitar fica bloqueado e aparece **É este**: dois portais nunca ficam com o mesmo nome. Se forem
     de fato dois portais com o mesmo nome no jogo (o segundo "Graffiti" do bairro), renomeie o segundo pelo
     diálogo do portal (toque no nome, na aba Portais).
   - "Aceitar todos acima de X%" (no mínimo 80%) renomeia só o nome e deixa de fora as sugestões em
     conflito, que são o mesmo portal com dois nomes ou o mesmo nome em dois portais. Essas ficam marcadas
     para decidir uma a uma.
   - Dois nomes que só cabem no mesmo portal vão os dois para Pendentes, com aviso de conflito: nenhum ganha
     sozinho.
   - Chaves, nível e posição só mudam se você marcar. Mover pede confirmação.
   - **↶ Desfazer** volta nomes, chaves, nível e posição, e remove portais cadastrados depois. Cadastrar, editar,
     mover, tocar em 🔑 + / − e importar também
     entram no desfazer, então ele volta exatamente a última ação.
   - Renomear não recalcula o plano. Mover mais de 30 m aparece no aviso de plano desatualizado.
5. **Privacidade:**
   - As imagens ficam só em memória, nesta tela. **Limpar imagens desta tela** descarta tudo.
   - Um print compartilhado passa alguns instantes num cache do service worker e é apagado quando o app o lê.
   - As observações ficam neste aparelho (**Esquecer observações** apaga). Elas só entram no export JSON se
     você confirmar na hora de exportar ("Incluir observações?"), porque guardam a posição, a data e a hora de
     cada print. Importar esse arquivo no outro aparelho também pergunta antes (importe só se forem suas:
     observações de outro jogador não podem ser guardadas) e junta as leituras dos dois, sem repetir; a
     trilateração passa a usar todas. A chave da API e as imagens nunca entram no export.
   - **Apagar todos os dados** apaga também a chave da API, as preferências, as observações (com as posições
     de onde você tirou cada print) e o cache de compartilhados.

### Planejar e executar

1. **Plano**: ajuste raio a pé (padrão 1500 m), links de saída por portal (padrão 8), objetivo e estratégia;
   toque em **Calcular plano**. Saem: passos ordenados ("Vá até P, faça link P→Q, P→R"), campos, AP,
   distância total, chaves consumidas por portal e chaves faltantes.
   - **Ler o plano no mapa:** a linha amarela tracejada é a rota a pé, A → 1 → 2…, onde **A** é a posição
     usada no cálculo (`app.js:263-270`). Os links são linhas tracejadas verde-água com o número do link
     perto da origem. Os portais do plano mostram o rótulo "nome · 🔑N" (N = chaves cadastradas). Os campos
     aparecem sombreados com contorno, e a sobreposição de campos escurece a área. O botão **🗺 Ver plano no
     mapa** recolhe o painel e enquadra o plano (`app.js:275`).
   - **Tempo estimado:** o painel mostra 🚶 a pé, 🚗 carro e 🚌 transporte. É uma estimativa, **não uma rota
     real**: o app não consulta serviços de rotas. Cada trecho é a distância em linha reta × desvio das ruas
     (`geo.js:240-250`, `TRAVEL`):
     - a pé: 4,5 km/h, desvio 1,3;
     - carro: 20 km/h, desvio 1,4, +3 min por parada para estacionar; trecho < 400 m vai a pé;
     - transporte: 15 km/h, desvio 1,4, +10 min de espera por trecho; trecho < 1 km vai a pé;
     - nos três: +1 min por link e +1 min por parada.
   - **Rota no Google Maps:** abaixo de "Ver plano no mapa", escolha o modo (a pé, carro ou bicicleta;
     transporte público não aceita paradas intermediárias no Google Maps) e toque no link para abrir as paradas na ordem do plano no Google Maps. A rota parte da sua
     posição atual. O Google Maps aceita até 10 paradas por rota, então planos maiores viram trechos
     encadeados (cada um começa onde o anterior terminou) (`geo.js`, `mapsRouteUrls`). Abra no app Google Maps:
     no navegador do celular o Google pode aceitar só 3 paradas intermediárias. O app só monta o
     endereço; nada é enviado ao Google até você abrir o link.
   - **📄 Exportar plano em PDF:** abre a janela de impressão do navegador com um relatório: resumo, croqui
     do plano (rota, links numerados e campos, sem mapa de fundo), links da rota no Google Maps, passos com
     coordenadas, chaves consumidas e lista de farm. Escolha **Salvar como PDF**. Tudo é gerado no aparelho.
   - **Plano fixo (📌 Fixar plano):** todo plano fica salvo no aparelho e volta igual ao reabrir o app,
     sem recalcular. Com o plano **fixado**, nada recalcula sozinho (nem GPS, nem tempo, nem edição de
     portais, chaves ou bloqueadores, nem troca de simulação). Só o **⟳ Recalcular** substitui o plano, e ele
     pede confirmação. Plano de simulação é fixado automaticamente. Toque de novo no botão para soltar.
   - **Chaves ao vivo:** "tem", chaves consumidas, lista de farm e o total de faltantes usam as chaves
     cadastradas agora. Tocar em 🔑 + / − atualiza o plano na hora (`plan.js`, `keyNeeds`).
   - **Aviso de plano desatualizado:** sem recalcular, o app refaz os links restantes sobre os dados atuais
     e lista os passos afetados quando um portal do plano foi excluído ou movido mais de 30 m, quando um link
     cruza um bloqueador ou não é mais possível, ou quando fecha menos campos (`plan.js`, `validate`).
   - **Exportar/importar:** o JSON exportado leva o plano (chave `plan`). Ao importar um arquivo com plano,
     o app pergunta se deve restaurá-lo.
2. **Modo em campo**: o passo atual em destaque, distância e rumo até o portal, e dois botões grandes:
   - **✓ Concluído** — registra o link como feito, desconta 1 chave do destino, recalcula.
   - **✕ Falhou** — pergunta o motivo: *bloqueado por outro link* (você cadastra o bloqueador),
     *sem chave* (zera as chaves do destino), *portal sob campo* (o portal deixa de gerar links) ou
     *outro* (o par é pulado). Depois recalcula.
   - **↶ Desfazer** e **⟳ Recalcular**.

Recálculo automático (só com o plano **solto**): ao se mover **> 100 m** desde o último cálculo, a cada
**5 min** no modo em campo, e a cada passo concluído ou falho. Com o plano fixado, Concluído e Falhou só
avançam para o próximo link do mesmo plano, e o progresso fica salvo.

---

## Como o otimizador funciona

Roda num **Web Worker** (`worker.js` → `optimizer.js`), com orçamento de ~1,5 s.

**Restrições** checadas para cada link `s → t` (`State.whyNot`):

- não cruza nenhum link existente (bloqueador inimigo/aliado, link já feito) nem planejado;
- `s` não está sob campo (campos planejados, e triângulos fechados por bloqueadores da mesma origem);
- `t` precisa de chave disponível (1 chave por link);
- limite de links de saída de `s`;
- distância ≤ alcance pelo nível: `160 m × nível⁴` (sem mods);
- sem link duplicado e sem par marcado como falho.

**Campos**: ao fechar triângulos, cria no máximo um campo de cada lado do link — o de maior área.
AP: 313 por link, 1250 por campo (captura e deploy não entram).

**Estratégias** (em "Automática" roda as três e fica com a melhor):

- **Fanfield** — cada portal é testado como âncora; os demais são ordenados por ângulo em torno dela
  (começando após o maior vão) nos dois sentidos; em cada portal: link para a âncora e depois para os
  anteriores, do mais recente ao mais antigo.
- **Triangulação gulosa** — ordem de visita semente por vizinho-mais-próximo + 2-opt; em cada portal,
  escolhe repetidamente o link válido que mais fecha campos. Para ≤ 7 portais testa **todas** as ordens;
  de 8 a 12 faz busca local (trocas/reinserções) até o prazo; acima de 12 usa só a semente.
- **Multicamada** — escolhe uma base A–B e, de cada lado, a maior cadeia de portais centrais encaixados
  (C1 ⊃ … ⊃ Cn, por programação dinâmica; no objetivo de área o peso é a área). Executa do miolo para
  fora: A→B, depois Cn→A/B, …, C1→A/B. Cada camada empilha um campo sobre o anterior.

**Orçamento do automático**: 1/3 do tempo para o fanfield, 1/3 para a multicamada e o resto para a
triangulação (`optimizer.js:461-462`). Cada cálculo considera no máximo 30 candidatos (`optimizer.js:15`).

**Objetivos**: *Máx. campos* (empate → menos caminhada), *Máx. AP*, *Mín. distância* (maximiza AP por
metro caminhado — minimizar distância pura daria "não andar") e *Máx. área (≈ MU)* (a área decide; a
caminhada só desempata).

**Geometria**: a projeção é gnomônica, centrada na referência, e transforma geodésicas em retas
(`geo.js:36-50`). Os testes de cruzamento e de "sob campo" valem em escala de dezenas ou centenas de km.
O alcance e a distância mínima entre portais usam haversine. O raio a pé vai até 100 km
(`app.js:378`).

**Rota a pé**: distância haversine; a ordem dos passos é a da melhor simulação (em fielding a ordem
importa, então a rota não é reordenada depois).

**Chaves faltantes**: a mesma ordem é simulada sem limite de chaves; a diferença por portal é reportada,
junto com quantos campos a mais isso renderia.

### Limitações conhecidas

- Portais a mais de ~80° (≈ 8900 km) da referência ficam fora da conta; para links dentro de uma região
  normal isso não importa.
- Campos inimigos são inferidos a partir de triângulos de bloqueadores cadastrados; um triângulo de links
  sem campo real seria tratado como campo.
- Alcance não considera Link Amps nem outros mods.
- A seta do modo em campo é relativa ao norte quando o GPS não fornece direção de movimento.
- Cada cálculo considera no máximo 30 portais (com chave e mais próximos primeiro); com mais portais no
  raio, um portal útil mais distante e sem chave pode ficar de fora. O plano informa "N de M considerados".
- Cada recálculo de um plano solto pode trocar de estratégia ou de âncora no meio de um fanfield. Fixe o
  plano para evitar isso.
- Num plano fixado, pular um link (Falhou) não refaz os seguintes: se ele fechava um campo usado depois, o
  aviso de plano desatualizado mostra os passos afetados.
- Os tiles em cache não expiram (máximo de 3000, `sw.js:11`).
- Nomear por print:
  - A lista de chaves só casa um portal cuja posição cadastrada esteja dentro do anel, ±(12 m + precisão).
    Portais com posição estimada errada em mais que isso ficam pendentes ou sem candidato: corrija a posição,
    ou use o print de mapa.
  - A comparação de nomes ignora palavras de uma letra: "Bloco A" e "Bloco B" contam como o mesmo nome. Nesse
    caso o app bloqueia o segundo, e você renomeia à mão.
  - O print de mapa depende de a IA marcar bem os pontos. Numa grade regular de ruas ele pode sair ambíguo.
  - Receber por compartilhamento só funciona no Android, com o app instalado (Web Share Target). No iPhone,
    use **Escolher prints**.
  - A posição gravada é a do momento em que o print chega ao app, não a do momento em que foi tirado.
    Mande o print parado no mesmo lugar.
- Os fluxos de `app.js` e `sw.js` não têm teste automatizado. As regras do plano fixo estão em `plan.js`
  e têm teste (`tests/plan.test.js`).

---

## Formato JSON

```json
{
  "app": "field-planner",
  "version": 1,
  "portals": [
    { "id": "p1", "nome": "Praça", "lat": -23.5505, "lng": -46.6333, "nivel": 6, "chaves": 3, "observacao": "" }
  ],
  "blockers": [ { "id": "b1", "portalA": "p1", "portalB": "p2", "origem": "inimigo" } ],
  "done": [ { "from": "p1", "to": "p2", "ts": 1763050000000 } ],
  "excluded": [],
  "coveredManual": [],
  "settings": { "radius": 1500, "maxOut": 8, "objective": "campos", "strategy": "auto" },
  "plan": {
    "v": 1, "ts": 1763300000000, "appVersion": "1.8.0", "pinned": true,
    "origin": { "lat": -23.55, "lng": -46.63 },
    "settings": { "radius": 1500, "maxOut": 8, "objective": "campos", "strategy": "auto", "simulate": true },
    "candidates": ["p1", "p2"],
    "positions": { "p1": [-23.5505, -46.6333] },
    "result": { "steps": [], "links": [], "fields": [], "simulation": true }
  }
}
```

`plan` é opcional: o resultado completo do otimizador (`result`) e as entradas do cálculo. `positions` são
as posições dos portais do plano no momento do cálculo, usadas para avisar quando um portal foi movido.

Também aceita um array simples de portais. Importação mescla por `id` (mesmo id → atualiza).
Valores são validados e limitados (nível 1–8, chaves 0–999, textos com tamanho máximo).

---

## Testes

```bash
npm test     # node --test, sem dependências
```

| Arquivo | Cobre |
| :- | :- |
| `tests/intersection.test.js` | teste de interseção de links (inclui geodésicas de dezenas de km): X, paralelos, portal compartilhado, T, colineares, quase-cruzamento, simetria, versão lat/lng |
| `tests/under-field.test.js` | regra "portal sob campo": interior/exterior/vértice/aresta/degenerado; no otimizador com campo aliado, inimigo e planejado; replay de um plano completo |
| `tests/simulation.test.js` | simulação sem chaves e lista de farm, área do campo, objetivo MU, corte de candidatos por distância |
| `tests/multilayer.test.js` | multicamada: uma camada por portal central encaixado, ordem do miolo para fora, sobreposição, base A–B, objetivo MU |
| `tests/travel.test.js` | tempo estimado a pé, de carro e de transporte: trechos curtos a pé, trecho longo, sem trechos |
| `tests/maps-route.test.js` | links do Google Maps: sem origem no 1º trecho, trechos de até 9 intermediárias + destino encadeados, modo de viagem, pontos inválidos |
| `tests/optimizer.test.js` | fanfield, links não se cruzam, bloqueador, chaves, limite de saída, alcance por nível, raio, pares falhos, 2-opt |
| `tests/parse-and-compliance.test.js` | extração de coordenadas; ausência de domínios da Niantic no código; CSP; `VERSION` igual em `app.js`, `sw.js` e `package.json` |
| `tests/bulk-import.test.js` | importação em lote: leitura de linhas (link, coordenadas, nome), prioridade `!3d`/`pll=` em `parseCoords`, links curtos recusados |
| `tests/plan.test.js` | plano fixo: registro salvo e restaurado igual (JSON), registro adulterado descartado, plano fixado não recalcula por GPS/5 min/dados/simulação, farm e "tem" acompanham as chaves de agora, validação de portal movido (> 30 m), excluído e link cruzando bloqueador, simulação → campo só com todas as chaves |
| `tests/matching.test.js` | casamento: húngaro, nomes e ruas, mapa com escala conhecida e desconhecida + ruído de 15 m + ponto espúrio, mapa girado, portais a 8 m (confiança baixa), grade regular (ambíguo), anéis, empate resolvido por 2ª observação, rua desempata, nomes sem disputar o mesmo portal, ≥ 1 km nunca decide, trilateração com ruído de 10 m e com origens mal espalhadas |
| `tests/keylist-scenario.test.js` | lista de chaves, cenário sintético com a estrutura do teste real: já cadastrados reconhecidos sem renomear (acento, artigo, erro de digitação, sufixo de rua, ≥ 1 km), empate com o candidato certo, nomes sem portal abaixo de 50%, linha repetida, nenhum nome repetido, "Mural 1"/"Mural 2" separados |
| `tests/real-16112026.test.js` | caso real de 16/11 (4 prints contra o arquivo do Brooklin). Roda só com as fixtures em `tests/fixtures-local/`, que ficam fora do git por terem a posição de onde os prints foram tirados; sem elas, é pulado |
| `tests/printread.test.js` | leitura da IA: resposta válida, JSON inválido ou fora do formato recusado (inclusive campo de jogador), pedido com cabeçalho de navegador e json_schema, erros 401/429/5xx/rede, chave fora de mensagens, logs e export, recurso desligado por padrão |
| `tests/review-fixes.test.js` | ids `__proto__`/`constructor`/`toString` em portais, bloqueadores, done e excluded; portais na mesma posição nunca linkados; portal visitado sem links vira destino do fan |

## Publicar uma versão nova

O service worker serve o app de um cache por `VERSION`: publicar código sem trocar a versão não chega aos
usuários.

1. Suba a versão em `app.js` (`var VERSION = '…'`), `sw.js` (`var VERSION = 'fp-v…'`) e `package.json`.
2. Rode `npm test` (falha se as três versões divergirem).
3. O `git push` é feito pelo dono do repositório.

## Estrutura

```
index.html            UI, estilos e CSP
app.js                estado, mapa, painéis, modo em campo, GPS (somente leitura)
geo.js                geometria pura: haversine, interseção, ponto-no-triângulo, alcance, parse de coordenadas
optimizer.js          otimizador puro (fanfield, triangulação, rota, chaves)
plan.js               plano fixo: registro salvo, chaves ao vivo, validação contra os dados atuais; conteúdo do export
matching.js           casamento de nomes lidos de prints com os portais (RANSAC, húngaro, anéis, trilateração), sem rede
printread.js          leitura de prints pela API da Anthropic: pedido, validação da resposta, erros, chave e preferências
worker.js             Web Worker que roda o otimizador
sw.js                 service worker offline-first
manifest.webmanifest  manifesto PWA (+ icon.svg, icon-192.png, icon-512.png)
vendor/leaflet/       Leaflet 1.9.4 local (BSD-2-Clause, ver LICENSE)
tests/                testes node:test
```
