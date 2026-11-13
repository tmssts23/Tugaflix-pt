// The whole addon as a web-standard handler: handle(Request) -> Response.
// Used by Cloudflare Workers (worker.js) and by the Node server (index.js: home PC, Fly.io, Vercel).
const tf = require('./tugaflix');
const { resolveStreamtape } = require('./streamtape');
const { resolveMixdrop } = require('./mixdrop');
const { ENV, UA } = require('./http');
const LOGO = require('./logo');

const PREFIX = 'tfpt:';
const PAGE_SIZE = 100;
const LOG = '[TugaflixPT]';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  // Chrome "Private Network Access": lets web apps on https reach the addon on a home IP (192.168.x.x)
  'Access-Control-Allow-Private-Network': 'true',
};

const baseManifest = {
  id: 'pt.tugaflix.portugueses',
  version: '1.8.2',
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
    { type: 'movie', id: 'tfpt_filmes', name: 'Filmes Portugueses', extra: [{ name: 'search' }, { name: 'skip' }] },
    { type: 'series', id: 'tfpt_series', name: 'Séries Portuguesas', extra: [{ name: 'search' }, { name: 'skip' }] },
  ],
  behaviorHints: { configurable: false, configurationRequired: false },
};

/** Manifest with a "genre" sub-filter per catalog ("Últimos 7 dias" + genres that have titles). */
function getManifest(origin) {
  return {
    ...baseManifest,
    ...(origin ? { logo: `${origin}/logo.png` } : {}),
    catalogs: baseManifest.catalogs.map((c) => {
      const kind = c.id === 'tfpt_filmes' ? 'movie' : 'series';
      const options = [tf.RECENT_LABEL, ...(tf.genreOptions(kind) || tf.DEFAULT_GENRES[kind] || tf.ALL_GENRES_PT)];
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

function json(status, payload, cacheSec = 0) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      ...(cacheSec ? { 'Cache-Control': `public, max-age=${cacheSec}` } : {}),
    },
  });
}

