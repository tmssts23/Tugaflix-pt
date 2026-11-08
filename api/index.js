// Vercel entry point: every path is rewritten here (see vercel.json).
const { requestHandler } = require('../index');

module.exports = (req, res) => requestHandler(req, res);
