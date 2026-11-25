# ADR-0005 — Print do Intel processado localmente

- **Status:** aceito pelo dono (pedido de 25/11/2026), v1.13.0.
- **Contexto:** cadastrar portais, links bloqueadores e campos à mão, a partir do que se vê no Intel, é lento
  e sujeito a erro. A política de conformidade (README) já aceita coordenadas que o usuário estima a partir de
  prints de mapa (regra 5) e screenshots escolhidos por ele (regras 2 e 7).

## Decisão

Ler, **no próprio aparelho**, um print do Intel que o usuário tirou e escolheu, em **Ajustes → Importar
print do Intel**:

1. Processamento 100% local por canvas (`intelprint.js`, funções puras sobre os pixels). Sem IA, sem rede,
   **sem nenhuma requisição a domínios da Niantic**. O app nunca captura a tela nem abre o Intel.
2. A leitura é só de **cor e geometria**: portais (neutro/verde/azul/Machina), links e campos. Nenhum texto
   do print é lido; nomes de agentes, donos e COMM não são extraídos nem guardados (regra 4).
3. A georreferência depende de 1 a 3 portais que o usuário identifica; com resíduo acima de 30 m nada é
   gravado. Tudo passa por uma prévia, e ↶ Desfazer volta a importação inteira.
4. A imagem fica só na memória da tela e é descartada ao fechar.
5. O portal passa a guardar a **facção** (`faccao`: só a cor). A regra 4 deixa de descartar esse campo; dono e
   qualquer dado de jogador continuam fora.
6. Bloqueadores vindos de print guardam a data do print e mostram a idade; o usuário apaga os antigos (padrão:
   mais de 3 dias), porque o terreno muda.

## Consequências

- Garantido em teste: `intelprint.js` não contém `fetch`, XHR, WebSocket nem URL; nenhum arquivo cita domínio da
  Niantic; a CSP continua a mesma (nenhum host novo).
- As cores e os limites são os do mapa escuro do Intel e podem mudar; o teste com os prints reais
  (`tests/intel-real-25112026.test.js`, só no computador do dono) é o alarme para isso.
- Posições estimadas por print carregam a incerteza de portal estimado (observação "ESTIMADO pelo print …").
