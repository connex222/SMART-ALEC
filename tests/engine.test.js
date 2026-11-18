'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/engine');
const L = require('../server/board-layout');
const Q = require('../server/questions');
const {playOne} = require('../tools/simulate');
const stats = require('../server/stats');
// Every test starts with no memory of earlier games.
test.beforeEach(() => stats.reset());

function room(n = 3, settings = {}) {
  return {
    code: 'TEST', phase: 'lobby',
    settings: {quickGame: false, timeLimit: 0, timerSpeed: 'normal', previewQuestions: true, ...settings},
    players: Array.from({length: n}, (_, i) => ({id: 'p' + i, name: 'P' + i, seat: i + 1, socketId: 's' + i})),
  };
}
// A fixed "random" source: returns the values given, then 0.
function seq(...values) { let i = 0; return n => Math.min(n - 1, values[i++] ?? 0); }
// Start a game and skip the welcome screen (its length depends on the pace).
function toTurn(r, now = 0) { engine.start(r, now, seq()); const t = r.board.deadline; engine.tick(r, t, seq()); return t; }

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

test('questions asked in one game are avoided in the next', () => {
  const first = room(2, {level: 'mixed'});
  toTurn(first);
  const asked = new Set();
  for (let i = 0; i < 60; i++) asked.add(Q.pick(first, 'potluck'));
  const second = room(2, {level: 'mixed'});
  toTurn(second);
  for (let i = 0; i < 60; i++) assert.equal(asked.has(Q.pick(second, 'potluck')), false);
});

test('when every question is recent, the ones asked longest ago come back first', () => {
  const r = room(2, {level: 'mixed'});
  toTurn(r);
  const pool = Q.ALL.filter(q => q.category === 'sport').map(q => q.id);
  pool.forEach(id => stats.markAsked(id));           // all asked, in this order
  // Each pick is also removed from this game, so allow the window to move on by the picks made.
  const oldest = new Set(pool.slice(0, Math.ceil(pool.length / 5) + 20));
  for (let i = 0; i < 20; i++) assert.ok(oldest.has(Q.pick(r, 'sport')));
  const newest = new Set(pool.slice(-Math.ceil(pool.length / 2)));
  assert.equal([...newest].some(id => r.board.usedQuestions.includes(id)), false);   // the newest half never comes back
});

test('difficulty is learned once a question has enough answers', () => {
  const q = Q.ALL.find(x => x.level === 'medium');
  for (let i = 0; i < stats.MIN_ATTEMPTS - 1; i++) stats.record(q.id, true);
  assert.equal(stats.levelOf(q), 'medium');          // not enough answers yet
  stats.record(q.id, true);
  assert.equal(stats.levelOf(q), 'easy');            // everyone gets it right
  for (let i = 0; i < 30; i++) stats.record(q.id, false);
  assert.equal(stats.levelOf(q), 'hard');            // now most get it wrong
});

test('the engine records the active player and play-along answers, and stats survive a restart', () => {
  const r = room(3);
  let now = toTurn(r);
  engine.roll(r, 'p0', now, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 1)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  engine.choose(r, 'p0', {option: 'safe'}, now, seq());
  const id = r.board.question.id, q = Q.get(id);
  engine.answer(r, 'p1', {choice: q.correct}, now + 100);
  engine.answer(r, 'p0', {choice: q.correct}, now + 900);
  now += 5000; engine.tick(r, now, seq());
  const saved = JSON.parse(stats.snapshot());
  assert.deepEqual(saved.results[id], [2, 2]);        // active player + one play-along, both right
  stats.reset();
  assert.ok(stats.load(JSON.stringify(saved)));
  assert.equal(stats.isRecent(id), true);
  assert.deepEqual(JSON.parse(stats.snapshot()).results[id], [2, 2]);
});

test('player feedback is totted up and survives a restart', () => {
  stats.addFeedback({fun: 5, best: ['Final Round'], drag: [], note: 'Great'});
  stats.addFeedback({fun: 3, best: ['Final Round', 'Alec'], drag: ['Too long'], note: ''});
  const s = stats.feedbackSummary();
  assert.equal(s.responses, 2);
  assert.equal(s.averageFun, 4);
  assert.equal(s.bestBits['Final Round'], 2);
  assert.deepEqual(s.latestNotes, ['Great']);
  const saved = stats.snapshot();
  stats.reset();
  stats.load(saved);
  assert.equal(stats.feedbackSummary().responses, 2);
});

