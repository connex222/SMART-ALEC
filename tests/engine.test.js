'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/engine');
const L = require('../server/board-layout');
const Q = require('../server/questions');
const {playOne} = require('../tools/simulate');

function room(n = 3, settings = {}) {
  return {
    code: 'TEST', phase: 'lobby',
    settings: {quickGame: false, timeLimit: 0, timerSpeed: 'normal', previewQuestions: true, ...settings},
    players: Array.from({length: n}, (_, i) => ({id: 'p' + i, name: 'P' + i, seat: i + 1, socketId: 's' + i})),
  };
}
// A fixed "random" source: returns the values given, then 0.
function seq(...values) { let i = 0; return n => Math.min(n - 1, values[i++] ?? 0); }
function toTurn(r, now = 0) { engine.start(r, now, seq()); engine.tick(r, now + engine.T.INTRO, seq()); return now + engine.T.INTRO; }

test('board has 64 spaces: 8 specials and 8 of each of 7 types', () => {
  assert.equal(L.SPACES.length, 64);
  const count = {};
  for (const s of L.SPACES) count[s.type] = (count[s.type] || 0) + 1;
  for (const t of ['potluck', 'screen', 'music', 'sport', 'timeplace', 'brainbox', 'minigame']) assert.equal(count[t], 8, t);
  assert.deepEqual(L.SPECIALS.map(s => s.index), [0, 8, 16, 24, 32, 40, 48, 56]);
});

test('leaving GO anticlockwise does not pay the GO bonus; passing it does', () => {
  assert.equal(L.passesGo(0, 3, -1), false);
  assert.equal(L.passesGo(2, 3, -1), true);
  assert.equal(L.passesGo(62, 3, 1), true);
  assert.equal(L.passesGo(10, 3, 1), false);
});

test('a roll offers clockwise and anticlockwise landings', () => {
  const r = room();
  const now = toTurn(r);
  engine.roll(r, 'p0', now, seq(2)); // die shows 3
  assert.equal(r.board.step, 'direction');
  assert.deepEqual(r.board.moveOptions.map(o => o.target).sort((a, b) => a - b), [3, 61]);
});

test('only the active player can roll', () => {
  const r = room();
  const now = toTurn(r);
  assert.throws(() => engine.roll(r, 'p1', now, seq()), {code: 'TURN'});
});

test('Play Safe right answer wins the token; wrong answer opens the Bonus Steal', () => {
  const r = room();
  let now = toTurn(r);
  engine.roll(r, 'p0', now, seq(0)); // a 1
  const opt = r.board.moveOptions.findIndex(o => o.target === 1); // space 1 is a category
  engine.choose(r, 'p0', {option: opt}, now);
  now += 5000; engine.tick(r, now, seq()); // moving -> landed
  now += 5000; engine.tick(r, now, seq()); // landed -> risk
  assert.equal(r.board.step, 'risk');
  const cat = r.board.question.category;
  engine.choose(r, 'p0', {option: 'safe'}, now, seq());
  const q = Q.get(r.board.question.id);
  engine.answer(r, 'p0', {choice: q.correct}, now + 1000);
  assert.ok(r.players[0].tokens.includes(cat));
  assert.equal(r.board.step, 'reveal');
});

test('a wrong answer goes up for grabs and the fastest correct steals 2 Brains', () => {
  const r = room();
  let now = toTurn(r);
  engine.roll(r, 'p0', now, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 1)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  engine.choose(r, 'p0', {option: 'safe'}, now, seq());
  const q = Q.get(r.board.question.id);
  engine.answer(r, 'p0', {choice: (q.correct + 1) % q.opts.length}, now + 500);
  now += 5000; engine.tick(r, now, seq());
  assert.equal(r.board.step, 'steal');
  assert.throws(() => engine.answer(r, 'p0', {choice: q.correct}, now), {code: 'TURN'});
  engine.answer(r, 'p2', {choice: q.correct}, now + 100);
  engine.answer(r, 'p1', {choice: q.correct}, now + 900);
  assert.equal(r.board.step, 'groupReveal');
  assert.equal(r.players[2].brains, 2);
  assert.equal(r.players[1].brains, 1);
  assert.equal(r.players[0].tokens.length, 0);
});

