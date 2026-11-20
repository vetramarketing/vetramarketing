// The test gateway terminates HTTPS; Next receives the external hostname, port and protocol.
const { createServer } = require('node:http');
const next = require('next');

(async () => {
  const origin = new URL(process.env.VETRA_WORKSPACE_ORIGIN);
  const app = next({ dev: false, hostname: origin.hostname, port: Number(origin.port) });
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
})().catch((error) => {
  process.send({ error: error.message });
  process.exitCode = 1;
});
