const { getText, request, cached, decodeEntities, stripTags } = require('./http');

const BASE = (process.env.TF_BASE_URL || 'https://tugaflix.run').replace(/\/$/, '');
const LIST_TTL = Number(process.env.TF_LIST_TTL_MS) || 6 * 60 * 60 * 1000;
const DETAIL_TTL = Number(process.env.TF_DETAIL_TTL_MS) || 6 * 60 * 60 * 1000;
const MAX_PAGES = 60;

/** Listing URLs filtered to country = Portugal (optionally also by the site's genre slug). */
function listUrl(kind, page, genre) {
  const g = genre ? `&${kind === 'movie' ? 'genre' : 'tvgenre'}=${encodeURIComponent(genre)}` : '';
  if (kind === 'movie') {
    return page > 1
      ? `${BASE}/filmes/page/${page}/?country=pt${g}`
      : `${BASE}/filmes/?filtrar_busca=1&country=pt${g}`;
  }
  return page > 1
    ? `${BASE}/series/page/${page}/?tvcountry=pt${g}`
    : `${BASE}/series/?filtrar_busca_series=1&tvcountry=pt${g}`;
}

function parseListing(html, kind) {
  const out = [];
  const folder = kind === 'movie' ? 'filmes' : 'series';
  const blocks = html.split('<div class="poster">').slice(1);
  for (const block of blocks) {
    const href = block.match(new RegExp(`href="[^"]*/${folder}/([^/"]+)/"`));
    if (!href) continue;
    // the poster image comes after the overlay link (skip the small language flag)
    const afterLink = block.slice(block.indexOf('</a>'));
    const img = afterLink.match(/<img src="([^"]*)"[^>]*alt="([^"]*)"/) || [];
    const m = [null, null, img[1], img[2]];
    const rawTitle = decodeEntities((block.match(/ov-title">([^<]*)/) || [])[1] || m[3] || '').trim();
    const ym = rawTitle.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    const rating = (block.match(/IMDb\s*([\d.]+)/) || [])[1];
    out.push({
      slug: href[1],
      name: ym ? ym[1] : rawTitle,
      year: ym ? ym[2] : undefined,
      poster: m[2],
      rating,
      badge: stripTags((block.match(/ov-badge-fixed">([^<]*)/) || [])[1] || ''),
    });
  }
  return out;
}

/** getList('movie') = every PT movie; getList('movie', 'comedy') = PT movies of that site genre. */
function getList(kind, genre) {
  return getListCached(genre ? `${kind}|${genre}` : kind);
}

const getListCached = cached(LIST_TTL, async (key) => {
  const [kind, genre] = key.split('|');
  const all = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let html;
    try {
      html = await getText(listUrl(kind, page, genre));
    } catch (err) {
      if (page === 1) throw err;
      break; // 404 after last page
    }
    const items = parseListing(html, kind);
    let added = 0;
    for (const it of items) {
      if (seen.has(it.slug)) continue;
      seen.add(it.slug);
      all.push(it);
      added++;
    }
    if (!added || !html.includes(`/page/${page + 1}/`)) break;
  }
  console.log(`[TugaflixPT] lista ${key}: ${all.length} itens`);
  return all;
});

const GENRE_PT = {
  action: 'Ação',
  adventure: 'Aventura',
  animation: 'Animação',
  biography: 'Biografia',
  comedy: 'Comédia',
  crime: 'Crime',
  documentary: 'Documentário',
  drama: 'Drama',
  family: 'Família',
  fantasy: 'Fantasia',
  'film-noir': 'Film-Noir',
  'game-show': 'Concurso',
  history: 'História',
  horror: 'Terror',
  music: 'Música',
  musical: 'Musical',
  mystery: 'Mistério',
  news: 'Notícias',
  'reality-tv': 'Reality-TV',
  romance: 'Romance',
  'sci-fi': 'Ficção Científica',
  short: 'Curta-metragem',
  sport: 'Desporto',
  thriller: 'Thriller',
  war: 'Guerra',
  western: 'Western',
};

function genrePt(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\s+/g, '-');
  return GENRE_PT[key] || String(name || '').trim();
}

/** "Comédia" -> "comedy" (the site's genre slug), or undefined. */
function genreSlug(ptName) {
  const n = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
  const target = n(ptName);
  return Object.keys(GENRE_PT).find((k) => n(GENRE_PT[k]) === target || k === target);
}

/** Genres seen in PT titles (used until the background crawl knows the real ones, e.g. on Vercel). */
const DEFAULT_GENRES = {
  movie: ['Drama', 'Comédia', 'Romance', 'Thriller', 'Ação', 'Biografia', 'Crime', 'Mistério', 'História',
    'Aventura', 'Terror', 'Documentário', 'Fantasia', 'Guerra', 'Ficção Científica', 'Música', 'Família',
    'Musical', 'Western', 'Animação', 'Curta-metragem'],
  series: ['Drama', 'Comédia', 'Aventura', 'Crime', 'Romance', 'Ação', 'Documentário', 'História', 'Biografia',
    'Guerra', 'Mistério', 'Thriller', 'Desporto', 'Família', 'Fantasia', 'Ficção Científica', 'Música'],
};

/** Common details shown on movie and series pages. */
function parseDetails(html) {
  const det = (html.match(/<div class="movie-details">([\s\S]*?)<\/div>\s*\n\s*<div class="sinopse/) || [])[1] || '';
  const h3 = stripTags((det.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '');
  const ym = h3.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  const genres = [
    ...new Set([...det.matchAll(/\/(?:tv)?genre\/[^"]*"[^>]*>([^<]+)</g)].map((x) => genrePt(decodeEntities(x[1])))),
  ];
  const imdb = (det.match(/imdb\.com\/title\/(tt\d+)/) || [])[1];
  const rating = (det.match(/imdb\.com\/title\/tt\d+\/"[^>]*>([\d.]+)</) || [])[1];
  const runtime = (det.match(/bi-clock"><\/i>\s*(\d+)/) || [])[1];
  const plainDivs = [...det.matchAll(/<div>([^<]+)<\/div>/g)].map((x) => decodeEntities(x[1]).trim());
  const poster = (det.match(/movie_thumb"><img[^>]*src="([^"]+)"/) || [])[1];
  const bg = (html.match(/image_player"\s+style="background:url\(([^)]+)\)/) || [])[1];
  const sinopse = stripTags(
    ((html.match(/<div class="sinopse"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '').replace(/<h4>[\s\S]*?<\/h4>/, ''),
  );
  return {
    name: ym ? ym[1] : h3,
    year: ym ? ym[2] : undefined,
    genres,
    imdb,
    rating,
    runtime: runtime ? `${runtime} min` : undefined,
    people: plainDivs,
    poster: poster ? poster.replace(/([^:])\/\/+/g, '$1/') : undefined,
    background: bg ? (bg.startsWith('//') ? `https:${bg}` : bg) : undefined,
    description: sinopse || undefined,
  };
}

const getMovie = cached(DETAIL_TTL, async (slug) => {
  const url = `${BASE}/filmes/${slug}/`;
  const html = await getText(url);
  const d = parseDetails(html);
  // people: [director, cast] on movie pages
  const servers = parseServerOptions(html, 'server_name');
  return { slug, url, ...d, director: d.people[0], cast: d.people[1], servers };
});

function parseEpisodes(html, slug, season) {
  const eps = [];
  const seen = new Set();
  const hrefRe = new RegExp(`<a href="[^"]*/series/${slug}/${season}/(\\d+)/"`, 'g');
  const cards = html.split(hrefRe);
  // split() with a capture group yields [before, ep1, card1, ep2, card2, ...]
  for (let i = 1; i < cards.length; i += 2) {
    const episode = Number(cards[i]);
    if (seen.has(episode)) continue;
    seen.add(episode);
    const card = cards[i + 1] || '';
    const date = (card.match(/bi-calendar3[^>]*><\/i>\s*(\d{4}-\d{2}-\d{2})/) || [])[1];
    eps.push({
      season,
      episode,
      thumbnail: (card.match(/<img src="([^"]+)"/) || [])[1],
      title: decodeEntities((card.match(/text-truncate">([^<]*)</) || [])[1] || '').trim() || `Episódio ${episode}`,
      released: date ? new Date(`${date}T12:00:00Z`).toISOString() : undefined,
    });
  }
  return eps.sort((a, b) => a.episode - b.episode);
}

const getSeries = cached(DETAIL_TTL, async (slug) => {
  const url = `${BASE}/series/${slug}/`;
  const html = await getText(url);
  const d = parseDetails(html);
  const seasons = [
    ...new Set([...html.matchAll(new RegExp(`/series/${slug}/(\\d+)/"[^>]*season-btn`, 'g'))].map((x) => Number(x[1]))),
  ].sort((a, b) => a - b);
  if (!seasons.length) seasons.push(1);

  const episodes = [];
  for (const s of seasons) {
    let shtml;
    try {
      shtml = s === seasons[0] && html.includes(`/series/${slug}/${s}/1/`) ? html : await getText(`${url}${s}/`);
    } catch (_) {
      continue;
    }
    episodes.push(...parseEpisodes(shtml, slug, s));
  }
  return { slug, url, ...d, cast: d.people[0], seasons, episodes };
});

const SOURCES_TTL = Number(process.env.TF_SOURCES_TTL_MS) || 30 * 60 * 1000;

function absUrl(u) {
  if (!u) return '';
  return u.startsWith('//') ? `https:${u}` : u;
}

/** <option>s of a server <select> (any value, so new servers are picked up automatically). */
function parseServerOptions(html, selectName) {
  const sel = (html.match(new RegExp(`<select[^>]*name="${selectName}"[^>]*>([\\s\\S]*?)<\\/select>`)) || [])[1] || '';
  return [...sel.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)/g)].map((x) => ({
    id: x[1],
    label: decodeEntities(x[2]).trim() || x[1],
  }));
}

function playerIframe(html) {
  return absUrl(decodeEntities((html.match(/<iframe[^>]*name="player"[^>]*src="([^"]+)"/) || [])[1] || ''));
}

/**
 * The tuga.best wrapper page shows a "play" button (a POST form) before the real embed.
 * Returns the final embed URL, or '' if the server has no video.
 */
async function unwrapTugaBest(src) {
  if (!/tuga\.best\/player\//.test(src)) return src;
  // Empty file id (e.g. "?ST=&") means the site has no video on this server.
  if (/[?&](ST\d?|file)=(&|$)/.test(src)) return '';
  const html = await getText(src, { form: { start_video: '1', submit: '' }, referer: src });
  return absUrl(decodeEntities((html.match(/<iframe[^>]*src="([^"]+)"/) || [])[1] || ''));
}

/** Turn a final embed URL into a source: Streamtape is playable in-app, the rest open externally. */
function classifyEmbed(embed, label) {
  const st = embed.match(/streamtape\.[a-z]+\/[ev]\/([A-Za-z0-9]+)/);
  if (st) return { provider: 'streamtape', file: st[1], label, embed };
  // gdplayer ("Player 2") is just another web player around a Streamtape/MixDrop file: play that file directly
  const gd = embed.match(/gdplayer\.[a-z]+\/embed2\/\?host=(streamtape|mixdrop)&(?:amp;)?id=([A-Za-z0-9]+)/);
  if (gd) return { provider: gd[1], file: gd[2], label, embed };
  const md = embed.match(/(?:mixdrop|mxdrop|m1xdrop|mixdrp)\.[a-z]+\/[ef]\/([A-Za-z0-9]+)/);
  if (md) return { provider: 'mixdrop', file: md[1], label, embed };
  const host = (embed.match(/^https?:\/\/(?:www\.)?([^/]+)/) || [])[1] || 'externo';
  return { provider: 'external', label, embed, host };
}

async function resolveServers(pageUrl, servers, fieldName) {
  const results = await Promise.all(
    servers.map(async (sv) => {
      try {
        const html = await getText(pageUrl, { form: { [fieldName]: sv.id }, referer: pageUrl });
        const embed = await unwrapTugaBest(playerIframe(html));
        return embed ? classifyEmbed(embed, sv.label) : null;
      } catch (err) {
        console.warn(`[TugaflixPT] servidor ${sv.label} falhou: ${err.message}`);
        return null;
      }
    }),
  );
  return results.filter(Boolean);
}

/** All servers of a movie: [{ provider, file?, label, embed }] */
const getMovieSources = cached(SOURCES_TTL, async (slug) => {
  const movie = await getMovie(slug);
  const servers = movie.servers.length ? movie.servers : [{ id: 'st1', label: 'Streamtape' }];
  return resolveServers(movie.url, servers, 'server_name');
});

/** All servers of an episode: [{ provider, file?, label, embed }] */
const getEpisodeSources = cached(SOURCES_TTL, async (key) => {
  const url = `${BASE}/series/${key}/`;
  const html = await getText(url);
  const servers = parseServerOptions(html, 'escolha_player');
  if (!servers.length) {
    // no selector: just use whatever player is on the page
    const embed = await unwrapTugaBest(playerIframe(html));
    return embed ? [classifyEmbed(embed, 'Player')] : [];
  }
  return resolveServers(url, servers, 'escolha_player');
});

/**
 * Background crawl of every detail page. Builds:
 *  - IMDb id -> { kind, slug }  (streams also show on Cinemeta pages)
 *  - "kind:slug" -> [genres]    (genre sub-filter in the catalogs)
 */
const imdbMap = new Map();
const genreMap = new Map();
let imdbBuild = null;
let imdbBuiltAt = 0;

async function buildImdbMap() {
  if (imdbBuild) return imdbBuild;
  if (Date.now() - imdbBuiltAt < LIST_TTL && imdbMap.size) return;
  imdbBuild = (async () => {
    for (const kind of ['movie', 'series']) {
      const list = await getList(kind).catch(() => []);
      const queue = [...list];
      const worker = async () => {
        while (queue.length) {
          const it = queue.shift();
          try {
            const d = kind === 'movie' ? await getMovie(it.slug) : await getSeries(it.slug);
            if (d.imdb) imdbMap.set(d.imdb, { kind, slug: it.slug });
            genreMap.set(`${kind}:${it.slug}`, d.genres || []);
          } catch (_) {
            /* ignore */
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
    }
    imdbBuiltAt = Date.now();
    console.log(`[TugaflixPT] mapa IMDb: ${imdbMap.size} títulos`);
  })().finally(() => {
    imdbBuild = null;
  });
  return imdbBuild;
}

function lookupImdb(tt) {
  return imdbMap.get(tt);
}

/**
 * IMDb id -> { kind, slug } without the full crawl (works on serverless/cold starts):
 * get the title from Cinemeta, search the site, keep PT results and confirm the IMDb id on the page.
 */
const findByImdb = cached(DETAIL_TTL, async (key) => {
  const [kind, tt] = key.split('|');
  const known = imdbMap.get(tt);
  if (known) return known;
  let name;
  try {
    const r = await request(`https://v3-cinemeta.strem.io/meta/${kind}/${tt}.json`, { timeout: 6000 });
    name = (await r.json())?.meta?.name;
  } catch (_) {
    /* no name -> nothing to search */
  }
  if (!name) return null;
  const pt = new Set((await getList(kind)).map((it) => it.slug));
  const folder = kind === 'movie' ? 'filmes' : 'series';
  const flag = kind === 'movie' ? 'filtrar_busca' : 'filtrar_busca_series';
  const html = await getText(`${BASE}/${folder}/?${flag}=1&s=${encodeURIComponent(name)}`);
  const slugs = [...new Set(parseListing(html, kind).map((it) => it.slug))].filter((s) => pt.has(s)).slice(0, 5);
  for (const slug of slugs) {
    const d = kind === 'movie' ? await getMovie(slug) : await getSeries(slug);
    if (d.imdb) imdbMap.set(d.imdb, { kind, slug });
    if (d.imdb === tt) return { kind, slug };
  }
  return null;
});

async function lookupImdbAsync(kind, tt) {
  return imdbMap.get(tt) || (await findByImdb(`${kind}|${tt}`).catch(() => null));
}

function getGenres(kind, slug) {
  return genreMap.get(`${kind}:${slug}`);
}

/** Genres that actually have titles, most common first (null until the crawl finished once). */
function genreOptions(kind) {
  if (!imdbBuiltAt) return null;
  const count = new Map();
  for (const [key, genres] of genreMap) {
    if (!key.startsWith(`${kind}:`)) continue;
    for (const g of genres) count.set(g, (count.get(g) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt')).map((x) => x[0]);
}

const ALL_GENRES_PT = [...new Set(Object.values(GENRE_PT))].sort((a, b) => a.localeCompare(b, 'pt'));

function getEpisodeSourcesFor(slug, season, episode) {
  return getEpisodeSources(`${slug}/${Number(season)}/${Number(episode)}`);
}

/* ---------- availability (does the server really have the file?) ---------- */

const CHECK_TTL = Number(process.env.TF_CHECK_TTL_MS) || 60 * 60 * 1000;
const CHECK_TIMEOUT = Number(process.env.TF_CHECK_TIMEOUT_MS) || 7000;

/** Fetch an embed page: { status, html } or { error }. */
async function fetchEmbed(url) {
  try {
    const res = await request(url, { referer: 'https://tuga.best/', timeout: CHECK_TIMEOUT });
    return { status: res.status, html: await res.text() };
  } catch (err) {
    return { error: err.message };
  }
}

const DELETED_RE = /video not found|file not found|can't find the (file|video)|deleted by|file (was )?(deleted|removed)/i;

/**
 * Hoster check (Streamtape/MixDrop): only a clear "deleted" answer counts as dead.
 * Timeouts, rate limits and other errors are NOT treated as dead (and not cached),
 * so a busy server never hides a film that is actually there.
 */
async function hosterAlive(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetchEmbed(url);
    if (!r.error) {
      if (r.status === 404 || r.status === 410 || DELETED_RE.test(r.html)) return false;
      if (r.status < 400) return true;
    }
    await new Promise((ok) => setTimeout(ok, 800));
  }
  const err = new Error('não foi possível verificar');
  err.unknown = true;
  throw err; // not cached by cached(); onlyLive() keeps the source
}

/** true = file exists, false = deleted / server unreachable. Cached per file. */
const checkEmbed = cached(CHECK_TTL, async (key, src) => {
  if (src.provider === 'streamtape') return hosterAlive(`https://streamtape.com/e/${src.file}`);
  if (src.provider === 'mixdrop') return hosterAlive(src.embed);
  // gdplayer wraps a Streamtape (or other) file: it lives or dies with that file
  const gd = src.embed.match(/gdplayer\.[a-z]+\/embed2\/\?host=streamtape&(?:amp;)?id=([A-Za-z0-9]+)/);
  if (gd) return checkEmbed(`streamtape:${gd[1]}`, { provider: 'streamtape', file: gd[1] });
  // other embed sites (vidsrc, vidy, …) are JavaScript players: only check that the page opens
  const r = await fetchEmbed(src.embed);
  if (r.error) return false;
  return r.status < 400 && !DELETED_RE.test(r.html.slice(0, 20000));
});

function checkKey(src) {
  return src.provider === 'external' ? `ext:${src.embed}` : `${src.provider}:${src.file}`;
}

async function onlyLive(sources) {
  // unknown (couldn't verify) -> keep it; only a confirmed "deleted"/unreachable embed is dropped
  const ok = await Promise.all(sources.map((s) => checkEmbed(checkKey(s), s).catch((e) => !!e.unknown)));
  return sources.filter((_, i) => ok[i]);
}

async function getLiveMovieSources(slug) {
  return onlyLive(await getMovieSources(slug));
}

async function getLiveEpisodeSources(slug, season, episode) {
  return onlyLive(await getEpisodeSourcesFor(slug, season, episode));
}

/** Movies with no working server at all (filled by a background check), hidden from the catalog. */
const deadMovies = new Set();
let availBuild = null;

function buildMovieAvailability() {
  if (availBuild) return availBuild;
  availBuild = (async () => {
    const list = await getList('movie').catch(() => []);
    const queue = [...list];
    let dead = 0;
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        try {
          const live = await getLiveMovieSources(it.slug);
          if (live.length) deadMovies.delete(it.slug);
          else {
            deadMovies.add(it.slug);
            dead++;
          }
        } catch (_) {
          /* keep current state */
        }
      }
    };
    await Promise.all(Array.from({ length: 2 }, worker));
    console.log(`[TugaflixPT] disponibilidade: ${list.length - dead}/${list.length} filmes com vídeo`);
  })().finally(() => {
    availBuild = null;
  });
  return availBuild;
}

function isMovieDead(slug) {
  return deadMovies.has(slug);
}

module.exports = {
  BASE,
  getEpisodeSourcesFor,
  getLiveMovieSources,
  getLiveEpisodeSources,
  buildMovieAvailability,
  isMovieDead,
  getList,
  getMovie,
  getSeries,
  getMovieSources,
  getEpisodeSources,
  buildImdbMap,
  lookupImdb,
  lookupImdbAsync,
  getGenres,
  genreOptions,
  genreSlug,
  DEFAULT_GENRES,
  ALL_GENRES_PT,
};
