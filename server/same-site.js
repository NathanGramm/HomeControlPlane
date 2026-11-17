// The dashboard has no login, so stop other websites from making changes
// through a visitor's browser (cross-site request forgery). Browsers mark
// every request with Sec-Fetch-Site; reads stay open, writes must come from
// this exact origin or from a non-browser client (no header). "same-site" is
// refused too: it covers every *.marshmallowmc.com app, not just this one.
const ALLOWED = ['same-origin', 'none', undefined];

module.exports = function sameSiteWrites(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !ALLOWED.includes(req.get('Sec-Fetch-Site'))) {
    return res.status(403).json({ error: 'Changes must come from the dashboard itself' });
  }
  next();
};
