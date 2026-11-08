# Tugaflix PT – Addon Stremio

Addon para o Stremio que mostra **só filmes e séries do país Portugal** do [tugaflix](https://tugaflix.run/)
(usa os filtros do próprio site: `country=pt` para filmes e `tvcountry=pt` para séries).

## Funcionalidades

- Catálogos **Filmes Portugueses** e **Séries Portuguesas**, com pesquisa e paginação
- Sub-separador de **categorias** (Drama, Comédia, Thriller…) em cada catálogo, em português e só com
  categorias que têm títulos. Se adicionares uma categoria nova, reinstala o addon para a lista atualizar.
- Metadados do site: poster, fundo, sinopse, géneros, rating IMDb, realizador/elenco, temporadas e episódios
- **Todos os servidores** de cada filme/episódio (lidos do site, novos servidores entram automaticamente):
  - **Streamtape / Tape**: link mp4 direto, reproduz no player do Stremio/Nuvio
  - **MixDrop / Mix**: reproduz no player; o vídeo passa pelo addon (proxy), porque o link só aceita o
    User-Agent que abriu a página
  - **Player 2, Vidy, Vidsrc, Vidlink, …**: só existem como página web (embed), aparecem como "abre no browser"
- Os streams também aparecem nas páginas normais do Stremio/Cinemeta (IDs IMDb `tt…`)
- Sem dependências (Node 18+, usa `fetch` nativo)

### Verificação de ficheiros

- Antes de mostrar os streams, o addon confirma se cada servidor ainda tem o ficheiro
  (Streamtape "Video not found", MixDrop "We can't find the video…", páginas que não abrem). Os mortos não aparecem.
- O "Player 2" usa o mesmo ficheiro do Streamtape, por isso morre com ele.
- Filmes sem nenhum servidor vivo são **escondidos do catálogo** (verificação em segundo plano ao arrancar e de 6 em 6 horas).
- Um erro/timeout não conta como "apagado": só uma resposta clara do servidor esconde um vídeo.
- Os servidores do tipo Vidsrc/Vidy só são verificados se a página abre (o vídeo é carregado por JavaScript).

## Correr

```bash
npm start
```

Instala no Stremio com: `http://127.0.0.1:7010/manifest.json`
(noutro dispositivo da mesma rede usa o IP do PC, ex.: `http://192.168.1.50:7010/manifest.json`).

## Variáveis de ambiente

| Variável | Predefinido | |
|---|---|---|
| `PORT` | `7010` | Porta do servidor |
| `TF_BASE_URL` | `https://tugaflix.run` | Muda se o site mudar de domínio |
| `TF_LIST_TTL_MS` | 6 h | Cache das listas |
| `TF_DETAIL_TTL_MS` | 6 h | Cache das páginas de detalhe |

## Notas

- Os links do Streamtape ficam **associados ao IP** de quem os pediu. Por isso o addon devolve
  `/play/streamtape/<id>.mp4`, que gera um link novo a cada reprodução. Funciona bem a correr em casa
  (mesmo IP público que o Stremio). Num servidor remoto (Render, Vercel…) o link pode ser recusado.
- O MixDrop gasta a largura de banda do PC onde o addon corre (o vídeo passa por ele).
- Os servidores "abre no browser" não dão um ficheiro direto (código fechado/encriptado), por isso não tocam no player.
- O conteúdo vem de scraping; se o site mudar a estrutura, o `lib/tugaflix.js` precisa de ajustes.
