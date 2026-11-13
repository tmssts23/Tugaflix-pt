// Node server (home PC, Fly.io, Docker) and Vercel adapter for the addon in lib/addon.js.
// Cloudflare Workers uses worker.js instead.
const http = require('http');
const { Readable } = require('stream');
const { handle, getManifest, ENV, LOG } = require('./lib/addon');
const tf = require('./lib/tugaflix');

// Fly.io always routes to 8080 (and sets FLY_APP_NAME); at home the default is 7010.
const PORT = Number(ENV.PORT) || (ENV.FLY_APP_NAME ? 8080 : 7010);
const HOST = ENV.HOST || '0.0.0.0';
// Vercel (and similar) run each request as a short-lived function: no background jobs, no long streams.
const SERVERLESS = !!(ENV.VERCEL || ENV.AWS_LAMBDA_FUNCTION_NAME);
// vercel.json maxDuration is 60 s: end each video response a bit earlier (the player resumes with Range).
const STREAM_BUDGET_MS = Number(ENV.TF_STREAM_BUDGET_MS) || (SERVERLESS ? 50_000 : 0);

/** Node IncomingMessage -> web Request (aborted when the client goes away). */
function toRequest(req, res) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  return {
    request: new Request(`${proto}://${host}${req.url || '/'}`, { method: req.method, headers, signal: ctrl.signal }),
    origin: `${proto}://${host}`,
  };
}

async function requestHandler(req, res) {
  try {
    const { request, origin } = toRequest(req, res);
    const r = await handle(request, { origin, streamBudgetMs: STREAM_BUDGET_MS });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (!r.body) return res.end();
    Readable.fromWeb(r.body)
      .on('error', () => res.destroy()) // budget reached / upstream error / client gone
      .pipe(res);
  } catch (err) {
    console.error(`${LOG} ${err.message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}

module.exports = { requestHandler, getManifest };

if (require.main === module) {
  const server = http.createServer(requestHandler);

  // Fly.io / Docker stop the machine with SIGINT/SIGTERM: stop accepting requests and exit cleanly.
  const shutdown = (sig) => {
    console.log(`${LOG} ${sig} recebido, a fechar…`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 5000).unref(); // don't wait forever for open video streams
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  server.listen(PORT, HOST, () => {
    console.log(`${LOG} à escuta em ${HOST}:${PORT} → http://127.0.0.1:${PORT}/manifest.json`);
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