test('typed answers forgive small spelling slips', () => {
  const q = Q.ALL.find(x => x.answer.length >= 8 && /^[A-Za-z ]+$/.test(x.answer));
  assert.equal(Q.markTyped(q.id, q.answer.toLowerCase()), true);
  const slip = q.answer.slice(0, -1) + (q.answer.endsWith('x') ? 'y' : 'x');
  assert.equal(Q.markTyped(q.id, slip), true);
  assert.equal(Q.markTyped(q.id, 'completely different'), false);
});

test('the Final Round needs every token and wins with 5 of 6', () => {
  const r = room(2);
  let now = toTurn(r);
  assert.throws(() => engine.choose(r, 'p0', {action: 'final'}, now, seq()), {code: 'FINAL'});
  r.players[0].tokens = L.CATEGORY_IDS.slice();
  engine.choose(r, 'p0', {action: 'final'}, now, seq());
  assert.equal(r.board.step, 'predict');
  engine.choose(r, 'p1', {option: 6}, now);
  assert.equal(r.board.step, 'final');
  const q0 = Q.get(r.board.final.ids[0]);
  engine.answer(r, 'p0', {choice: (q0.correct + 1) % q0.opts.length}, now);   // one miss is allowed
  for (let i = 1; i < 6; i++) engine.answer(r, 'p0', {choice: Q.get(r.board.final.ids[i]).correct}, now + i * 100);
  assert.equal(r.board.step, 'finalResult');
  assert.equal(r.board.final.outcome, 'win');
  assert.equal(r.players[1].brains, 0); // predicted 6, got 5
  now += 10000; engine.tick(r, now, seq());
  assert.equal(r.phase, 'over');
  assert.equal(r.board.winnerId, 'p0');
});

test('two misses end the Final Round, and no token is lost', () => {
  const r = room(2);
  const now = toTurn(r);
  r.players[0].tokens = L.CATEGORY_IDS.slice();
  engine.choose(r, 'p0', {action: 'final'}, now, seq());
  engine.choose(r, 'p1', {option: 0}, now);
  for (let i = 0; i < 2; i++) { const q = Q.get(r.board.final.ids[i]); engine.answer(r, 'p0', {choice: (q.correct + 1) % q.opts.length}, now); }
  assert.equal(r.board.final.outcome, 'lose');
  assert.equal(r.board.step, 'finalResult');
  assert.equal(r.players[0].tokens.length, 6);
  assert.equal(r.players[1].brains, 2); // predicted 0, got 0
});

test('the answer is never sent before the reveal', () => {
  const r = room();
  let now = toTurn(r);
  engine.roll(r, 'p0', now, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 1)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  engine.choose(r, 'p0', {option: 'smart'}, now, seq());
  const tv = engine.publicBoard(r, true);
  assert.equal(tv.question.correct, undefined);
  assert.equal(tv.question.answer, undefined);
  assert.equal(tv.question.options, null);    // typed question: the TV shows no options
  const along = engine.publicBoard(r, false, 'p1');
  assert.equal(along.question.correct, undefined);
  assert.equal(along.question.answer, undefined);
  assert.equal(along.question.options.length >= 2, true);   // others get options privately to play along
  const active = engine.publicBoard(r, false, 'p0');
  assert.equal(active.question.options, null); // the player going Smart never sees options
});

test('pause freezes the clock', () => {
  const r = room();
  const now = toTurn(r);
  engine.hostPause(r, now + 1000);
  assert.equal(engine.tick(r, now + 999999, seq()), false);
  engine.hostResume(r, now + 999999);
  assert.ok(r.board.deadline > now + 999999);
});

test('bots finish full games without getting stuck', () => {
  for (const [n, s] of [[2, {}], [5, {}], [3, {quickGame: true}], [4, {timeLimit: 30}]]) {
    const result = playOne(n, s);
    assert.ok(result.turns > 0);
  }
});

test('a Mini-game space starts a NOGGIN mini-game and pays winners in Brains', () => {
  const r = room(3);
  let now = toTurn(r);
  r.players[0].position = 6;
  engine.roll(r, 'p0', now, seq(0)); // a 1
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 7)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  assert.equal(r.board.step, 'minigame');
  assert.ok(r.board.minigame.id);
  const pub = engine.publicBoard(r, true);
  assert.ok(pub.minigame && pub.minigame.title);
  for (let i = 0; i < 400 && r.board.step === 'minigame'; i++) { now += 1000; engine.tick(r, now, seq()); }
  assert.equal(r.board.step, 'miniResult');
  now += 10000; engine.tick(r, now, seq());
  assert.equal(r.board.step, 'turnEnd');
});

