const assert = require('node:assert');
const { test } = require('node:test');
const dockerGuard = require('./docker-guard');

const net = (IPAddress, Gateway = '172.18.0.1') => ({ NetworkSettings: { Networks: { 'proxy-network': { IPAddress, Gateway } } } });
let list;
let fail;
const fakeDocker = { listContainers: async () => { if (fail) throw new Error('proxy down'); return list; } };

// Runs the middleware for a request from `ip`; resolves to the status (200 if it passed).
function from(guard, ip) {
  return new Promise((resolve) => {
    const res = { status: (code) => ({ json: () => resolve(code) }) };
    guard({ socket: { remoteAddress: ip } }, res, () => resolve(200));
  });
}

test('only the reverse proxy gets in from inside Docker', async () => {
  fail = false;
  list = [
    { Names: ['/nginx-proxy-manager'], ...net('172.18.0.2') },
    { Names: ['/gtnh-minecraft'], ...net('172.18.0.5') },
    { Names: ['/pihole'], ...net('172.18.0.6') },
  ];
  const guard = dockerGuard(fakeDocker);
  assert.strictEqual(await from(guard, '172.18.0.2'), 200); // NPM
  assert.strictEqual(await from(guard, '172.18.0.5'), 403); // a Minecraft server
  assert.strictEqual(await from(guard, '::ffff:172.18.0.5'), 403);
  assert.strictEqual(await from(guard, '172.18.0.6'), 403); // any other container
  assert.strictEqual(await from(guard, '172.18.0.1'), 403); // via the host's published port
  assert.strictEqual(await from(guard, '192.168.4.30'), 200); // LAN
  assert.strictEqual(await from(guard, '100.101.102.103'), 200); // Tailscale
});

test('a Docker outage keeps the last known list, and blocks nothing before the first', async () => {
  fail = true;
  assert.strictEqual(await from(dockerGuard(fakeDocker), '172.18.0.5'), 200);

  fail = false;
  list = [{ Names: ['/gtnh-minecraft'], ...net('172.18.0.5') }];
  const guard = dockerGuard(fakeDocker, { refreshMs: 0 });
  assert.strictEqual(await from(guard, '172.18.0.5'), 403);
  fail = true;
  assert.strictEqual(await from(guard, '172.18.0.5'), 403);
});
