const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Environment variables on Node (process.env) and on Cloudflare Workers (nodejs_compat fills process.env).
const ENV = (typeof process !== 'undefined' && process.env) || {};

const TIMEOUT_MS = Number(ENV.TF_TIMEOUT_MS) || 12000;

async function request(url, { method = 'GET', form, referer, redirect = 'follow', timeout = TIMEOUT_MS } = {}) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'pt-PT,pt;q=0.9' };
  if (referer) headers.Referer = referer;
  let body;
  if (form) {
    body = new URLSearchParams(form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    method = 'POST';
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { method, headers, body, redirect, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getText(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/** Simple TTL cache with in-flight de-duplication. */
function cached(ttlMs, fn) {
  const store = new Map();
  return async (key, ...args) => {
    const hit = store.get(key);
    if (hit && (hit.promise || Date.now() - hit.at < ttlMs)) return hit.promise || hit.value;
    const promise = fn(key, ...args)
      .then((value) => {
        store.set(key, { value, at: Date.now() });
        return value;
      })
      .catch((err) => {
        if (hit) store.set(key, hit);
        else store.delete(key);
        throw err;
      });
    store.set(key, { ...(hit || {}), promise });
    return promise;
  };
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#0*38;|&amp;/g, '&')
    .replace(/&#0*39;|&#8217;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

module.exports = { ENV, UA, request, getText, cached, decodeEntities, stripTags };
