const http = require('http');
const tf = require('./lib/tugaflix');
const { Readable } = require('stream');
const { resolveStreamtape } = require('./lib/streamtape');
const { resolveMixdrop } = require('./lib/mixdrop');
const { UA } = require('./lib/http');
const LOGO = require('./lib/logo');

const PORT = Number(process.env.PORT) || 7010;
const HOST = process.env.HOST || '0.0.0.0';
const PREFIX = 'tfpt:';
const PAGE_SIZE = 100;
const LOG = '[TugaflixPT]';
// Vercel (and similar) run each request as a short-lived function: no background jobs, no long streams.
const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const baseManifest = {
  id: 'pt.tugaflix.portugueses',
  version: '1.4.0',
  name: 'Tugaflix PT',
  description: 'Filmes e séries portuguesas (país: Portugal) a partir do tugaflix.',
  resources: [
    'catalog',
    { name: 'meta', types: ['movie', 'series'], idPrefixes: [PREFIX] },
    // 'tt' too, so streams also appear on the normal Cinemeta (IMDb) pages
    { name: 'stream', types: ['movie', 'series'], idPrefixes: [PREFIX, 'tt'] },
  ],
  types: ['movie', 'series'],
  idPrefixes: [PREFIX, 'tt'],
  catalogs: [
    {
      type: 'movie',
      id: 'tfpt_filmes',
      name: 'Filmes Portugueses',
      extra: [{ name: 'search' }, { name: 'skip' }],
    },
    {
      type: 'series',
      id: 'tfpt_series',
      name: 'Séries Portuguesas',
      extra: [{ name: 'search' }, { name: 'skip' }],
    },
  ],
  behaviorHints: { configurable: false, configurationRequired: false },
};

/** Manifest with a "genre" sub-filter per catalog (only genres that have titles, once known). */
function getManifest(origin) {
  return {
    ...baseManifest,
    ...(origin ? { logo: `${origin}/logo.png` } : {}),
    catalogs: baseManifest.catalogs.map((c) => {
      const kind = c.id === 'tfpt_filmes' ? 'movie' : 'series';
      const options = tf.genreOptions(kind) || tf.DEFAULT_GENRES[kind] || tf.ALL_GENRES_PT;
      return { ...c, genres: options, extra: [{ name: 'genre', options }, ...c.extra] };
    }),
  };
}

/* ---------- helpers ---------- */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseExtra(seg) {
  const out = {};
  if (!seg) return out;
  for (const pair of seg.split('&')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
  }
  return out;
}

function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  return `${proto}://${req.headers.host || `127.0.0.1:${PORT}`}`;
}

function send(res, status, payload, cacheSec = 0) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    ...(cacheSec ? { 'Cache-Control': `public, max-age=${cacheSec}` } : {}),
  });
  res.end(body);
}

function toMetaPreview(kind, it) {
  return {
    genres: tf.getGenres(kind, it.slug),
    id: `${PREFIX}${kind}:${it.slug}`,
    type: kind,
    name: it.name,
    poster: it.poster,
    posterShape: 'poster',
    releaseInfo: it.year,
    imdbRating: it.rating,
    description: it.badge || undefined,
  };
}

/* ---------- handlers ---------- */

async function handleCatalog(type, id, extra) {
  const kind = id === 'tfpt_filmes' ? 'movie' : id === 'tfpt_series' ? 'series' : null;
  if (!kind || kind !== type) return { metas: [] };
  let list;
  if (extra.genre) {
    // the site filters by genre itself (country=pt + genre), so no full crawl is needed
    const slug = tf.genreSlug(extra.genre);
    list = slug ? await tf.getList(kind, slug) : [];
  } else {
    list = await tf.getList(kind);
  }
  // hide movies whose every server says the file was deleted (known after the background check)
  if (kind === 'movie') list = list.filter((it) => !tf.isMovieDead(it.slug));
  if (extra.search) {
    const q = norm(extra.search);
    list = list.filter((it) => norm(it.name).includes(q));
  }
  const skip = Number(extra.skip) || 0;
  return { metas: list.slice(skip, skip + PAGE_SIZE).map((it) => toMetaPreview(kind, it)) };
}

function parseOwnId(id) {
  // tfpt:movie:slug  |  tfpt:series:slug  |  tfpt:series:slug:S:E
  const parts = id.slice(PREFIX.length).split(':');
  const slug = String(parts[1] || '').replace(/[^a-z0-9-]/gi, '');
  return { kind: parts[0], slug, season: parts[2], episode: parts[3] };
}