test('the Showdown space runs a NOGGIN Showdown between two players', () => {
  const r = room(3);
  let now = toTurn(r);
  r.players[0].position = 55;
  engine.roll(r, 'p0', now, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 56)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  assert.equal(r.board.step, 'special');
  engine.choose(r, 'p0', {option: 0}, now, seq(0));
  assert.equal(r.board.step, 'showdown');
  assert.deepEqual(r.board.showdown.participants, ['p0', r.board.special.options[0].targetId]);
  engine.cheer(r, 'p2', 'p0');
  for (let i = 0; i < 400 && r.board.step === 'showdown'; i++) { now += 1000; engine.tick(r, now, seq()); }
  assert.equal(r.board.step, 'miniResult');
});

test('pausing during a mini-game moves its clocks on', () => {
  const r = room(3);
  let now = toTurn(r);
  r.players[0].position = 6;
  engine.roll(r, 'p0', now, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 7)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  const before = r.board.minigame.deadline;
  engine.hostPause(r, now);
  engine.hostResume(r, now + 60000);
  assert.equal(r.board.minigame.deadline, before + 60000);
});

test('play-along answers count first in the Bonus Steal', () => {
  const r = room(3);
  let now = toTurn(r);
  engine.roll(r, 'p0', now, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 1)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  engine.choose(r, 'p0', {option: 'safe'}, now, seq());
  const q = Q.get(r.board.question.id);
  engine.answer(r, 'p2', {choice: q.correct}, now + 100);      // plays along, right
  engine.answer(r, 'p1', {choice: q.correct}, now + 300);      // plays along, right but slower
  assert.equal(r.board.step, 'question');                      // still the active player's question
  engine.answer(r, 'p0', {choice: (q.correct + 1) % q.opts.length}, now + 900);
  now += 5000; engine.tick(r, now, seq());                     // reveal -> steal, settled at once
  assert.equal(r.board.step, 'groupReveal');
  assert.equal(r.players[2].brains, 2);
  assert.equal(r.players[1].brains, 1);
});

test('play-along answers win nothing when the active player is right', () => {
  const r = room(3);
  let now = toTurn(r);
  engine.roll(r, 'p0', now, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 1)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  engine.choose(r, 'p0', {option: 'safe'}, now, seq());
  const q = Q.get(r.board.question.id);
  engine.answer(r, 'p1', {choice: q.correct}, now + 100);
  engine.answer(r, 'p0', {choice: q.correct}, now + 900);
  now += 5000; engine.tick(r, now, seq());
  assert.equal(r.board.step, 'turnEnd');
  assert.equal(r.players[1].brains, 0);
});

test('a saved game comes back paused with its clocks moved on', () => {
  const {GameRooms} = require('../server/rooms');
  const store = require('../server/state-store');
  const a = new GameRooms();
  const r = room(3);
  r.code = 'ABCD'; r.hostSocketId = 'tv'; r.players.forEach(p => { p.token = 't'.repeat(32); p.avatarId = 1; p.ready = true; });
  let now = toTurn(r);
  a.rooms.set('ABCD', r);
  const text = store.snapshot(a, now);
  assert.equal(text.includes('"socketId":"s0"'), false);         // live connections are not saved
  const b = new GameRooms();
  const later = now + 60_000;
  assert.equal(store.load(b, text, later), 1);
  const back = b.rooms.get('ABCD');
  assert.equal(back.board.paused === undefined, true);
  assert.ok(Number.isFinite(back.board.pausedAt));
  assert.equal(back.board.pauseKind, 'restored');
  assert.equal(back.board.remaining, r.board.deadline - now);     // no time lost while the server was down
  assert.equal(back.players[0].socketId, null);
  assert.equal(back.players[0].tokens.length, r.players[0].tokens.length);
});

test('Family games never pick hard questions, and the Final Round avoids them too', () => {
  const r = room(2, {level: 'family'});
  toTurn(r);
  for (let i = 0; i < 200; i++) {
    const id = Q.pick(r, L.CATEGORY_IDS[i % 6]);
    assert.notEqual(Q.get(id).level, 'hard');
  }
  const m = room(2, {level: 'mixed'});
  toTurn(m);
  for (let i = 0; i < 100; i++) assert.notEqual(Q.get(Q.pick(m, 'screen', undefined, {finalRound: true})).level, 'hard');
});
