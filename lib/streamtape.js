const { getText, request } = require('./http');

/**
 * Resolve a Streamtape file id into a direct, playable URL.
 * Note: Streamtape tokens are bound to the IP that requested the embed page,
 * so the returned URL works from the machine running the addon (and usually its LAN).
 */
async function resolveStreamtape(id) {
  const html = await getText(`https://streamtape.com/e/${encodeURIComponent(id)}`, {
    referer: 'https://tuga.best/',
  });
  const m = html.match(
    /getElementById\(\s*'robotlink'\s*\)\.innerHTML\s*=\s*'([^']*)'\s*\+\s*\(\s*'([^']*)'\s*\)((?:\.substring\(\d+\))*)/,
  );
  if (!m) {
    if (/Video not found|file was deleted/i.test(html)) throw new Error('Streamtape: ficheiro removido');
    throw new Error('Streamtape: link não encontrado');
  }
  let tail = m[2];
  for (const n of m[3].matchAll(/\d+/g)) tail = tail.substring(Number(n[0]));
  const getVideo = `https:${m[1]}${tail}&stream=1`.replace(/^https:\/\/\//, 'https://');

  // Follow the first redirect to the CDN so the player gets a plain mp4 URL.
  try {
    const res = await request(getVideo, { redirect: 'manual', referer: 'https://streamtape.com/' });
    const loc = res.headers.get('location');
    if (res.body) res.body.cancel().catch(() => {});
    if (loc && /^https?:/.test(loc)) return loc;
  } catch (_) {
    /* fall back to get_video URL */
  }
  return getVideo;
}

module.exports = { resolveStreamtape };
