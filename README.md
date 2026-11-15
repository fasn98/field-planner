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
   notificações, arquivos nem tráfego do jogo.
3. **GPS somente leitura** via `navigator.geolocation.watchPosition`. O app nunca altera, simula ou
   falsifica posição. Sem GPS, ele planeja a partir do centro dos portais cadastrados — e diz isso na tela.
4. **Nenhum dado de outros jogadores é armazenado.** Links bloqueadores guardam só os dois portais e a
   origem (`inimigo`/`aliado`) — nunca nome de agente. O campo de observação avisa para não registrar nomes.
   Campos extras de arquivos importados, como cor ou facção, são descartados: só posição, nome, nível,
   chaves e observação são guardados (`sanitizePortal`, `app.js:64`).
5. **Os portais entram por ação manual do usuário**: digitados, link colado, ou arquivo JSON/texto que ele
   mesmo prepara e importa. Isso inclui coordenadas que ele estima a partir de prints de mapa. O app nunca
   captura tela, não lê nem baixa nada de serviços do jogo e não automatiza a coleta: só lê o arquivo que o
   usuário escolhe. Os dados ficam apenas no aparelho (`localStorage`) e nada é enviado a servidor algum.
6. **O plano não substitui o jogo.** O app só planeja; toda ação acontece no jogo, a pé. Sem a chave do
   portal (obtida em campo), não há link; sem link, não há campo; sem campo, não há MU. Todo link do plano
   usa só chaves que o usuário informou ter (`optimizer.js:137`). Nenhuma forma automatizada de agir no
   jogo ou de contornar suas regras faz parte do escopo.

### Como isso é garantido no código

| Garantia | Onde |
| :- | :- |
| A página só pode buscar recursos de si mesma e imagens de `tile.openstreetmap.org` | CSP em `index.html` (`default-src 'self'`, `connect-src 'self'`) |
| O service worker só intercepta a própria origem e os tiles do OSM | `sw.js` |
| Import guarda só id, nome, posição, nível, chaves e observação; descarta qualquer outro campo (ex.: facção) | `sanitizePortal` em `app.js:64` |
| Colar link **não abre** a URL: só extrai `lat,lng` por regex local | `parseCoords` em `geo.js` |
| Teste automatizado falha se qualquer arquivo de código citar domínio da Niantic | `tests/parse-and-compliance.test.js` |
| Teste automatizado falha se a CSP liberar outro host além do OSM | `tests/parse-and-compliance.test.js` |

Única rede usada: **tiles do OpenStreetMap**, apenas os que você visualiza (cache conforme você navega,
sem download em massa, respeitando a [política de uso de tiles do OSM](https://operations.osmfoundation.org/policies/tiles/)).

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
> Logo depois de abrir, se não houver modo em campo, plano nem diálogo aberto, ele recarrega sozinho. Com o
> app em uso, aparece o aviso "Nova versão disponível": toque para recarregar. A versão aparece no fim da
> aba Ajustes.

> **Listas grandes:** o cálculo considera no máximo 30 portais (os que têm chave e os mais próximos
> primeiro, `optimizer.js:15`); o plano mostra "N de M considerados". Coordenadas estimadas de prints têm
> erro de dezenas de metros: confira os portais do campo antes de sair. (Os próprios arquivos de exemplo declaram precisão de 10–30 m e de 20–80 m.)

### Simulação e lista de farm

- **Ajustes → Simular sem chaves** → calcula o melhor plano que a posição dos portais permite, ignorando
  as chaves que você tem. O plano mostra um aviso de simulação e a **Lista de farm**: quantas chaves
  faltam de cada portal, com o total (`app.js:354`).
- Na simulação, os candidatos são cortados só por distância. O **modo em campo fica desabilitado**
  (`app.js:400`): desligue a simulação para sair a campo.
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
  nível e chaves padrão, e deixa desmarcados os portais a menos de 10 m de outro. Links nunca são abertos.
  **Links curtos** (`maps.app.goo.gl`) não têm coordenadas e são recusados: abra o link no navegador e
  copie o endereço completo, ou toque e segure no mapa do Google Maps e copie as coordenadas.
- **Ajustes → Importar/Exportar JSON** (formato abaixo).
  Aceita a chave `"portals"` ou `"portais"` e `lat`/`lng` ou `latitude`/`longitude`/`lon`. A chave de lista também pode ser `"pontos"`; portal sem nome vira `Portal NN`. Reimportar um
  arquivo sem `id` não duplica: portal a menos de 10 m de um existente é o mesmo e mantém chaves e nível.
- **Ajustes → Desfazer última importação** remove os portais adicionados na última importação (com bloqueadores e links feitos ligados a eles). Importações com mais de 300 pontos pedem confirmação antes.
- **Portais → 🔑 Chaves** → quantas chaves de cada portal você tem. Cada link *para* um portal gasta uma
  chave dele; portal com zero chaves (em vermelho) não recebe links.

Na lista de portais, os botões `−`/`+` ajustam chaves rapidamente.

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
2. **Modo em campo**: o passo atual em destaque, distância e rumo até o portal, e dois botões grandes:
   - **✓ Concluído** — registra o link como feito, desconta 1 chave do destino, recalcula.
   - **✕ Falhou** — pergunta o motivo: *bloqueado por outro link* (você cadastra o bloqueador),
     *sem chave* (zera as chaves do destino), *portal sob campo* (o portal deixa de gerar links) ou
     *outro* (o par é pulado). Depois recalcula.
   - **↶ Desfazer** e **⟳ Recalcular**.

Recálculo automático: ao se mover **> 100 m** desde o último cálculo, a cada **5 min** no modo em campo,
e a cada passo concluído/falho.

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
- Cada recálculo pode trocar de estratégia ou de âncora no meio de um fanfield.
- Os tiles em cache não expiram (máximo de 3000, `sw.js:11`).
- Os fluxos de `app.js` e `sw.js` não têm teste automatizado.

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
  "settings": { "radius": 1500, "maxOut": 8, "objective": "campos", "strategy": "auto" }
}
```

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
worker.js             Web Worker que roda o otimizador
sw.js                 service worker offline-first
manifest.webmanifest  manifesto PWA (+ icon.svg, icon-192.png, icon-512.png)
vendor/leaflet/       Leaflet 1.9.4 local (BSD-2-Clause, ver LICENSE)
tests/                testes node:test
```
