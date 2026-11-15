'use strict';
/**
 * Plays many full games with bots and a fake clock, to prove no game can get
 * stuck and to measure game length. Usage: node tools/simulate.js 300
 */
const crypto = require('node:crypto');
const engine = require('../server/engine');
const Q = require('../server/questions');

function makeRoom(n, settings = {}) {
  return {
    code: 'TEST', phase: 'lobby', settings: {quickGame: false, timeLimit: 0, timerSpeed: 'normal', previewQuestions: true, ...settings},
    players: Array.from({length: n}, (_, i) => ({id: 'p' + i, name: 'Bot' + i, seat: i + 1, socketId: 's' + i, skill: 0.45 + Math.random() * 0.35})),
  };
}

function botAct(room, now, rng) {
  const g = room.board;
  const active = room.players.find(p => p.id === g.activeId);
  const pick = n => rng(n);
  const tryIt = fn => { try { fn(); return true; } catch (e) { if (!['STEP', 'TURN', 'DONE'].includes(e.code)) throw e; return false; } };
  switch (g.step) {
    case 'turn': return tryIt(() => g.canFinal ? engine.choose(room, active.id, {action: 'final'}, now, rng) : engine.roll(room, active.id, now, rng)) ;
    case 'direction': return tryIt(() => engine.choose(room, active.id, {option: pick(g.moveOptions.length)}, now, rng));
    case 'risk': return tryIt(() => engine.choose(room, active.id, {option: Math.random() < 0.3 ? 'smart' : 'safe'}, now, rng));
    case 'special': return tryIt(() => engine.choose(room, active.id, {option: pick(g.special.options.length)}, now, rng));
    case 'question': {
      const q = Q.get(g.question.id);
      const right = Math.random() < active.skill;
      if (g.question.mode === 'typed') return tryIt(() => engine.answer(room, active.id, {text: right ? q.answer : 'no idea'}, now));
      return tryIt(() => engine.answer(room, active.id, {choice: right ? q.correct : (q.correct + 1) % q.opts.length}, now));
    }
    case 'steal': case 'group': {
      const q = Q.get(g.question.id);
      for (const id of g.question.participants) {
        if (g.step !== 'steal' && g.step !== 'group') break;
        if (g.question.answers[id]) continue;
        const p = room.players.find(x => x.id === id);
        tryIt(() => engine.answer(room, id, {choice: Math.random() < p.skill ? q.correct : rng(q.opts.length)}, now + rng(5000)));
      }
      return true;
    }
    case 'predict':
      for (const p of room.players) if (p.id !== g.final.playerId && g.step === 'predict') tryIt(() => engine.choose(room, p.id, {option: rng(g.final.ids.length + 1)}, now, rng));
      return true;
    case 'final': {
      const q = Q.get(g.final.ids[g.final.index]);
      const p = room.players.find(x => x.id === g.final.playerId);
      return tryIt(() => engine.answer(room, p.id, {choice: Math.random() < p.skill + 0.15 ? q.correct : (q.correct + 1) % q.opts.length}, now));
    }
    default: return false;
  }
}

function playOne(n, settings) {
  const room = makeRoom(n, settings);
  const rng = crypto.randomInt;
  let now = 1_000_000;
  engine.start(room, now, rng);
  room.board.canFinal = false;
  let actions = 0;
  for (let i = 0; i < 200000 && room.phase === 'board'; i++) {
    const pub = engine.publicBoard(room, true);
    room.board.canFinal = pub.canFinal;
    if (Math.random() < 0.85) botAct(room, now, rng);
    actions++;
    now += 400 + rng(1500);
    engine.tick(room, now, rng);
  }
  if (room.phase !== 'over') throw new Error('Game did not finish');
  return {minutes: (now - 1_000_000) / 60000, turns: room.board.turnNo, reason: room.board.endReason};
}

if (require.main === module) {
  const games = Number(process.argv[2]) || 100;
  for (const [n, settings] of [[2, {}], [4, {}], [6, {}], [8, {}], [4, {quickGame: true}], [4, {timeLimit: 45}]]) {
    const results = Array.from({length: Math.max(1, Math.round(games / 6))}, () => playOne(n, settings));
    const avg = k => (results.reduce((s, r) => s + r[k], 0) / results.length).toFixed(1);
    const max = Math.max(...results.map(r => r.minutes)).toFixed(0);
    const byTime = results.filter(r => r.reason === 'time').length;
    console.log(`${n} players ${JSON.stringify(settings)}: ${results.length} games, avg ${avg('minutes')} min (max ${max}), ${avg('turns')} turns, ${byTime} ended on time`);
  }
}
module.exports = {playOne};