test('new rooms start at the Sociable pace', () => {
  const {GameRooms} = require('../server/rooms');
  const rooms = new GameRooms({now: () => 100, randomInt: () => 0});
  assert.equal(rooms.create('tv-host').state.settings.timerSpeed, 'sociable');
});

test('leisurely turns keep questions and answers visible, and only the host can safely advance between turns', () => {
  const r = room(3, {timerSpeed: 'relaxed'});
  const start = 100000;
  engine.start(r, start, seq());
  assert.equal(r.board.deadline - start, 6500);
  engine.tick(r, r.board.deadline, seq());
  assert.equal(r.board.deadline - r.board.stepStartedAt, 45000);
  const rolledAt = r.board.stepStartedAt + 1000;
  engine.roll(r, 'p0', rolledAt, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 1)}, rolledAt);
  engine.tick(r, rolledAt + 5000, seq());
  engine.tick(r, rolledAt + 10000, seq());
  assert.equal(r.board.step, 'risk');
  engine.choose(r, 'p0', {option: 'safe'}, rolledAt + 10000, seq());
  assert.equal(r.board.deadline - r.board.stepStartedAt, 36000);
  assert.throws(() => engine.hostNextTurn(r, rolledAt + 10000), {code: 'STEP'});
  const question = Q.get(r.board.question.id);
  engine.answer(r, 'p0', {choice: question.correct}, rolledAt + 11000);
  assert.equal(r.board.step, 'reveal');
  assert.equal(r.board.deadline - r.board.stepStartedAt, 8500);
  engine.tick(r, r.board.deadline, seq());
  assert.equal(r.board.step, 'turnEnd');
  assert.equal(r.board.deadline - r.board.stepStartedAt, engine.PACE.relaxed.chat);   // Leisurely: a chat after every turn
  engine.hostPause(r, r.board.stepStartedAt + 100);
  assert.throws(() => engine.hostNextTurn(r, r.board.stepStartedAt + 200), {code: 'PAUSED'});
  engine.hostResume(r, r.board.stepStartedAt + 300);
  engine.hostNextTurn(r, r.board.stepStartedAt + 400);
  assert.equal(r.board.step, 'turn');
  assert.equal(r.board.activeId, 'p1');
});

test('mini-game instructions and Majority Rules results remain available for discussion', () => {
  const r = room(3, {timerSpeed: 'relaxed'});
  engine.start(r, 100000, seq());
  engine.debugStart(r, 'majority-rules', 101000, seq());
  const m = r.board.minigame;
  assert.equal(m.phase, 'intro');
  assert.ok(m.introUntil - 101000 >= 12000);
  engine.tick(r, m.deadline, seq());
  assert.equal(m.phase, 'play');
  const first = m.question;
  const at = m.deadline - 1000;
  const key = m.roundKey;
  for (const p of r.players) engine.minigameInput(r, p.id, 0, key, at);
  assert.equal(m.phase, 'reveal');
  assert.equal(m.lastResult.question, first);
  assert.ok(m.deadline - at >= 8000);
  engine.tick(r, m.deadline, seq());
  assert.equal(m.phase, 'play');
  assert.equal(m.round, 2);
});

test('Buzzer Battle holds the correct answer on screen before the next question', () => {
  const r = room(3, {timerSpeed: 'relaxed'});
  engine.start(r, 100000, seq());
  engine.debugStart(r, 'buzzer', 101000, seq());
  const m = r.board.showdown;
  engine.tick(r, m.deadline, seq());
  assert.equal(m.phase, 'buzz');
  assert.equal(engine.publicBoard(r, true).showdown.display.correctText, null);
  const key = m.roundKey, now = m.questionAt;
  engine.minigameInput(r, 'p0', {action: 'buzz', reactionMs: 200}, key, now + 250);
  engine.minigameInput(r, 'p1', {action: 'buzz', reactionMs: 300}, key, now + 350);
  assert.equal(m.phase, 'answer');
  const answer = m.question.choices[m.question.correct];
  engine.minigameInput(r, 'p0', m.question.correct, key, now + 500);
  assert.equal(m.phase, 'reveal');
  assert.equal(engine.publicBoard(r, true).showdown.display.correctText, answer);
  assert.equal(m.questionIndex, 1);
  engine.tick(r, m.deadline, seq());
  assert.equal(m.phase, 'buzz');
  assert.equal(m.questionIndex, 2);
});