async function handleMeta(type, id) {
  if (!id.startsWith(PREFIX)) return { meta: null };
  const { kind, slug } = parseOwnId(id);
  if (kind === 'movie') {
    const m = await tf.getMovie(slug);
    return {
      meta: {
        id,
        type: 'movie',
        name: m.name,
        poster: m.poster,
        background: m.background,
        description: m.description,
        releaseInfo: m.year,
        runtime: m.runtime,
        genres: m.genres,
        imdbRating: m.rating,
        director: m.director ? m.director.split(/,\s*/) : undefined,
        cast: m.cast ? m.cast.split(/,\s*/) : undefined,
        imdb_id: m.imdb,
        country: 'Portugal',
        website: m.url,
      },
    };
  }
  const s = await tf.getSeries(slug);
  return {
    meta: {
      id,
      type: 'series',
      name: s.name,
      poster: s.poster,
      background: s.background,
      description: s.description,
      releaseInfo: s.year,
      genres: s.genres,
      imdbRating: s.rating,
      cast: s.cast ? s.cast.split(/,\s*/) : undefined,
      imdb_id: s.imdb,
      country: 'Portugal',
      website: s.url,
      videos: s.episodes.map((e) => ({
        id: `${PREFIX}series:${slug}:${e.season}:${e.episode}`,
        title: e.title,
        season: e.season,
        episode: e.episode,
        thumbnail: e.thumbnail,
        released: e.released || new Date(Date.UTC(Number(s.year) || 2000, 0, 1)).toISOString(),
      })),
    },
  };
}

async function sourcesToStreams(sources, origin, title) {
  const playable = [];
  const external = [];
  for (const src of sources) {
    if (src.provider === 'mixdrop' && SERVERLESS) {
      // Serverless functions are cut after a few seconds/minutes: a proxied movie would stop mid-way.
      external.push({
        name: `Tugaflix PT\n${src.label}`,
        title: `${title}\n🌐 ${src.label} · abre no browser`,
        externalUrl: src.embed,
      });
    } else if (src.provider === 'mixdrop') {
      // MixDrop links only work with the User-Agent that opened the page, so the addon proxies it.
      playable.push({
        name: `Tugaflix PT\n${src.label}`,
        title: `${title}\n▶ ${src.label} · reproduz no player (via addon)`,
        url: `${origin}/play/mixdrop/${encodeURIComponent(src.file)}.mp4`,
        behaviorHints: { notWebReady: false, bingeGroup: `tfpt-${src.label}` },
      });
    } else if (src.provider === 'streamtape') {
      // Resolve on demand through /play so the (IP-bound, expiring) token is always fresh.
      playable.push({
        name: `Tugaflix PT\n${src.label}`,
        title: `${title}\n▶ ${src.label} · reproduz no player`,
        url: `${origin}/play/streamtape/${encodeURIComponent(src.file)}.mp4`,
        behaviorHints: { notWebReady: false, bingeGroup: `tfpt-${src.label}` },
      });
    } else {
      // Embed-only servers (gdplayer, vidy, …): no direct file, open the player page.
      external.push({
        name: `Tugaflix PT\n${src.label}`,
        title: `${title}\n🌐 ${src.label} · abre no browser (${src.host})`,
        externalUrl: src.embed,
      });
    }
  }
  return [...playable, ...external];
}

async function handleStream(type, id, origin) {
  let kind;
  let slug;
  let season;
  let episode;
  if (id.startsWith(PREFIX)) {
    ({ kind, slug, season, episode } = parseOwnId(id));
  } else if (id.startsWith('tt')) {
    const [tt, s, e] = id.split(':');
    const hit = await tf.lookupImdbAsync(type === 'series' ? 'series' : 'movie', tt);
    if (!hit) return { streams: [] };
    ({ kind, slug } = hit);
    season = s;
    episode = e;
  } else {
    return { streams: [] };
  }

  if (kind === 'movie') {
    const m = await tf.getMovie(slug);
    const live = await tf.getLiveMovieSources(slug);
    return { streams: await sourcesToStreams(live, origin, `${m.name} (${m.year || ''})`) };
  }
  if (!season || !episode) return { streams: [] };
  const sources = await tf.getLiveEpisodeSources(slug, season, episode);
  return { streams: await sourcesToStreams(sources, origin, `T${season} E${episode}`) };
}

