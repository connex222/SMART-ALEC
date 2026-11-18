'use strict';
/**
 * Rooms: lobby, seats, reconnection and host controls. Adapted from NOGGIN's
 * rooms.js; the game itself is in engine.js.
 */
const crypto = require('node:crypto');
const avatars = require('../public/shared/avatars.json');
const engine = require('./engine');
const {enforceFamilyText} = require('./content-filter');

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AVATAR_IDS = new Set(avatars.map(a => a.id));
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const LOBBY_GRACE_MS = 10 * 60_000;
const EMPTY_ROOM_TTL_MS = 60 * 60_000;
const MAX_ROOMS = 500;
const SETTINGS = Object.freeze({
  quickGame: v => typeof v === 'boolean',
  timeLimit: v => [0, 30, 45, 60].includes(v),
  timerSpeed: v => ['normal', 'sociable', 'relaxed'].includes(v),
  familyFriendly: v => typeof v === 'boolean',
  previewQuestions: v => typeof v === 'boolean',
  reduceMotion: v => typeof v === 'boolean',
  level: v => ['family', 'mixed', 'buffs'].includes(v),
});

class LobbyError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function assert(condition, code, message) { if (!condition) throw new LobbyError(code, message); }
function normalizeName(value) {
  const name = String(value || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  assert(name.length >= 1 && name.length <= 16, 'NAME', 'Use a name of 1 to 16 characters.');
  return name;
}
function normalizeCode(value) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  assert(code.length === 4, 'CODE', 'Room codes have four characters.');
  return code;
}
function safeTokenEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-zA-Z0-9_-]{32}$/.test(a) || !/^[a-zA-Z0-9_-]{32}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

class GameRooms {
  constructor({now = () => Date.now(), randomInt = crypto.randomInt} = {}) {
    this.now = now;
    this.randomInt = randomInt;
    this.rooms = new Map();
  }

  newCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let i = 0; i < 4; i += 1) code += ROOM_CHARS[this.randomInt(ROOM_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new LobbyError('CAPACITY', 'Could not make a room. Please retry.');
  }

  create(hostSocketId) {
    assert(this.rooms.size < MAX_ROOMS, 'CAPACITY', 'All rooms are busy; retry later.');
    const code = this.newCode();
    const room = {
      code, phase: 'lobby', createdAt: this.now(), updatedAt: this.now(),
      hostToken: crypto.randomBytes(24).toString('base64url'), hostSocketId,
      players: [], vipId: null, vipOfflineSince: null, board: null,
      settings: {quickGame: false, timeLimit: 0, timerSpeed: 'sociable', familyFriendly: true, previewQuestions: true, reduceMotion: false, level: 'mixed'},
    };
    this.rooms.set(code, room);
    return {code, token: room.hostToken, state: this.state(code, true)};
  }

  find(code) {
    const room = this.rooms.get(normalizeCode(code));
    assert(Boolean(room), 'ROOM', 'Room not found. Check the code on the TV.');
    return room;
  }

  state(code, forTv = false, viewerId = null) {
    const room = this.find(code);
    return {
      code: room.code, phase: room.phase, hostOnline: Boolean(room.hostSocketId),
      vipId: room.vipId || null, settings: {...room.settings}, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
      canStart: Boolean(room.hostSocketId) && room.players.length >= MIN_PLAYERS && room.players.every(p => p.ready) && room.players.some(p => p.socketId),
      serverNow: this.now(), you: viewerId, board: engine.publicBoard(room, forTv, viewerId),
      players: room.players.map(p => ({
        id: p.id, name: p.name, avatarId: p.avatarId, seat: p.seat, ready: p.ready, online: Boolean(p.socketId),
        position: p.position ?? 0, brains: p.brains ?? 0, tokens: p.tokens ? p.tokens.slice() : [],
      })),
    };
  }

  join({code, name, avatarId, socketId}) {
    const room = this.find(code);
    assert(room.phase === 'lobby', 'PHASE', 'This room is already playing.');
    assert(room.players.length < MAX_PLAYERS, 'FULL', 'The room already has eight players.');
    const safeName = enforceFamilyText(room, normalizeName(name));
    assert(!room.players.some(p => p.name.toLocaleLowerCase() === safeName.toLocaleLowerCase()), 'DUP_NAME', 'That name is already taken.');
    assert(Number.isInteger(avatarId) && AVATAR_IDS.has(avatarId), 'AVATAR', 'Choose a character first.');
    assert(!room.players.some(p => p.avatarId === avatarId), 'TAKEN', 'That character is taken. Choose another.');
    assert(typeof socketId === 'string' && socketId.length > 0, 'SOCKET', 'Connection not ready.');
    const player = {
      id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('base64url'),
      seat: Array.from({length: MAX_PLAYERS}, (_, i) => i + 1).find(seat => !room.players.some(p => p.seat === seat)),
      name: safeName, avatarId, ready: false, socketId, offlineSince: null,
    };
    room.players.push(player);
    if (!room.vipId) room.vipId = player.id;
    room.updatedAt = this.now();
    return {code: room.code, playerId: player.id, token: player.token, state: this.state(room.code, false, player.id)};
  }

  resume({code, token, socketId, role}) {
    const room = this.find(code);
    assert(typeof socketId === 'string' && socketId.length > 0, 'SOCKET', 'Connection not ready.');
    if (role === 'host') {
      assert(safeTokenEquals(token, room.hostToken), 'AUTH', 'Your TV session is no longer available.');
      const oldSocketId = room.hostSocketId;
      room.hostSocketId = socketId;
      room.updatedAt = this.now();
      return {code: room.code, role: 'host', oldSocketId, state: this.state(room.code, true)};
    }
    assert(role === 'player', 'AUTH', 'Invalid session.');
    const player = room.players.find(p => safeTokenEquals(token, p.token));
    assert(player, 'AUTH', 'Your seat is no longer available. Please join again.');
    if (room.phase === 'lobby' && !player.socketId && player.offlineSince !== null && this.now() - player.offlineSince > LOBBY_GRACE_MS) {
      room.players = room.players.filter(p => p !== player);
      if (room.vipId === player.id) { room.vipId = room.players.find(p => p.socketId)?.id || null; room.vipOfflineSince = null; }
      throw new LobbyError('EXPIRED', 'Your seat was held for 10 minutes and has been released. Please join again.');
    }
    const oldSocketId = player.socketId;
    player.socketId = socketId;
    player.offlineSince = null;
    if (room.vipId === player.id) room.vipOfflineSince = null;
    room.updatedAt = this.now();
    return {code: room.code, role: 'player', playerId: player.id, oldSocketId, state: this.state(room.code, false, player.id)};
  }

  confirmSeat({code, token, role, socketId}) {
    const room = typeof code === 'string' ? this.rooms.get(code.toUpperCase()) : null;
    if (!room || typeof socketId !== 'string' || !socketId) return null;
    if (role === 'host') {
      if (room.hostSocketId !== socketId || !safeTokenEquals(token, room.hostToken)) return null;
      return {code: room.code, role: 'host', state: this.state(room.code, true)};
    }
    if (role !== 'player') return null;
    const player = room.players.find(p => p.socketId === socketId);
    if (!player || !safeTokenEquals(token, player.token)) return null;
    return {code: room.code, role: 'player', playerId: player.id, state: this.state(room.code, false, player.id)};
  }

  callerState(code, socketId) {
    const room = this.find(code);
    const isTv = Boolean(socketId) && room.hostSocketId === socketId;
    const player = isTv ? null : room.players.find(p => p.socketId === socketId);
    return this.state(room.code, isTv, player ? player.id : null);
  }
  requirePlayer(code, socketId) {
    const room = this.find(code);
    const player = room.players.find(p => p.socketId === socketId);
    assert(player, 'AUTH', 'You are not seated in this room.');
    return {room, player};
  }
  requireHost(code, socketId) {
    const room = this.find(code);
    const vip = room.players.find(p => p.id === room.vipId);
    assert(room.hostSocketId === socketId || (vip && vip.socketId === socketId), 'AUTH', 'Only the TV or the first player can do that.');
    return room;
  }

  setAvatar(code, socketId, avatarId) {
    const {room, player} = this.requirePlayer(code, socketId);
    assert(room.phase === 'lobby', 'PHASE', 'Character choice has closed.');
    assert(Number.isInteger(avatarId) && AVATAR_IDS.has(avatarId), 'AVATAR', 'Invalid character.');
    assert(!room.players.some(p => p !== player && p.avatarId === avatarId), 'TAKEN', 'That character is taken.');
    player.avatarId = avatarId; player.ready = false; room.updatedAt = this.now();
    return this.callerState(code, socketId);
  }
  setReady(code, socketId, ready) {
    const {room, player} = this.requirePlayer(code, socketId);
    assert(room.phase === 'lobby', 'PHASE', 'You cannot ready up during a game.');
    assert(typeof ready === 'boolean', 'VALUE', 'Invalid ready status.');
    player.ready = ready; room.updatedAt = this.now();
    return this.callerState(code, socketId);
  }
  setSettings(code, socketId, patch) {
    const room = this.requireHost(code, socketId);
    assert(room.phase === 'lobby', 'PHASE', 'Settings are locked while playing.');
    assert(patch && typeof patch === 'object' && !Array.isArray(patch) && Object.keys(patch).length, 'SETTINGS', 'Invalid settings.');
    for (const [key, value] of Object.entries(patch)) assert(SETTINGS[key] && SETTINGS[key](value), 'SETTINGS', `Invalid setting: ${key}.`);
    Object.assign(room.settings, patch);
    room.updatedAt = this.now();
    return this.callerState(code, socketId);
  }

  disconnect(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) return false;
    if (room.hostSocketId === socketId) {
      room.hostSocketId = null;
      if (room.phase === 'board' && room.board && !Number.isFinite(room.board.pausedAt)) {
        engine.hostPause(room, this.now());
        room.board.pauseKind = 'tv';
      }
      room.updatedAt = this.now();
      return true;
    }
    const player = room.players.find(p => p.socketId === socketId);
    if (!player) return false;
    player.socketId = null;
    player.offlineSince = this.now();
    if (room.vipId === player.id) room.vipOfflineSince = this.now();
    room.updatedAt = this.now();
    return true;
  }
  leave(code, socketId) {
    const {room, player} = this.requirePlayer(code, socketId);
    assert(room.phase === 'lobby', 'PHASE', 'You cannot leave mid-game; close the page and rejoin later.');
    room.players = room.players.filter(p => p !== player);
    if (room.vipId === player.id) { room.vipId = room.players.find(p => p.socketId)?.id || null; room.vipOfflineSince = null; }
    room.updatedAt = this.now();
    return this.callerState(code, socketId);
  }

  assertGame(room) {
    assert(room.phase === 'board' && room.board, 'PHASE', 'The game is not running.');
    assert(!Number.isFinite(room.board.pausedAt), 'PAUSED', 'The game is paused.');
  }
  startGame(code, socketId) {
    const room = this.requireHost(code, socketId);
    assert(room.phase === 'lobby' || room.phase === 'over', 'PHASE', 'A game is already running.');
    if (room.phase === 'over') for (const p of room.players) p.ready = true;
    assert(room.players.length >= MIN_PLAYERS, 'PLAYERS', 'You need at least two players.');
    assert(room.players.every(p => p.ready), 'READY', 'Everyone needs to press READY.');
    engine.start(room, this.now(), this.randomInt);
    room.updatedAt = this.now();
    return this.callerState(code, socketId);
  }
  backToLobby(code, socketId) {
    const room = this.requireHost(code, socketId);
    // The TV host or VIP may end a game early to return everyone to the
    // same room. This is deliberately not available to ordinary phones.
    assert(['board','over','lobby'].includes(room.phase), 'PHASE', 'Cannot return to lobby from here.');
    room.phase = 'lobby'; room.board = null;
    for (const p of room.players) { p.ready = false; delete p.position; delete p.brains; delete p.tokens; }
    room.updatedAt = this.now();
    return this.callerState(code, socketId);
  }
  rollGame(code, socketId) { const {room, player} = this.requirePlayer(code, socketId); this.assertGame(room); engine.roll(room, player.id, this.now(), this.randomInt); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  chooseGame(code, socketId, payload) { const {room, player} = this.requirePlayer(code, socketId); this.assertGame(room); engine.choose(room, player.id, payload, this.now(), this.randomInt); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  answerGame(code, socketId, payload) { const {room, player} = this.requirePlayer(code, socketId); this.assertGame(room); engine.answer(room, player.id, payload, this.now()); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  inputGame(code, socketId, value, roundKey) { const {room, player} = this.requirePlayer(code, socketId); this.assertGame(room); engine.minigameInput(room, player.id, value, roundKey, this.now()); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  drawGame(code, socketId, points, roundKey) { const {room, player} = this.requirePlayer(code, socketId); this.assertGame(room); engine.minigameDraw(room, player.id, points, roundKey, this.now()); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  cheerGame(code, socketId, targetId) { const {room, player} = this.requirePlayer(code, socketId); this.assertGame(room); engine.cheer(room, player.id, targetId); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  // Bid to Win answers are judged by the TV or by any player who is not in the duel.
  adjudicateBid(code, socketId, accept) {
    const room = this.find(code); this.assertGame(room);
    assert(typeof accept === 'boolean', 'VALUE', 'Accept or reject the answer.');
    if (socketId !== room.hostSocketId) {
      const judge = room.players.find(p => p.socketId === socketId);
      assert(judge, 'AUTH', 'You are not seated in this room.');
      assert(!room.board.showdown?.participants.includes(judge.id), 'AUTH', 'Duellists cannot judge their own answers.');
    }
    engine.decideBid(room, accept, this.now());
    room.updatedAt = this.now();
    return this.callerState(code, socketId);
  }
  readyGame(code, socketId) { const {room, player} = this.requirePlayer(code, socketId); this.assertGameRunning(room); engine.playerReady(room, player.id, this.now()); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  nextTurnGame(code, socketId) { const room = this.requireHost(code, socketId); this.assertGameRunning(room); engine.hostNextTurn(room, this.now()); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  pauseGame(code, socketId) { const room = this.requireHost(code, socketId); engine.hostPause(room, this.now()); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  resumeGame(code, socketId) { const room = this.requireHost(code, socketId); assert(room.hostSocketId, 'TV', 'Reconnect the TV first.'); engine.hostResume(room, this.now()); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  skipDisconnectedGame(code, socketId) { const room = this.requireHost(code, socketId); this.assertGameRunning(room); engine.skipDisconnected(room, this.now(), this.randomInt); room.updatedAt = this.now(); return this.callerState(code, socketId); }
  assertGameRunning(room) { assert(room.phase === 'board' && room.board, 'PHASE', 'The game is not running.'); }
  close(code, socketId) { this.requireHost(code, socketId); this.rooms.delete(code); }

  sweep() {
    const changed = [];
    for (const room of this.rooms.values()) {
      if (room.vipOfflineSince != null && this.now() - room.vipOfflineSince >= 30_000) {
        const candidate = room.players.find(p => p.socketId && p.id !== room.vipId);
        if (candidate) { room.vipId = candidate.id; room.vipOfflineSince = null; changed.push(room.code); }
      }
      const oldLength = room.players.length;
      if (room.phase === 'lobby') room.players = room.players.filter(p => p.socketId || p.offlineSince === null || this.now() - p.offlineSince <= LOBBY_GRACE_MS);
      if (!room.players.some(p => p.id === room.vipId)) { room.vipId = room.players.find(p => p.socketId)?.id || null; room.vipOfflineSince = null; }
      if (room.players.length !== oldLength) changed.push(room.code);
      if (engine.tick(room, this.now(), this.randomInt)) changed.push(room.code);
      if (!room.hostSocketId && this.now() - room.updatedAt > EMPTY_ROOM_TTL_MS) { this.rooms.delete(room.code); changed.push(room.code); }
    }
    return [...new Set(changed)];
  }
}

module.exports = {GameRooms, LobbyError, normalizeName, normalizeCode, safeTokenEquals, MAX_PLAYERS};
