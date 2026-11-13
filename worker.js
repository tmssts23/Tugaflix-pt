// Cloudflare Workers entry point (see wrangler.toml). Same addon as the Node server, in lib/addon.js.
// Workers have no duration limit while a client is downloading, so video is not cut into pieces.
import addon from './lib/addon.js';

export default {
  fetch(request) {
    return addon.handle(request);
  },
};
