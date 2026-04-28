// Minimal Gun WebSocket relay. Designed to run in a tiny Docker container
// behind a reverse proxy (or directly on a low-traffic VPS). Persists data
// via radisk under data/gun.

const Gun = require('gun');
require('gun/lib/store');
require('gun/lib/rfs');
const fs = require('fs');
const path = require('path');

const port = parseInt(process.env.PORT || '8765', 10);
const dataDir = path.join(__dirname, 'data', 'gun');
fs.mkdirSync(dataDir, { recursive: true });
process.chdir(__dirname);

const server = require('http').createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('PHAROS Gun relay running');
});

Gun({
  web: server,
  file: 'data/gun',
  radisk: true,
  localStorage: false,
});

server.listen(port, () => {
  console.log(`[gun-relay] listening on :${port}`);
});
