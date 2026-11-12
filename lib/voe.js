const { getText } = require('./http');

const HOST = 'https://novelasportuguesas.site';

const rot13 = (s) =>
  s.replace(/[a-z]/gi, (c) => {
    const n = c.charCodeAt(0) + 13;
    return String.fromCharCode((c <= 'Z' ? 90 : 122) >= n ? n : n - 26);
  });

/** Resolve a VOE file id (the player the TVParaPobres sites use) into a direct mp4 URL. */
async function resolveVoe(id) {
  const html = await getText(`${HOST}/e/${encodeURIComponent(id)}`);
  const payload = (html.match(/json">\s*\["([^"]+)/) || [])[1];
  if (!payload) throw new Error('VOE: link não encontrado');
  // The page hides its data: ROT13, junk markers, base64, a shift of 3 and a reversal.
  const b64 = rot13(payload).replace(/@\$|\^\^|~@|%\?|\*~|!!|#&/g, '');
  const shifted = [...Buffer.from(b64, 'base64').toString('latin1')]
    .map((c) => String.fromCharCode(c.charCodeAt(0) - 3))
    .reverse()
    .join('');
  const url = JSON.parse(Buffer.from(shifted, 'base64').toString()).direct_access_url;
  if (!url) throw new Error('VOE: link não encontrado');
  return url;
}

module.exports = { resolveVoe, HOST };