function text(status, body) {
  return new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
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
  if (extra.genre === tf.RECENT_LABEL) {
    // titles published on the site in the last days (site RSS feed), newest first
    list = await tf.getRecent(kind);
  } else if (extra.genre) {
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

function sourcesToStreams(sources, origin, title) {
  const playable = [];
  const external = [];
  for (const src of sources) {
    if (src.provider === 'mixdrop' || src.provider === 'streamtape') {
      // The direct links are tied to the IP / User-Agent that opened the page, so the video
      // always goes through the addon (/play/...).
      playable.push({
        name: `Tugaflix PT\n▶ ${src.label}`,
        title: `▶ REPRODUZ NO PLAYER\n${title}\nServidor: ${src.label}`,
        url: `${origin}/play/${src.provider}/${encodeURIComponent(src.file)}.mp4`,
        behaviorHints: { notWebReady: false, bingeGroup: `tfpt-${src.label}` },
      });
    } else {
      // Embed-only servers (vidy, vidsrc, …): no direct file, open the player page.
      external.push({
        // said on the name AND the first line of the title, so it shows even on apps that cut the text
        name: `Tugaflix PT\n🌐 ${src.label} (browser)`,
        title: `🌐 ABRE NO BROWSER (não toca no player)\n${title}\nServidor: ${src.label} · ${src.host}`,
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
    return { streams: sourcesToStreams(live, origin, `${m.name} (${m.year || ''})`) };
  }
  if (!season || !episode) return { streams: [] };
  const sources = await tf.getLiveEpisodeSources(slug, season, episode);
  return { streams: sourcesToStreams(sources, origin, `T${season} E${episode}`) };
}

/* ---------- video proxy (/play/<provider>/<file>.mp4) ---------- */

const PROVIDERS = {
  streamtape: { resolve: resolveStreamtape, referer: 'https://streamtape.com/' },
  mixdrop: { resolve: resolveMixdrop, referer: 'https://mixdrop.ag/' },
};

const directCache = new Map(); // "provider:file" -> { url, at }

async function directUrl(provider, file, fresh = false) {
  const key = `${provider}:${file}`;
  const hit = directCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.url;
  const url = await PROVIDERS[provider].resolve(file);
  directCache.set(key, { url, at: Date.now() });
  return url;
}

/** Ends the body after ms; the player then resumes with "Range: bytes=<where it stopped>-". */
function withBudget(body, ms) {
  const reader = body.getReader();
  const deadline = Date.now() + ms;
  return new ReadableStream({
    async pull(ctrl) {
      if (Date.now() > deadline) {
        reader.cancel().catch(() => {});
        return ctrl.error(new Error('stream budget'));
      }
      const { done, value } = await reader.read();
      if (done) ctrl.close();
      else ctrl.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function proxyVideo(request, provider, file, opts) {
  const headers = { 'User-Agent': UA, Referer: PROVIDERS[provider].referer };
  const range = request.headers.get('range');
  if (range) headers.Range = range;
  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
  const init = { method, headers, ...(request.signal ? { signal: request.signal } : {}) };

  let up = await fetch(await directUrl(provider, file), init);
  if ([401, 403, 404, 410].includes(up.status)) {
    // token expired or tied to another IP (serverless hosts change IP): get a fresh link once
    up.body?.cancel().catch(() => {});
    up = await fetch(await directUrl(provider, file, true), init);
  }
  if (up.status >= 400) {
    up.body?.cancel().catch(() => {});
    return text(502, `${provider}: HTTP ${up.status}`);
  }

  const out = { ...CORS, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  for (const h of ['content-length', 'content-range', 'last-modified', 'etag']) {
    const v = up.headers.get(h);
    if (v) out[h] = v;
  }
  let body = method === 'HEAD' ? null : up.body;
  if (body && opts.streamBudgetMs) body = withBudget(body, opts.streamBudgetMs);
  return new Response(body, { status: up.status, headers: out });
}

/* ---------- router ---------- */

/**
 * opts.origin         public base URL (default: the request URL's origin)
 * opts.streamBudgetMs cut video responses after this long (serverless hosts with a max duration)
 */
async function handle(request, opts = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const origin = opts.origin || url.origin;
  const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    // The root URL also answers with the manifest (with CORS), so "https://host/" works as well as
    // "https://host/manifest.json" in apps that ask for the addon's root ("custom root").
    if (!parts.length || parts[0] === 'manifest.json') return json(200, getManifest(origin), 600);

    if (parts[0] === 'logo.png' || parts[0] === 'favicon.ico') {
      return new Response(request.method === 'HEAD' ? null : LOGO, {
        headers: {
          ...CORS,
          'Content-Type': 'image/png',
          'Content-Length': String(LOGO.length),
          'Cache-Control': 'public, max-age=604800',
        },
      });
    }

    if (parts[0] === 'play' && parts.length === 3) {
      const provider = parts[1];
      const file = parts[2].replace(/\.mp4$/, '');
      if (!PROVIDERS[provider]) return text(404, 'not found');
      try {
        return await proxyVideo(request, provider, file, opts);
      } catch (err) {
        console.warn(`${LOG} play ${provider} falhou ${file}: ${err.message}`);
        return text(502, err.message);
      }
    }

    const [resource, type, rawId, extraSeg] = parts;
    const id = (rawId || '').replace(/\.json$/, '');
    const extra = parseExtra((extraSeg || '').replace(/\.json$/, ''));

    if (resource === 'catalog') return json(200, await handleCatalog(type, id, extra), 1800);
    if (resource === 'meta') return json(200, await handleMeta(type, id), 3600);
    if (resource === 'stream') return json(200, await handleStream(type, id, origin), 300);

    return json(404, { error: 'not found' });
  } catch (err) {
    console.error(`${LOG} erro em ${url.pathname}: ${err.message}`);
    const empty = parts[0] === 'catalog' ? { metas: [] } : parts[0] === 'meta' ? { meta: null } : { streams: [] };
    return json(200, empty);
  }
}

module.exports = { handle, getManifest, ENV, LOG };
