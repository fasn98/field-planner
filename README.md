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
5. **Todos os dados de portais são digitados pelo usuário** e ficam apenas no aparelho
   (`localStorage`). Nada é enviado a servidor algum.

### Como isso é garantido no código

| Garantia | Onde |
| :- | :- |
| A página só pode buscar recursos de si mesma e imagens de `tile.openstreetmap.org` | CSP em `index.html` (`default-src 'self'`, `connect-src 'self'`) |
| O service worker só intercepta a própria origem e os tiles do OSM | `sw.js` |
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

### Cadastrar portais

- **Toque longo no mapa** → formulário já com a coordenada.
- **Portais → + Portal** → formulário (nome, lat, lng, nível 1–8, chaves, observação).
- **Portais → Colar link** → cole um link de mapa ou texto com coordenadas; reconhece `?ll=`, `?pll=`,
  `?q=`, `@lat,lng`, `!3d…!4d…`, `geo:`, `lat=…&lng=…` e pares soltos como `-23.55, -46.63`.
  Links sem coordenadas (ex.: só com identificador) não são resolvidos — digite lat/lng.
- **Ajustes → Importar/Exportar JSON** (formato abaixo).

Na lista de portais, os botões `−`/`+` ajustam chaves rapidamente.

### Planejar e executar

1. **Plano**: ajuste raio a pé (padrão 1500 m), links de saída por portal (padrão 8), objetivo e estratégia;
   toque em **Calcular plano**. Saem: passos ordenados ("Vá até P, faça link P→Q, P→R"), campos, AP,
   distância total, chaves consumidas por portal e chaves faltantes.
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

**Estratégias** (em "Automática" roda as duas e fica com a melhor):

- **Fanfield** — cada portal é testado como âncora; os demais são ordenados por ângulo em torno dela
  (começando após o maior vão) nos dois sentidos; em cada portal: link para a âncora e depois para os
  anteriores, do mais recente ao mais antigo.
- **Triangulação gulosa** — ordem de visita semente por vizinho-mais-próximo + 2-opt; em cada portal,
  escolhe repetidamente o link válido que mais fecha campos. Para ≤ 7 portais testa **todas** as ordens;
  de 8 a 12 faz busca local (trocas/reinserções) até o prazo; acima de 12 usa só a semente.

**Objetivos**: *Máx. campos* (empate → menos caminhada), *Máx. AP*, *Mín. distância* (maximiza AP por
metro caminhado — minimizar distância pura daria "não andar").

**Rota a pé**: distância haversine; a ordem dos passos é a da melhor simulação (em fielding a ordem
importa, então a rota não é reordenada depois).

**Chaves faltantes**: a mesma ordem é simulada sem limite de chaves; a diferença por portal é reportada,
junto com quantos campos a mais isso renderia.

### Limitações conhecidas

- Geodésicas aproximadas por retas numa projeção local — ótimo para áreas a pé (poucos km), não para
  campos de centenas de km.
- Campos inimigos são inferidos a partir de triângulos de bloqueadores cadastrados; um triângulo de links
  sem campo real seria tratado como campo.
- Alcance não considera Link Amps nem outros mods.
- A seta do modo em campo é relativa ao norte quando o GPS não fornece direção de movimento.

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
| `tests/intersection.test.js` | teste de interseção de links: X, paralelos, portal compartilhado, T, colineares, quase-cruzamento, simetria, versão lat/lng |
| `tests/under-field.test.js` | regra "portal sob campo": interior/exterior/vértice/aresta/degenerado; no otimizador com campo aliado, inimigo e planejado; replay de um plano completo |
| `tests/optimizer.test.js` | fanfield, links não se cruzam, bloqueador, chaves, limite de saída, alcance por nível, raio, pares falhos, 2-opt |
| `tests/parse-and-compliance.test.js` | extração de coordenadas; ausência de domínios da Niantic no código; CSP |

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
