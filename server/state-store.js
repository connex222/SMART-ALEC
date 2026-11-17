'use strict';
/**
 * Save-and-restore for live games.
 *
 * Every few seconds the rooms are written to a store; when the server starts it
 * reads them back. Restored games come back paused, with every clock moved on by
 * the time the server was down, so nobody loses time. Phones and the TV rejoin
 * on their own (they keep their seat tokens), and the host presses Resume.
 *
 *   REDIS_URL set   -> Render Key Value (survives deploys and restarts)
 *   otherwise       -> a local file (survives a crash or restart on the same machine)
 */
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./engine');

const KEY = 'smart-alec:rooms:v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;       // older saves are ignored
const DEFAULT_FILE = path.join(__dirname, '..', 'runtime', 'rooms.json');

/* ---------- turning rooms into text and back ---------- */
function snapshot(rooms, now) {
  const list = [];
  for (const room of rooms.rooms.values()) {
    if (!room.players.length && room.phase === 'lobby') continue;   // nothing worth keeping
    list.push(room);
  }
  // Socket ids mean nothing after a restart, so drop them in the copy.
  return JSON.stringify({format: 1, savedAt: now, rooms: list}, (key, value) => (key === 'socketId' || key === 'hostSocketId' ? null : value));
}

function shiftClocks(g, delta) {
  const move = (obj, keys) => { if (obj) for (const k of keys) if (Number.isFinite(obj[k])) obj[k] += delta; };
  move(g, ['deadline', 'stepStartedAt', 'timeLimitAt', 'pausedAt', 'startedAt']);
  move(g.minigame, ['deadline', 'openAt', 'introUntil', 'stageStarted']);
  move(g.minigame?.display, ['readyAt', 'flashEndsAt', 'revealAt']);
  move(g.showdown, ['deadline', 'hardStop', 'openAt', 'startedAt', 'buzzWindowUntil']);
  if (g.question?.answers) for (const a of Object.values(g.question.answers)) move(a, ['at']);
  if (g.question?.along) for (const a of Object.values(g.question.along)) move(a, ['at']);
}

function load(rooms, text, now) {
  if (!text) return 0;
  const data = JSON.parse(text);
  if (data.format !== 1 || !Array.isArray(data.rooms) || !Number.isFinite(data.savedAt)) return 0;
  if (now - data.savedAt > MAX_AGE_MS) return 0;
  const delta = Math.max(0, now - data.savedAt);
  let count = 0;
  for (const room of data.rooms) {
    if (!room || typeof room.code !== 'string' || !/^[A-Z2-9]{4}$/.test(room.code) || !Array.isArray(room.players)) continue;
    if (rooms.rooms.has(room.code)) continue;
    room.hostSocketId = null;
    room.updatedAt = now;
    for (const p of room.players) { p.socketId = null; p.offlineSince = now; }
    if (room.phase === 'board' && room.board) {
      shiftClocks(room.board, delta);
      if (!Number.isFinite(room.board.pausedAt)) engine.hostPause(room, now);
      room.board.pauseKind = 'restored';
    }
    rooms.rooms.set(room.code, room);
    count += 1;
  }
  return count;
}

/* ---------- where the snapshot lives ---------- */
function fileBackend(filename) {
  return {
    name: `file ${filename}`,
    async read() { return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null; },
    async write(text) {
      fs.mkdirSync(path.dirname(filename), {recursive: true});
      const tmp = `${filename}.tmp`;
      fs.writeFileSync(tmp, text, {encoding: 'utf8', mode: 0o600});
      fs.renameSync(tmp, filename);
    },
    async close() {},
  };
}

function redisBackend(url) {
  const {createClient} = require('redis');
  const client = createClient({url, socket: {reconnectStrategy: tries => Math.min(tries * 500, 5000)}});
  let lastLogged = 0;
  client.on('error', err => { if (Date.now() - lastLogged > 60_000) { lastLogged = Date.now(); console.error('Key Value error (retrying quietly):', err.message); } });
  const ready = client.connect();
  return {
    name: 'Render Key Value',
    async read() { await ready; return client.get(KEY); },
    async write(text) { await ready; await client.set(KEY, text, {EX: Math.round(MAX_AGE_MS / 1000)}); },
    async close() { try { await ready; await client.quit(); } catch { /* already gone */ } },
  };
}

/**
 * Start saving. Restores any saved rooms first, then writes a snapshot every
 * few seconds and once more when Render shuts the server down.
 */
async function start(rooms, {intervalMs = 4000, onRestored} = {}) {
  const backend = process.env.REDIS_URL ? redisBackend(process.env.REDIS_URL) : fileBackend(process.env.STATE_FILE || DEFAULT_FILE);
  try {
    // Never let a slow or missing store stop the game from starting.
    const text = await Promise.race([backend.read(), new Promise(resolve => setTimeout(() => resolve(null), 5000))]);
    const count = load(rooms, text, Date.now());
    console.log(`Save-and-restore: ${backend.name}. Restored ${count} game(s).`);
    if (count && onRestored) onRestored(count);
  } catch (err) {
    console.error('Restore failed, starting fresh:', err.message);
  }
  let last = '';
  let busy = false;
  async function save() {
    if (busy) return;
    busy = true;
    try {
      const text = snapshot(rooms, Date.now());
      // Only write when something changed (the timestamp alone doesn't count).
      const body = text.slice(text.indexOf(',"rooms"'));
      if (body !== last) { await backend.write(text); last = body; }
    } catch (err) {
      console.error('Save failed:', err.message);
    } finally { busy = false; }
  }
  const timer = setInterval(save, intervalMs);
  timer.unref?.();
  async function stop() { clearInterval(timer); busy = false; await save(); await backend.close(); }
  return {save, stop, backend: backend.name};
}

module.exports = {start, snapshot, load, shiftClocks};
