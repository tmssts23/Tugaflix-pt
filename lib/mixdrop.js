const { getText } = require('./http');

/** Decode Dean Edwards' "p,a,c,k,e,d" packer without eval. */
function unpack(html) {
  const m = html.match(/\}\('((?:\\'|[^'])*)',\s*(\d+),\s*(\d+),\s*'((?:\\'|[^'])*)'\.split\('\|'\)/);
  if (!m) return null;
  const p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const a = Number(m[2]);
  const k = m[4].split('|');
  const enc = (c) =>
    (c < a ? '' : enc(Math.floor(c / a))) + ((c %= a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  const dict = new Map();
  for (let c = Number(m[3]) - 1; c >= 0; c--) dict.set(enc(c), k[c] || enc(c));
  return p.replace(/\b\w+\b/g, (w) => (dict.has(w) ? dict.get(w) : w));
}

/** Resolve a MixDrop file id into a direct mp4 URL. */
async function resolveMixdrop(id) {
  const html = await getText(`https://mixdrop.ag/e/${encodeURIComponent(id)}`, { referer: 'https://tuga.best/' });
  const code = unpack(html);
  const wurl = code && (code.match(/MDCore\.wurl\s*=\s*"([^"]+)"/) || [])[1];
  if (!wurl) {
    if (/can't find the (file|video)|deleted/i.test(html)) throw new Error('MixDrop: ficheiro removido');
    throw new Error('MixDrop: link não encontrado');
  }
  return wurl.startsWith('//') ? `https:${wurl}` : wurl;
}

module.exports = { resolveMixdrop, unpack };