const mixdropCache = new Map(); // id -> { url, at }

async function proxyMixdrop(req, res, file) {
  let hit = mixdropCache.get(file);
  if (!hit || Date.now() - hit.at > 10 * 60 * 1000) {
    hit = { url: await resolveMixdrop(file), at: Date.now() };
    mixdropCache.set(file, hit);
  }
  const headers = { 'User-Agent': UA, Referer: 'https://mixdrop.ag/' };
  if (req.headers.range) headers.Range = req.headers.range;
  const ctrl = new AbortController();
  req.on('close', () => ctrl.abort());
  let up = await fetch(hit.url, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: ctrl.signal });
  if (up.status === 403 || up.status === 404) {
    // token expired: resolve again once
    hit = { url: await resolveMixdrop(file), at: Date.now() };
    mixdropCache.set(file, hit);
    up = await fetch(hit.url, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: ctrl.signal });
  }
  const out = { ...CORS, 'Content-Type': up.headers.get('content-type') || 'video/mp4', 'Accept-Ranges': 'bytes' };
  for (const h of ['content-length', 'content-range', 'last-modified', 'etag']) {
    const v = up.headers.get(h);
    if (v) out[h] = v;
  }
  res.writeHead(up.status, out);
  if (!up.body || req.method === 'HEAD') return res.end();
  Readable.fromWeb(up.body)
    .on('error', () => res.destroy())
    .pipe(res);
}

async function handlePlay(req, res, provider, file) {
  if (provider === 'mixdrop') {
    try {
      return await proxyMixdrop(req, res, file);
    } catch (err) {
      if (err.name === 'AbortError') return res.destroy();
      console.warn(`${LOG} play mixdrop falhou ${file}: ${err.message}`);
      if (!res.headersSent) res.writeHead(502, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(err.message);
    }
  }
  if (provider !== 'streamtape') {
    res.writeHead(404, CORS);
    return res.end();
  }
  try {
    const direct = await resolveStreamtape(file);
    res.writeHead(302, { ...CORS, Location: direct, 'Cache-Control': 'no-store' });
  } catch (err) {
    console.warn(`${LOG} play falhou ${file}: ${err.message}`);
    res.writeHead(502, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(err.message);
  }
  res.end();
}

/* ---------- router ---------- */

async function requestHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  const url = new URL(req.url || '/', 'http://x');
  const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (!parts.length) {
      res.writeHead(302, { Location: '/manifest.json' });
      return res.end();
    }
    if (parts[0] === 'manifest.json') return send(res, 200, getManifest(originOf(req)), 600);

    if (parts[0] === 'logo.png' || parts[0] === 'favicon.ico') {
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'image/png',
        'Content-Length': LOGO.length,
        'Cache-Control': 'public, max-age=604800',
      });
      return res.end(req.method === 'HEAD' ? undefined : LOGO);
    }

    if (parts[0] === 'play' && parts.length === 3) {
      return handlePlay(req, res, parts[1], parts[2].replace(/\.mp4$/, ''));
    }

    const [resource, type, rawId, extraSeg] = parts;
    const id = (rawId || '').replace(/\.json$/, '');
    const extra = parseExtra((extraSeg || '').replace(/\.json$/, ''));

    if (resource === 'catalog') return send(res, 200, await handleCatalog(type, id, extra), 1800);
    if (resource === 'meta') return send(res, 200, await handleMeta(type, id), 3600);
    if (resource === 'stream') return send(res, 200, await handleStream(type, id, originOf(req)), 300);

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(`${LOG} erro em ${url.pathname}: ${err.message}`);
    const empty = parts[0] === 'catalog' ? { metas: [] } : parts[0] === 'meta' ? { meta: null } : { streams: [] };
    return send(res, 200, empty);
  }
}

module.exports = { requestHandler, getManifest };

if (require.main === module) {
  http.createServer(requestHandler).listen(PORT, HOST, () => {
    console.log(`${LOG} a correr em http://127.0.0.1:${PORT}/manifest.json`);
    // Warm up caches, the IMDb/genre map and the movie availability check in background,
    // and refresh them every 6 hours.
    const warm = () =>
      tf
        .buildImdbMap()
        .then(() => tf.buildMovieAvailability())
        .catch((e) => console.warn(`${LOG} warmup: ${e.message}`));
    warm();
    setInterval(warm, 6 * 60 * 60 * 1000).unref();
  });
}
