# Handoff: claude → reviewer — importação em lote (v1.2.0)

## Entregue
- `geo.js`: `parseBulkLine` e `parseBulk`, novas funções. Em `parseCoords`, o padrão `!3d…!4d…` (pino do lugar) passou a ter prioridade sobre `@` (centro da tela).
- `index.html`: botão "Importar lista de links" na aba Portais, diálogo `#bulkDlg` e estilos `.bulk-row`.
- `app.js`:
  - o import de JSON foi extraído para `importJsonText`, reusado quando o arquivo do lote é JSON;
  - bloco "Importação em lote": `parseBulkText`, `renderBulk`, `nextPortalNumber`, `updateBulkSave` e o handler de close;
  - duplicatas: portal a menos de 10 m de um cadastrado ou de outra linha vem desmarcado;
  - nome opcional: sem nome, vira "Portal NN", com o próximo número livre;
  - Enter num campo de nome não submete o formulário.
- `tests/bulk-import.test.js`: 9 testes. `npm test` 55/55.
- VERSION 1.2.0 em `app.js`, `sw.js` e `package.json`.

Verificado no Chrome headless com 6 linhas (link /place/ com !3d, ?q=, coordenadas soltas, nome + link @, link curto e uma duplicata):
- 3 novos, 2 duplicados desmarcados e 1 erro (link curto);
- nomes automáticos Portal 04+ depois de um "Portal 03" existente;
- Enter não fecha o diálogo;
- requisições só para localhost e tiles do OSM; 0 exceções.

## O que falta
1. Revisão de correção e segurança: nomes e texto de linha vão ao DOM só por textContent/value; limite de 2000 linhas e de 5 MB.
2. Conformidade: links curtos (`maps.app.goo.gl`) são recusados e nunca resolvidos por rede.

## Riscos
- `importJsonText` foi extraído por script; conferir se o import de JSON da aba Ajustes continua igual.
- A troca de prioridade em `parseCoords` muda o resultado para links que tenham `!3d` e `?q=` ao mesmo tempo.
