const Docker = require('dockerode');

// Shared Docker client for all routes. Phase 2 talks to a scoped
// docker-socket-proxy over TCP (DOCKER_HOST=tcp://docker-socket-proxy:2375)
// rather than mounting the raw socket into this container — see
// stacks/dashboard/compose.yml for why. Falls back to a local socket path for
// anyone running this outside that compose stack (e.g. `npm start` on a
// machine that does have a local Docker daemon).
function createClient() {
  const dockerHost = process.env.DOCKER_HOST;
  if (dockerHost) {
    const url = new URL(dockerHost);
    return new Docker({ host: url.hostname, port: Number(url.port) || 2375 });
  }
  return new Docker({ socketPath: '/var/run/docker.sock' });
}

// Creating the client doesn't connect, so this only throws on a malformed
// DOCKER_HOST, and failing at startup is the right answer then.
module.exports = createClient();