test('reading-heavy Close Call gets a full reading and answering window', () => {
  const r = room(3, {timerSpeed: 'relaxed'});
  engine.start(r, 100000, seq());
  engine.debugStart(r, 'close-call', 101000, seq());
  const m = r.board.minigame;
  assert.equal(m.introUntil - 101000, 12000);
  assert.ok(m.deadline - m.openAt >= 25000);
});

/** Play one Play Safe question for p0 on space 1, answering right or wrong. */
function oneQuestion(r, right) {
  let now = toTurn(r);
  engine.roll(r, 'p0', now, seq(0));
  engine.choose(r, 'p0', {option: r.board.moveOptions.findIndex(o => o.target === 1)}, now);
  now += 5000; engine.tick(r, now, seq()); now += 5000; engine.tick(r, now, seq());
  engine.choose(r, 'p0', {option: 'safe'}, now, seq());
  const q = Q.get(r.board.question.id);
  engine.answer(r, 'p0', {choice: right ? q.correct : (q.correct + 1) % q.opts.length}, now + 500);
  engine.tick(r, r.board.deadline, seq());               // reveal ends
  if (r.board.step === 'steal') engine.tick(r, r.board.deadline, seq());
  if (r.board.step === 'groupReveal') engine.tick(r, r.board.deadline, seq());
  return r.board;
}

test('Sociable pace: a chat pause after a big moment, none after an ordinary turn', () => {
  const won = oneQuestion(room(3, {timerSpeed: 'sociable'}), true);    // wins a new token
  assert.equal(won.step, 'turnEnd');
  assert.ok(won.chat);
  assert.equal(won.deadline - won.stepStartedAt, engine.PACE.sociable.chat);
  const quiet = room(3, {timerSpeed: 'sociable'});
  quiet.players.forEach(p => { p.socketId = null; });                 // nobody to steal it
  quiet.players[0].socketId = 's0';
  const b = oneQuestion(quiet, false);
  assert.equal(b.step, 'turnEnd');
  assert.equal(b.chat, null);
  assert.equal(b.deadline - b.stepStartedAt, engine.T.TURN_END);
});

test('Brisk pace never pauses for a chat', () => {
  const b = oneQuestion(room(3, {timerSpeed: 'normal'}), true);
  assert.equal(b.step, 'turnEnd');
  assert.equal(b.chat, null);
});

test('when most players tap "We\'re ready", the next turn starts', () => {
  const r = room(3, {timerSpeed: 'sociable'});
  const b = oneQuestion(r, true);
  assert.equal(b.step, 'turnEnd');
  const at = b.stepStartedAt + 1000;
  engine.playerReady(r, 'p1', at);
  assert.equal(r.board.step, 'turnEnd');                               // 1 of 2 needed
  assert.equal(engine.publicBoard(r, false, 'p1').chat.mine, true);
  engine.playerReady(r, 'p2', at + 100);
  assert.equal(r.board.step, 'turn');                                  // 2 of 3: carry on
  assert.equal(r.board.activeId, 'p1');
  assert.throws(() => engine.playerReady(r, 'p0', at + 200), {code: 'STEP'});
});

test('authorised TV host can return an unfinished game to the same lobby', () => {
  const {GameRooms} = require('../server/rooms');
  const rooms = new GameRooms({now: () => 1234, randomInt: () => 0});
  const created = rooms.create('tv-host');
  const room = rooms.find(created.code);
  room.phase = 'board';
  room.board = {step:'minigame',deadline:999999};
  room.players = [{id:'p1',name:'Guest',ready:true,position:4,brains:8,tokens:['sport'],socketId:'guest'}];
  assert.throws(() => rooms.backToLobby(created.code,'unapproved'), {code:'AUTH'});
  assert.equal(room.phase,'board','Guest cannot cancel a game');
  const state = rooms.backToLobby(created.code,'tv-host');
  assert.equal(state.phase,'lobby');
  assert.equal(room.board,null,'Old game engine state cleared');
  assert.equal(state.players.length,1,'Connected player seat retained');
  assert.equal(room.players[0].ready,false,'Lobby readiness reset');
  assert.equal(room.players[0].position,undefined,'Board position cleared');
  assert.equal(room.players[0].brains,undefined,'Scoring cleared');
});
