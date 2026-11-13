# Tugaflix PT – Addon Stremio

Addon para o Stremio que mostra **só filmes e séries do país Portugal** do [tugaflix](https://tugaflix.run/)
(usa os filtros do próprio site: `country=pt` para filmes e `tvcountry=pt` para séries).

## Funcionalidades

- Catálogos **Filmes Portugueses** e **Séries Portuguesas**, com pesquisa e paginação
- Sub-separador de **categorias** (Drama, Comédia, Thriller…) em cada catálogo, em português e só com
  categorias que têm títulos (usa o filtro de género do próprio site).
- Sub-separador **Últimos 7 dias** (o primeiro da lista): filmes e séries portugueses publicados/atualizados no
  site nos últimos 7 dias, do mais recente para o mais antigo (lê o RSS do site; muda os dias com `TF_RECENT_DAYS`).
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

## Deploy no Cloudflare Workers (via GitHub)

Ficheiros: `worker.js` (entrada) + `wrangler.toml`. O código do addon está em `lib/` e é o mesmo do servidor Node.
O projeto tem menos de 20 ficheiros e nenhuma dependência (sem `node_modules`), por isso pode ser enviado pelo
site do GitHub (limite de 100 ficheiros por upload).

1. No GitHub: **New repository** → **uploading an existing file** → arrasta o **conteúdo** da pasta `tugaflix-pt`
   (incluindo as pastas `lib`, `public` e `api`) → **Commit changes**.
2. No Cloudflare: **Workers & Pages → Create → Import a repository** → escolhe o repositório.
   Deixa o *Build command* vazio e o *Deploy command* `npx wrangler deploy` (lê o `wrangler.toml`).
3. Instala no Nuvio/Stremio: `https://tugaflix-pt.<a-tua-conta>.workers.dev/manifest.json`

Sem GitHub, também dá a partir da pasta: `npx wrangler login` e depois `npx wrangler deploy`.

Como no Workers:
- Catálogos, categorias, "Últimos 7 dias", pesquisa, metadados e streams: ✅
- Streamtape e MixDrop no player: o vídeo passa pelo Worker, sem cortes (não há limite de tempo enquanto o player
  está a descarregar).
- Não há processos em segundo plano: os filmes sem vídeo **aparecem no catálogo** (mas sem streams), como na Vercel.
- Plano grátis: 100 000 pedidos/dia e 50 pedidos ao site por cada pedido do Stremio (chega para o addon).
- ⚠️ As condições do Cloudflare não permitem usar o serviço principalmente para servir vídeo; com muito uso a conta
  pode ser limitada. Para ver muitos filmes, o PC de casa ou o Fly.io são mais seguros.

## Deploy no Fly.io (recomendado para alojar)

O Fly.io corre o addon como um servidor normal (contentor Docker), por isso **tudo funciona como em casa**:
vídeo Streamtape/MixDrop no player sem cortes, verificação de vídeos apagados em segundo plano, catálogo limpo.

Ficheiros: `Dockerfile`, `fly.toml`, `.dockerignore` (não precisas de Docker instalado: o Fly constrói a imagem).

1. Instala o `flyctl` (PowerShell):
   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex
   ```
2. Inicia sessão: `fly auth login`
3. Dentro desta pasta, cria a app (usa o `fly.toml` que já existe; troca o nome se `tugaflix-pt` estiver ocupado):
   ```bash
   fly launch --no-deploy --copy-config --name <nome-unico>
   ```
4. Publica: `fly deploy`
5. Instala no Nuvio/Stremio: `https://<nome-unico>.fly.dev/manifest.json`

Notas:
- Região `mad` (Madrid). A máquina **desliga-se quando ninguém a usa** e liga sozinha no próximo pedido
  (o primeiro pedido demora uns segundos). Para a ter sempre ligada: `auto_stop_machines = "off"` e
  `min_machines_running = 1` no `fly.toml`.
- O vídeo passa pela máquina do Fly: conta como tráfego de saída da tua conta (vê os preços no site do Fly.io).
- Para atualizar depois de mudares o código: `fly deploy`.

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
