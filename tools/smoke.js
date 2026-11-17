'use strict';
/**
 * Starts the real server on a spare port and checks that the TV page, the
 * phone page and every script and stylesheet they load come back properly.
 *
 *   node tools/smoke.js
 */
const {spawn} = require('node:child_process');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {...process.env, PORT: String(PORT), REDIS_URL: '', STATE_FILE: path.join(require('node:os').tmpdir(), `smart-alec-smoke-${PORT}.json`)},
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];

async function get(url, wantType) {
  const res = await fetch(BASE + url);
  if (!res.ok) { failures.push(`${url} returned ${res.status}`); return ''; }
  const type = res.headers.get('content-type') || '';
  if (wantType && !type.includes(wantType)) failures.push(`${url} came back as ${type}, expected ${wantType}`);
  return res.text();
}

async function main() {
  // Wait up to 15 seconds for the server to answer.
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${BASE}/health`)).ok; } catch { await sleep(250); }
  }
  if (!up) throw new Error(`server did not start.\n${log}`);

  const health = JSON.parse(await get('/health', 'json'));
  const total = Object.values(health.questions || {}).reduce((a, b) => a + b, 0);
  if (!health.ok || !(total > 1000)) failures.push(`/health looks wrong: ${JSON.stringify(health)}`);

  for (const page of ['/tv/', '/play/', '/credits.html']) {
    const html = await get(page, 'text/html');
    // Every local script and stylesheet the page loads must exist.
    for (const m of html.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:js|css|webp|png|svg|woff2))"/g)) await get(m[1]);
  }
  await get('/api/layout', 'json');
}

main()
  .catch(err => failures.push(err.message))
  .finally(() => {
    server.kill('SIGTERM');
    if (failures.length) {
      console.error(`Smoke test: ${failures.length} problem(s)`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log('Smoke test OK: server starts, /health, TV page, phone page, credits and their files all load.');
    process.exit(0);
  });
