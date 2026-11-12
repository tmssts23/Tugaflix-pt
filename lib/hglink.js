const { getText } = require('./http');
const { unpack } = require('./mixdrop');

// hglink.to/e/<id> is only a loader; the player page (StreamHG) lives on one of these hosts.
const HOSTS = ['https://vibuxer.com', 'https://streamhg.com'];

/** Resolve a hglink file id (the player of some TVParaPobres films) into the URL of its HLS master playlist. */
async function resolveHglink(id) {
  let last;
  for (const host of HOSTS) {
    try {
      const code = unpack(await getText(`${host}/e/${encodeURIComponent(id)}`));
      const url = code && (code.match(/"hls2":"([^"]+)"/) || [])[1];
      if (url) return url;
      last = new Error('hglink: link não encontrado');
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

module.exports = { resolveHglink };
