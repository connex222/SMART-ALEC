'use strict';
const {GameRooms, LobbyError, normalizeCode, safeTokenEquals} = require('./rooms');
const {AttemptLimiter} = require('./limiter');
const stats = require('./stats');
const {joinUrl} = require('./network');
const {isIP} = require('node:net');

function attachGateway(io, {rooms = new GameRooms(), limiter = new AttemptLimiter(), QRCode} = {}) {
  if (!QRCode) throw new Error('Pass a QR generator to attachGateway.');
  const bindings = new Map();
  const roomSockets = new Map();
  const MAX_PAYLOAD = 512;
  // Respect a verified reverse proxy (e.g. Render), otherwise use the direct socket IP.
  function clientIp(socket) {
    const directIp = socket.handshake.address || socket.request.socket?.remoteAddress || 'unknown';
    if (!process.env.RENDER && process.env.TRUST_PROXY !== '1') return directIp;
    const forwarded = socket.handshake.headers?.['x-forwarded-for'] || socket.request.headers?.['x-forwarded-for'];
    const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
    return isIP(first) ? first : directIp;
  }

  function broadcast(code) {
    if (!rooms.rooms.has(code)) return;
    for (const socketId of roomSockets.get(code) || []) {
      const bound = bindings.get(socketId);
      if (!bound) continue;
      io.to(socketId).emit('room:state', rooms.state(code, bound.role === 'host',
        bound.role === 'player' ? bound.playerId : null));
    }
  }
  function unbind(socketId) {
    const old = bindings.get(socketId);
    if (!old) return;
    bindings.delete(socketId);
    const ids = roomSockets.get(old.code);
    if (ids) {
      ids.delete(socketId);
      if (!ids.size) roomSockets.delete(old.code);
    }
  }
  function leaveBinding(socket) {
    const old = bindings.get(socket.id);
    if (!old) return;
    rooms.disconnect(old.code, socket.id);
    socket.leave(old.code);
    unbind(socket.id);
    broadcast(old.code);
  }
  function bind(socket, code, role, playerId = null) {
    const old = bindings.get(socket.id);
    if (old && old.code !== code) leaveBinding(socket);
    bindings.set(socket.id, {code, role, playerId});
    if (!roomSockets.has(code)) roomSockets.set(code, new Set());
    roomSockets.get(code).add(socket.id);
    socket.join(code);
  }
  function getBound(socket, role) {
    const bound = bindings.get(socket.id);
    if (!bound || (role && bound.role !== role)) throw new LobbyError('AUTH', 'Not connected to the correct room.');
    return bound.code;
  }
  const wrap = (fn,maxPayload=512) => async (payload, callback) => {
    if (typeof callback !== 'function') return;
    try {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxPayload) {
        throw new LobbyError('INPUT', 'Invalid request.');
      }
      const response = await fn(payload);
      callback({ok: true, ...response});
    } catch (error) {
      callback({ok: false, code: (error.code && typeof error.code==='string') ? error.code : 'SERVER', message: (error.code && typeof error.code==='string') ? error.message : 'The server could not process that. Please retry.'});
    }
  };

  io.on('connection', socket => {
    socket.on('room:create', wrap(async () => {
      if (bindings.has(socket.id)) throw new LobbyError('AUTH', 'You already have a room.');
      if (!limiter.allow(`${clientIp(socket)}:create`, 4)) throw new LobbyError('RATE', 'Too many new rooms. Wait one minute.');
      // QR generation is transactional: no orphan room on a failed encoder.
      const result = rooms.create(socket.id);
      try {
        const link = joinUrl(socket.request, result.code);
        const qrDataUrl = await QRCode.toDataURL(link, {margin: 2, errorCorrectionLevel: 'M', width: 256, color: {dark: '#141A33', light: '#FFFFFFFF'}});
        bind(socket, result.code, 'host');
        broadcast(result.code);
        return {...result, joinUrl: link, qrDataUrl};
      }catch(error){rooms.rooms.delete(result.code);throw error;}
    }));

    socket.on('room:peek', wrap(async ({code}) => {
      const ip = clientIp(socket);
      if (!limiter.allow(`${ip}:peek`, 12)) throw new LobbyError('RATE', 'Too many room lookups. Wait one minute.');
      const roomCode = normalizeCode(code);
      if (rooms.find(roomCode).phase !== 'lobby') throw new LobbyError('PHASE', 'That game has already started. Ask the host for a new room.');
      return {state: rooms.state(roomCode)};
    }));

    socket.on('room:join', wrap(async ({code, name, avatarId}) => {
      const ip = clientIp(socket);
      if (!limiter.allow(`${ip}:join`, 32)) throw new LobbyError('RATE', 'Too many join attempts. Wait one minute and try again.');
      if (bindings.has(socket.id)) throw new LobbyError('AUTH', 'Leave your current room first.');
      const result = rooms.join({code, name, avatarId, socketId: socket.id});
      bind(socket, result.code, 'player',result.playerId);
      broadcast(result.code);
      return result;
    }));

    async function hostLink(roomCode) {
      const link=joinUrl(socket.request,roomCode);
      const qrDataUrl=await QRCode.toDataURL(link,{margin:2,errorCorrectionLevel:'M',width:256,color:{dark:'#141A33',light:'#FFFFFFFF'}});
      return {joinUrl:link,qrDataUrl};
    }

    socket.on('room:resume', wrap(async ({code, token, role}) => {
      const existing = bindings.get(socket.id);
      if (existing) {
        // D1: the same connection asking for the same seat again (for example a
        // second resume once the page has finished loading) is confirmed, not
        // rejected. Anything else still has to leave its current session first.
        const same = rooms.confirmSeat({code, token, role, socketId: socket.id});
        if (!same || same.code !== existing.code || same.role !== existing.role) {
          throw new LobbyError('BOUND','Leave your current session before resuming another.');
        }
        return {...same, ...(same.role === 'host' ? await hostLink(same.code) : {})};
      }
      // Validate the host token and generate the QR BEFORE taking the session
      // over. A QR encoder failure must not strand the original host socket.
      let extra = {};
      if (role === 'host') {
        const previous=rooms.find(code);
        if (!safeTokenEquals(token,previous.hostToken)) throw new LobbyError('AUTH','Your host session is no longer available.');
        extra=await hostLink(previous.code);
      }
      const result = rooms.resume({code, token, role, socketId: socket.id});
      if (result.oldSocketId && result.oldSocketId !== socket.id) {
        const older = io.sockets.sockets.get(result.oldSocketId);
        if (older) { older.emit('room:session-replaced'); older.leave(result.code); }
        unbind(result.oldSocketId);
      }
      bind(socket, result.code, result.role,result.playerId||null);
      broadcast(result.code);
      return {...result, ...extra};
    }));

    socket.on('room:avatar', wrap(async ({avatarId}) => {
      const code = getBound(socket, 'player');
      const state = rooms.setAvatar(code, socket.id, avatarId);
      broadcast(code); return {state};
    }));

    socket.on('room:ready', wrap(async ({ready}) => {
      const code = getBound(socket, 'player');
      const state = rooms.setReady(code, socket.id, ready);
      broadcast(code); return {state};
    }));

    socket.on('room:settings', wrap(async ({patch}) => {
      const code = getBound(socket);
      const state = rooms.setSettings(code, socket.id, patch);
      broadcast(code); return {state};
    }));

    socket.on('game:start', wrap(async () => {const code=getBound(socket);const state=rooms.startGame(code,socket.id);broadcast(code);return {state};}));
    socket.on('game:lobby', wrap(async () => {const code=getBound(socket);const state=rooms.backToLobby(code,socket.id);broadcast(code);return {state};}));
    socket.on('game:ready', wrap(async () => {const code=getBound(socket);const state=rooms.readyGame(code,socket.id);broadcast(code);return {state};}));
    socket.on('game:next-turn', wrap(async () => {const code=getBound(socket);const state=rooms.nextTurnGame(code,socket.id);broadcast(code);return {state};}));
    socket.on('game:pause', wrap(async () => {const code=getBound(socket);const state=rooms.pauseGame(code,socket.id);broadcast(code);return {state};}));
    socket.on('game:resume', wrap(async () => {const code=getBound(socket);const state=rooms.resumeGame(code,socket.id);broadcast(code);return {state};}));
    socket.on('game:skip-offline', wrap(async () => {const code=getBound(socket);const state=rooms.skipDisconnectedGame(code,socket.id);broadcast(code);return {state};}));
    socket.on('game:roll', wrap(async () => {const code=getBound(socket,'player');const state=rooms.rollGame(code,socket.id);broadcast(code);return {state};}));
    socket.on('game:choose', wrap(async ({action,option}) => {
      const code=getBound(socket,'player');
      const safe={action:typeof action==='string'?action.slice(0,16):undefined,option:typeof option==='string'?option.slice(0,16):(Number.isInteger(option)?option:undefined)};
      const state=rooms.chooseGame(code,socket.id,safe);broadcast(code);return {state};
    }));
    socket.on('game:cheer', wrap(async ({targetId}) => {const code=getBound(socket,'player');const state=rooms.cheerGame(code,socket.id,typeof targetId==='string'?targetId:'');broadcast(code);return {state};}));
    socket.on('game:bid-review', wrap(async ({accept}) => {const code=getBound(socket);const state=rooms.adjudicateBid(code,socket.id,accept);broadcast(code);return {state};}));
    socket.on('game:input', wrap(async ({value,roundKey}) => {
      const code=getBound(socket,'player');const state=rooms.inputGame(code,socket.id,value,roundKey);broadcast(code);
      // Settle a Buzzer collection window on time instead of waiting for the next sweep.
      const until=rooms.rooms.get(code)?.board?.showdown?.buzzWindowUntil;
      if(until){const wait=Math.max(0,until-Date.now())+5;setTimeout(()=>{if(!rooms.rooms.has(code))return;const changed=rooms.sweep();if(changed.includes(code))broadcast(code);},wait).unref?.();}
      return {state};
    }));
    socket.on('game:draw', wrap(async ({points,roundKey}) => {
      const code=getBound(socket,'player');
      const state=rooms.drawGame(code,socket.id,points,roundKey);
      const mini=state.board?.minigame,strokeCount=mini?.display?.strokes?.length;
      // Only the TV needs live drawing updates; reconnecting screens get every stroke in their snapshot.
      if(mini?.id==='sketch-sabotage'&&mini.phase==='play'&&strokeCount){
        for(const socketId of roomSockets.get(code)||[]) if(bindings.get(socketId)?.role==='host') io.to(socketId).emit('game:stroke',{code,roundKey,index:strokeCount-1,points});
      }
      return {state};
    },4096));
    socket.on('game:answer', wrap(async ({choice,text}) => {
      const code=getBound(socket,'player');
      const safe={choice:Number.isInteger(choice)?choice:undefined,text:typeof text==='string'?text.slice(0,80):undefined};
      const state=rooms.answerGame(code,socket.id,safe);broadcast(code);return {state};
    }));
    // Testing only: give every player tokens so the Final Round can be checked quickly.
    if (process.env.SMART_ALEC_DEBUG === '1' && process.env.NODE_ENV !== 'production') {
      socket.on('debug:tokens', wrap(async ({count}) => {
        const code = getBound(socket, 'host');
        const room = rooms.find(code);
        const cats = ['potluck', 'screen', 'music', 'sport', 'timeplace', 'brainbox'];
        for (const p of room.players) { p.tokens = cats.slice(0, Math.max(0, Math.min(6, Number(count) || 6))); p.brains = 12; }
        broadcast(code); return {};
      }));
      socket.on('debug:game', wrap(async ({id}) => {
        const code = getBound(socket, 'host');
        const room = rooms.find(code);
        require('./engine').debugStart(room, String(id || ''), Date.now());
        broadcast(code); return {};
      }));
      socket.on('debug:timeup', wrap(async () => {
        const room = rooms.find(getBound(socket, 'host'));
        if (room.board) room.board.timeLimitAt = Date.now();
        return {};
      }));
    }
    socket.on('room:leave', wrap(async () => {
      const code = getBound(socket, 'player');
      rooms.leave(code, socket.id);
      unbind(socket.id);
      socket.leave(code);
      broadcast(code);
      return {};
    }));

    socket.on('room:close', wrap(async () => {
      const code = getBound(socket);
      rooms.close(code, socket.id);
      io.to(code).emit('room:closed');
      for (const id of [...(roomSockets.get(code) || [])]) unbind(id);
      io.in(code).socketsLeave(code);
      return {};
    }));

    // End-of-game feedback from a phone: checked, trimmed, logged and kept.
    socket.on('game:feedback', (payload, ack) => {
      try {
        const bound = bindings.get(socket.id);
        if (!bound || bound.role !== 'player') throw new Error('not a player');
        const {room, player} = rooms.requirePlayer(bound.code, socket.id);
        if (room.phase !== 'over' || !payload || typeof payload !== 'object') throw new Error('not now');
        const g = room.board || {};
        g.feedbackFrom = g.feedbackFrom || [];
        if (g.feedbackFrom.includes(player.id)) throw new Error('already sent');
        const BEST = ['Bonus Steal', 'Play along', 'Mini-games', 'Showdowns', 'Special spaces', 'Final Round', 'Alec', 'The questions'];
        const DRAG = ['Too long', 'Waiting for my turn', 'Rules confusing', 'Questions too hard', 'Questions too easy', 'Mini-games', 'Phone fiddly', 'Sound or music'];
        const pickFrom = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter(x => allowed.includes(x)))].slice(0, 6) : []);
        const fun = Number.isInteger(payload.fun) && payload.fun >= 1 && payload.fun <= 5 ? payload.fun : null;
        const note = String(payload.note || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
        const entry = {
          at: new Date().toISOString().slice(0, 16), fun, best: pickFrom(payload.best, BEST), drag: pickFrom(payload.drag, DRAG), note,
          players: room.players.length, minutes: g.startedAt && g.endedAt ? Math.round((g.endedAt - g.startedAt) / 60000) : null,
          turns: g.turnNo || null, ended: g.endReason || 'final', quick: Boolean(room.settings.quickGame), level: room.settings.level || 'mixed',
        };
        g.feedbackFrom.push(player.id);
        stats.addFeedback(entry);
        console.log(`[feedback] ${JSON.stringify(entry)}`);
        if (typeof ack === 'function') ack({ok: true});
      } catch (err) {
        if (typeof ack === 'function') ack({ok: false, message: err.message});
      }
    });

    // A TV or phone reports a browser error. Logged (trimmed, and at most 10 per
    // connection) so problems on real devices show up in the Render logs.
    let reported = 0;
    socket.on('client:error', report => {
      if (reported >= 10 || !report || typeof report !== 'object') return;
      reported += 1;
      const clip = (v, n) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
      const bound = bindings.get(socket.id);
      const who = bound ? `${bound.code} ${bound.role}` : 'no room';
      console.error(`[client error] ${who} | ${clip(report.where, 20)} | ${clip(report.message, 300)} | ${clip(report.source, 120)} | ${clip(report.agent, 120)}`);
    });

    socket.on('disconnect', () => leaveBinding(socket));
  });

  const interval = setInterval(() => {
    const changed = rooms.sweep();
    for (const code of changed) if (rooms.rooms.has(code)) broadcast(code); else io.to(code).emit('room:closed');
    limiter.sweep();
  }, 250);
  interval.unref?.();
  return {rooms, limiter, stop: () => clearInterval(interval)};
}
module.exports = {attachGateway};
