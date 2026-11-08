# Tugaflix PT – Addon Stremio

Addon para o Stremio que mostra **só filmes e séries do país Portugal** do [tugaflix](https://tugaflix.run/)
(usa os filtros do próprio site: `country=pt` para filmes e `tvcountry=pt` para séries).

## Funcionalidades

- Catálogos **Filmes Portugueses** e **Séries Portuguesas**, com pesquisa e paginação
- Sub-separador de **categorias** (Drama, Comédia, Thriller…) em cada catálogo, em português e só com
  categorias que têm títulos (usa o filtro de género do próprio site).
- Metadados do site: poster, fundo, sinopse, géneros, rating IMDb, realizador/elenco, temporadas e episódios
- **Todos os servidores** de cada filme/episódio (lidos do site, novos servidores entram automaticamente):
  - **Streamtape / Tape** e **MixDrop / Mix**: reproduzem no player do Stremio/Nuvio (o vídeo passa pelo addon)
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

## Deploy na Vercel

O projeto já está preparado (`api/index.js` + `vercel.json`, sem dependências nem build):

1. Envia esta pasta para um repositório GitHub (ou usa `npx vercel` dentro da pasta).
2. Na Vercel: **Add New → Project**, escolhe o repositório, *Framework Preset* = **Other**, sem build command.
3. Instala no Stremio/Nuvio com `https://<o-teu-projeto>.vercel.app/manifest.json`.

Diferenças na Vercel (cada pedido corre como uma função curta, sem processos em segundo plano):

| | Em casa (`npm start`) | Vercel |
|---|---|---|
| Catálogos, categorias, pesquisa, metadados | ✅ | ✅ |
| Esconder filmes sem vídeo do catálogo | ✅ | ❌ (aparecem, mas sem streams) |
| Streamtape e MixDrop no player | ✅ | ✅ (ver abaixo) |
| Servidores "abre no browser" | ✅ | ✅ |

**Como o vídeo toca na Vercel:** o Streamtape e o MixDrop passam sempre pelo addon (`/play/...`), porque os links
ficam presos ao IP/User-Agent de quem os pediu. Uma função da Vercel é cortada ao fim de 60 s, por isso o addon termina
cada ligação aos 50 s (`TF_STREAM_BUDGET_MS`) e o player volta a pedir a partir do byte onde ia (pedido `Range`).
Os players normais (ExoPlayer, mpv, VLC…) fazem isto sozinhos; pode haver uma pequena pausa a cada ~50 s.

⚠️ Na Vercel o vídeo inteiro passa pela tua conta: o plano grátis tem **100 GB/mês** de tráfego (≈ 50–60 filmes
em 1080p) e a Vercel não foi feita para servir vídeo. Para uso frequente, corre o addon em casa.

## Logótipo

`public/logo.svg` (fonte) e `public/logo.png`; o PNG também está embutido em `lib/logo.js` e é servido em `/logo.png`.

## Variáveis de ambiente

| Variável | Predefinido | |
|---|---|---|
| `PORT` | `7010` | Porta do servidor |
| `TF_BASE_URL` | `https://tugaflix.run` | Muda se o site mudar de domínio |
| `TF_LIST_TTL_MS` | 6 h | Cache das listas |
| `TF_DETAIL_TTL_MS` | 6 h | Cache das páginas de detalhe |

## Notas

- Os links do Streamtape ficam **associados ao IP** e os do MixDrop ao **User-Agent** de quem os pediu. Por isso o
  vídeo dos dois passa pelo addon (`/play/<servidor>/<id>.mp4`); se o link expirar, o addon pede um novo sozinho.
- Isto gasta a largura de banda de onde o addon corre (o PC em casa, ou a conta da Vercel).
- Os servidores "abre no browser" não dão um ficheiro direto (código fechado/encriptado), por isso não tocam no player.
- O conteúdo vem de scraping; se o site mudar a estrutura, o `lib/tugaflix.js` precisa de ajustes.
