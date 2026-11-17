const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const sameSiteWrites = require('./same-site');

test('writes from other websites are refused; reads and own-site writes pass', async () => {
  const app = express();
  app.use(sameSiteWrites);
  app.all('/x', (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/x`;
  const status = (method, site) => fetch(url, { method, headers: site ? { 'Sec-Fetch-Site': site } : {} }).then((r) => r.status);
  try {
    assert.strictEqual(await status('POST', 'cross-site'), 403);
    assert.strictEqual(await status('DELETE', 'cross-site'), 403);
    assert.strictEqual(await status('GET', 'cross-site'), 200);
    assert.strictEqual(await status('POST', 'same-origin'), 200);
    assert.strictEqual(await status('POST'), 200);
  } finally {
    server.close();
  }
});
