// The dashboard has no login, so stop other websites from making changes
// through a visitor's browser (cross-site request forgery). Browsers mark
// every request with Sec-Fetch-Site; reads stay open, writes must come from
// this site or from a non-browser client (no header).
module.exports = function sameSiteWrites(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('Sec-Fetch-Site') === 'cross-site') {
    return res.status(403).json({ error: 'Changes must come from the dashboard itself' });
  }
  next();
};
