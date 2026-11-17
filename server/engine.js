'use strict';
/**
 * Smart Alec game engine. Pure game rules: no sockets, no timers of its own.
 * rooms.js calls these functions; gateway.js broadcasts the result. Every step
 * has a deadline, and tick() applies the default action when one passes, so a
 * slow or offline phone can never stall the game.
 */
const crypto = require('node:crypto');
const L = require('./board-layout');
const Q = require('./questions');
const phase3 = require('./games/phase3');
const phase4 = require('./games/phase4');
const phase5 = require('./games/phase5');
const {SHOWDOWN_KINDS} = require('./layout');

/* ---------- timings (ms) ---------- */
const T = Object.freeze({
  INTRO: 3500, ROLL: 25000, DIRECTION: 10000, HOP: 220, MOVE_BASE: 700, LANDED: 1400,
  RISK: 10000, ANSWER_CHOICE: 20000, ANSWER_TYPED: 30000, REVEAL: 3800,
  STEAL: 10000, GROUP: 15000, GROUP_REVEAL: 4200, CHOOSE: 15000, CARD: 2600,
  PREDICT: 12000, FINAL_FULL: 60000, FINAL_QUICK: 40000, FINAL_RESULT: 5500, TURN_END: 1800,
});
const BRAINS = Object.freeze({
  PASS_GO: 1, SAFE_OWNED: 1, SMART_NEW_BONUS: 2, SMART_OWNED: 3, STEAL_FIRST: 2, STEAL_SECOND: 1,
  LIGHTNING: [3, 2, 1], FREE_FOR_ALL: 3, SHOWDOWN: 4, SHOWDOWN_FLOOR: 2, JACKPOT: 2,
  TOKEN_PRICE: 10, BET_MAX: 10, PREDICT_EXACT: 2, NO_STEAL_TARGET: 2, MINIGAME_WIN: 3, SPOTLIGHT_PICK: 1,
});

/* ---------- small helpers ---------- */
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const b = room => room.board;
const player = (room, id) => room.players.find(p => p.id === id);
const nameOf = (room, id) => player(room, id)?.name || 'Someone';
const catName = id => L.CATEGORIES.find(c => c.id === id)?.name || id;
const seats = room => [...room.players].sort((x, y) => x.seat - y.seat);
const required = room => (room.settings.quickGame ? 4 : 6);
const slow = room => (room.settings.timerSpeed === 'relaxed' ? 1.5 : 1);
function setStep(room, step, now, ms) {
  const g = b(room);
  g.step = step; g.stepStartedAt = now;
  g.deadline = ms == null ? null : now + ms;
  g.version = (g.version || 0) + 1;
}
function banner(room, text, tone = 'info') { b(room).banner = {text, tone, at: b(room).version || 0}; }
function log(room, text) { const g = b(room); g.log = [text, ...(g.log || [])].slice(0, 6); }
function requireStep(room, ...steps) { if (!steps.includes(b(room).step)) fail('STEP', 'That is not available right now.'); }
function requireActive(room, id) { if (b(room).activeId !== id) fail('TURN', 'It is not your turn.'); }
function addBrains(room, id, n) { const p = player(room, id); if (p) p.brains = Math.max(0, (p.brains || 0) + n); }
function giveToken(room, id, cat) { const p = player(room, id); if (p && !p.tokens.includes(cat)) { p.tokens.push(cat); return true; } return false; }
function randomCategory(rng) { return L.CATEGORY_IDS[rng(L.CATEGORY_IDS.length)]; }

/* ---------- start ---------- */
function start(room, now = Date.now(), rng = crypto.randomInt) {
  if (room.players.length < 2) fail('PLAYERS', 'You need at least two players.');
  for (const p of room.players) { p.position = 0; p.brains = 0; p.sparks = 0; p.tokens = []; }
  const order = seats(room);
  room.phase = 'board';
  room.board = {
    step: 'intro', version: 0, turnNo: 0, startedAt: now,
    timeLimitAt: room.settings.timeLimit ? now + room.settings.timeLimit * 60_000 : null,
    activeId: order[0].id, usedQuestions: [], log: [], banner: null,
    dice: null, moveOptions: null, move: null, question: null, special: null, final: null,
    winnerId: null, standings: null, pausedAt: null,
  };
  banner(room, `Welcome to Smart Alec! ${order[0].name} goes first.`, 'big');
  setStep(room, 'intro', now, T.INTRO);
}

function beginTurn(room, now) {
  const g = b(room);
  g.turnNo += 1;
  g.dice = null; g.moveOptions = null; g.move = null; g.question = null; g.special = null; g.final = null;
  const p = player(room, g.activeId);
  const canFinal = p.tokens.length >= required(room);
  banner(room, canFinal ? `${p.name} has every token they need. Roll, or go for Smart Alec?` : `${p.name}'s turn. Roll the die!`);
  setStep(room, 'turn', now, T.ROLL);
}

function nextPlayer(room) {
  const order = seats(room);
  const i = order.findIndex(p => p.id === b(room).activeId);
  return order[(i + 1) % order.length].id;
}

function endTurn(room, now, text) {
  if (text) { banner(room, text); log(room, text); }
  setStep(room, 'turnEnd', now, T.TURN_END);
}

function afterTurnEnd(room, now) {
  const g = b(room);
  if (g.timeLimitAt && now >= g.timeLimitAt) return finishGame(room, now, null, 'time');
  g.activeId = nextPlayer(room);
  beginTurn(room, now);
}

/* ---------- rolling and moving ---------- */
function catchUp(room, p) {
  const leader = Math.max(...room.players.map(x => x.tokens.length));
  return room.settings.quickGame ? (p.tokens.length <= 1 && leader >= 3) : (p.tokens.length <= 2 && leader >= 5);
}

function roll(room, id, now, rng = crypto.randomInt) {
  requireStep(room, 'turn'); requireActive(room, id);
  doRoll(room, now, rng);
}
function doRoll(room, now, rng) {
  const g = b(room), p = player(room, g.activeId);
  const dice = catchUp(room, p) ? [rng(6) + 1, rng(6) + 1] : [rng(6) + 1];
  g.dice = dice;
  const seen = new Set();
  g.moveOptions = [];
  for (const steps of [...new Set(dice)].sort((x, y) => x - y)) {
    for (const dir of [1, -1]) {
      const to = L.target(p.position, steps, dir);
      const key = to;
      if (seen.has(key)) continue;
      seen.add(key);
      g.moveOptions.push({steps, dir, target: to, type: L.SPACES[to].type});
    }
  }
  banner(room, dice.length > 1 ? `${p.name} rolls ${dice[0]} and ${dice[1]} (catch-up dice). Pick one!` : `${p.name} rolls a ${dice[0]}. Which way?`);
  setStep(room, 'direction', now, T.DIRECTION);
}

function pickMove(room, index, now) {
  const g = b(room), p = player(room, g.activeId);
  const opt = g.moveOptions[index];
  if (!opt) fail('OPTION', 'Pick one of the spaces shown.');
  const path = [];
  for (let s = 1; s <= opt.steps; s++) path.push(L.target(p.position, s, opt.dir));
  const passed = L.passesGo(p.position, opt.steps, opt.dir);
  g.move = {playerId: p.id, from: p.position, to: opt.target, dir: opt.dir, steps: opt.steps, path};
  p.position = opt.target;
  if (passed) addBrains(room, p.id, BRAINS.PASS_GO);
  g.passedGo = passed;
  setStep(room, 'moving', now, T.MOVE_BASE + T.HOP * opt.steps);
}

function land(room, now, rng) {
  const g = b(room), p = player(room, g.activeId);
  const space = L.SPACES[p.position];
  g.landed = {index: space.index, type: space.type, kind: space.kind};
  const goNote = g.passedGo && space.type !== 'go' ? ' (+1 Brain for passing GO)' : '';
  if (space.kind === 'category') {
    banner(room, `${p.name} lands on ${catName(space.type)}${goNote}.`);
  } else if (space.kind === 'minigame') {
    banner(room, `${p.name} lands on a Mini-game${goNote}. Everyone plays!`);
  } else {
    banner(room, `${p.name} lands on ${space.name}!${goNote}`, 'big');
  }
  setStep(room, 'landed', now, T.LANDED);
}

function resolveLanding(room, now, rng) {
  const g = b(room), p = player(room, g.activeId);
  const space = L.SPACES[p.position];
  if (space.kind === 'category') return askRisk(room, space.type, now);
  if (space.kind === 'minigame') return startMinigame(room, now, rng);
  return startSpecial(room, space.type, now, rng);
}

/* ---------- the active player's question ---------- */
function askRisk(room, category, now) {
  const g = b(room), p = player(room, g.activeId);
  g.question = {kind: 'turn', category, id: null, mode: null, forId: p.id, answers: {}, revealed: false};
  const owned = p.tokens.includes(category);
  banner(room, owned
    ? `${p.name} already has ${catName(category)}. Play Safe for 1 Brain, or Go Smart for 3?`
    : `${catName(category)} token up for grabs. Play Safe (A–D) or Go Smart (type it, +2 Brains)?`);
  setStep(room, 'risk', now, T.RISK);
}

function chooseRisk(room, option, now, rng) {
  const g = b(room);
  if (!['safe', 'smart'].includes(option)) fail('OPTION', 'Choose Play Safe or Go Smart.');
  g.question.mode = option === 'smart' ? 'typed' : 'choice';
  g.question.id = Q.pick(room, g.question.category, rng);
  setStep(room, 'question', now, Math.round((option === 'smart' ? T.ANSWER_TYPED : T.ANSWER_CHOICE) * slow(room)));
  banner(room, option === 'smart' ? `${nameOf(room, g.activeId)} goes SMART. No options!` : `${nameOf(room, g.activeId)} plays it safe.`);
}

function askDirect(room, kind, category, mode, now, rng) {
  const g = b(room);
  g.question = {kind, category, id: Q.pick(room, category, rng), mode, forId: g.activeId, answers: {}, revealed: false};
  setStep(room, 'question', now, Math.round((mode === 'typed' ? T.ANSWER_TYPED : T.ANSWER_CHOICE) * slow(room)));
}

function answerQuestion(room, id, payload, now) {
  const g = b(room), q = g.question;
  if (q.forId !== id) fail('TURN', 'This question is for the player whose turn it is.');
  if (q.answers[id]) fail('DONE', 'You have already answered.');
  let correct;
  if (q.mode === 'typed') {
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 80) : '';
    if (!text) fail('INPUT', 'Type an answer first.');
    correct = Q.markTyped(q.id, text);
    q.answers[id] = {text, correct, at: now};
  } else {
    const choice = payload.choice;
    const view = Q.get(q.id);
    if (!Number.isInteger(choice) || choice < 0 || choice >= view.opts.length) fail('INPUT', 'Pick A, B, C or D.');
    correct = choice === view.correct;
    q.answers[id] = {choice, correct, at: now};
  }
  revealQuestion(room, now);
}

/**
 * Everyone else can lock in an A-D answer while the active player is thinking.
 * Nothing is won for it unless the active player gets it wrong; then those answers
 * count straight away for the Bonus Steal, fastest first.
 */
function answerAlong(room, id, payload, now) {
  const q = b(room).question;
  if (!['turn', 'jackpot'].includes(q.kind)) fail('TURN', 'This question is for the player whose turn it is.');
  if (!player(room, id)) fail('TURN', 'You are not in this game.');
  q.along = q.along || {};
  if (q.along[id]) fail('DONE', 'You have already locked in.');
  const view = Q.get(q.id), choice = payload.choice;
  if (!Number.isInteger(choice) || choice < 0 || choice >= view.opts.length) fail('INPUT', 'Pick A, B, C or D.');
  q.along[id] = {choice, correct: choice === view.correct, at: now};
  b(room).version += 1;
}

function revealQuestion(room, now) {
  const g = b(room), q = g.question, p = player(room, q.forId);
  q.revealed = true;
  const a = q.answers[p.id];
  const correct = Boolean(a && a.correct);
  q.result = correct ? 'right' : (a ? 'wrong' : 'timeout');
  let text;
  if (q.kind === 'turn') {
    if (correct) {
      const isNew = giveToken(room, p.id, q.category);
      if (q.mode === 'typed') addBrains(room, p.id, isNew ? BRAINS.SMART_NEW_BONUS : BRAINS.SMART_OWNED);
      else if (!isNew) addBrains(room, p.id, BRAINS.SAFE_OWNED);
      text = isNew
        ? `Correct! ${p.name} wins the ${catName(q.category)} token${q.mode === 'typed' ? ' and 2 Brains' : ''}.`
        : `Correct! ${p.name} earns ${q.mode === 'typed' ? BRAINS.SMART_OWNED : BRAINS.SAFE_OWNED} Brain${q.mode === 'typed' ? 's' : ''}.`;
    }
  } else if (q.kind === 'jackpot') {
    if (correct) {
      const isNew = giveToken(room, p.id, q.category);
      addBrains(room, p.id, BRAINS.JACKPOT);
      text = `Jackpot! ${p.name} gets ${isNew ? `the ${catName(q.category)} token and ` : ''}2 Brains.`;
    }
  } else if (q.kind === 'double') {
    const bet = g.special?.bet || 0;
    addBrains(room, p.id, correct ? bet : -bet);
    text = correct ? `Doubled! ${p.name} wins ${bet} Brains.` : `Nothing! ${p.name} loses ${bet} Brains.`;
  }
  q.resultText = text || (q.result === 'timeout' ? `Time's up, ${p.name}!` : `Wrong, ${p.name}!`);
  banner(room, q.resultText, correct ? 'good' : 'bad');
  setStep(room, 'reveal', now, T.REVEAL);
}

function afterReveal(room, now, rng) {
  const g = b(room), q = g.question;
  const stealable = (q.kind === 'turn' || q.kind === 'jackpot') && q.result !== 'right';
  const others = room.players.filter(p => p.id !== q.forId);
  if (stealable && others.length) {
    // Answers locked in while playing along count first, so they beat anyone who answers now.
    const answers = {};
    for (const [pid, a] of Object.entries(q.along || {})) if (others.some(p => p.id === pid)) answers[pid] = {...a};
    g.question = {kind: 'steal', category: q.category, id: q.id, mode: 'choice', forId: null, participants: others.map(p => p.id), answers, revealed: false, fromId: q.forId};
    banner(room, 'Up for grabs! Fastest correct answer steals 2 Brains.', 'big');
    setStep(room, 'steal', now, Math.round(T.STEAL * slow(room)));
    const waiting = others.filter(p => !answers[p.id] && p.socketId);
    if (!waiting.length) settleGroup(room, now);
    return;
  }
  endTurn(room, now, q.resultText);
}

/* ---------- group questions: Bonus Steal, Lightning, Free-for-All, Showdown ---------- */
function startGroup(room, kind, category, participants, now, rng) {
  const g = b(room);
  g.question = {kind, category, id: Q.pick(room, category, rng), mode: 'choice', forId: null, participants, answers: {}, revealed: false};
  const labels = {
    lightning: 'Lightning Round! Everyone answers. Fastest three correct score 3, 2 and 1 Brains.',
    freeforall: 'Free-for-All! Fastest correct answer wins 3 Brains.',
    showdown: `Showdown: ${participants.map(id => nameOf(room, id)).join(' v ')}. Fastest correct takes 4 Brains!`,
  };
  banner(room, labels[kind] || 'Everyone answers!', 'big');
  setStep(room, kind === 'steal' ? 'steal' : 'group', now, Math.round(T.GROUP * slow(room)));
}

function answerGroup(room, id, payload, now) {
  const q = b(room).question;
  if (!q.participants.includes(id)) fail('TURN', 'You are not in this one.');
  if (q.answers[id]) fail('DONE', 'You have already answered.');
  const view = Q.get(q.id);
  const choice = payload.choice;
  if (!Number.isInteger(choice) || choice < 0 || choice >= view.opts.length) fail('INPUT', 'Pick A, B, C or D.');
  q.answers[id] = {choice, correct: choice === view.correct, at: now};
  const online = q.participants.filter(pid => player(room, pid)?.socketId || q.answers[pid]);
  if (q.participants.every(pid => q.answers[pid]) || online.every(pid => q.answers[pid])) settleGroup(room, now);
}

function rankCorrect(q) {
  return Object.entries(q.answers).filter(([, a]) => a.correct).sort((x, y) => x[1].at - y[1].at).map(([id]) => id);
}

function settleGroup(room, now) {
  const g = b(room), q = g.question;
  q.revealed = true;
  const ranked = rankCorrect(q);
  const awards = {};
  const give = (id, n) => { if (n) { addBrains(room, id, n); awards[id] = (awards[id] || 0) + n; } };
  let text;
  if (q.kind === 'steal') {
    give(ranked[0], BRAINS.STEAL_FIRST); give(ranked[1], BRAINS.STEAL_SECOND);
    text = ranked.length ? `${nameOf(room, ranked[0])} steals 2 Brains${ranked[1] ? `, ${nameOf(room, ranked[1])} gets 1` : ''}.` : 'Nobody got it!';
  } else if (q.kind === 'lightning') {
    ranked.slice(0, 3).forEach((id, i) => give(id, BRAINS.LIGHTNING[i]));
    text = ranked.length ? ranked.slice(0, 3).map((id, i) => `${nameOf(room, id)} +${BRAINS.LIGHTNING[i]}`).join(', ') : 'Nobody got it!';
  } else if (q.kind === 'freeforall') {
    give(ranked[0], BRAINS.FREE_FOR_ALL);
    text = ranked.length ? `${nameOf(room, ranked[0])} wins 3 Brains!` : 'Nobody got it!';
  } else if (q.kind === 'showdown') {
    const [winner] = ranked;
    if (winner) {
      const loser = q.participants.find(id => id !== winner);
      const lp = player(room, loser);
      const take = Math.min(BRAINS.SHOWDOWN, lp.brains || 0);
      addBrains(room, loser, -take);
      give(winner, Math.max(take, take === 0 ? BRAINS.SHOWDOWN_FLOOR : take));
      text = take ? `${nameOf(room, winner)} wins the Showdown and takes ${take} Brains from ${lp.name}!` : `${nameOf(room, winner)} wins the Showdown! +${BRAINS.SHOWDOWN_FLOOR} Brains.`;
    } else text = 'Showdown ends level. Nobody got it!';
  }
  q.awards = awards;
  q.resultText = text;
  banner(room, text, ranked.length ? 'good' : 'bad');
  setStep(room, 'groupReveal', now, T.GROUP_REVEAL);
}

/* ---------- special spaces ---------- */
function startSpecial(room, type, now, rng) {
  const g = b(room), p = player(room, g.activeId);
  g.special = {type};
  const others = room.players.filter(x => x.id !== p.id);
  switch (type) {
    case 'go': {
      const missing = L.CATEGORY_IDS.filter(c => !p.tokens.includes(c));
      if (p.brains >= BRAINS.TOKEN_PRICE && missing.length && p.tokens.length < required(room)) {
        g.special.options = missing.map(c => ({category: c, label: `Buy ${catName(c)}`})).concat([{skip: true, label: 'Keep my Brains'}]);
        banner(room, `${p.name} can buy a token for 10 Brains.`);
        return setStep(room, 'special', now, T.CHOOSE);
      }
      return endTurn(room, now, `${p.name} lands on GO. +1 Brain.`);
    }
    case 'smartalec': {
      const options = [];
      for (const o of others) for (const c of o.tokens) if (!p.tokens.includes(c)) options.push({targetId: o.id, category: c, label: `${catName(c)} from ${o.name}`});
      if (!options.length) { addBrains(room, p.id, BRAINS.NO_STEAL_TARGET); return endTurn(room, now, `Nothing to steal! ${p.name} gets 2 Brains instead.`); }
      g.special.options = options;
      banner(room, `Smart Alec! ${p.name} steals a token.`, 'big');
      return setStep(room, 'special', now, T.CHOOSE);
    }
    case 'double': {
      if (!p.brains) return endTurn(room, now, `${p.name} has no Brains to bet. Next!`);
      const max = Math.min(BRAINS.BET_MAX, p.brains);
      g.special.options = [{bet: 0, label: 'No bet'}].concat(Array.from({length: max}, (_, i) => ({bet: i + 1, label: `Bet ${i + 1}`})));
      banner(room, `Double or Nothing! How many Brains will ${p.name} bet?`, 'big');
      return setStep(room, 'special', now, T.CHOOSE);
    }
    case 'freeforall':
      return startGroup(room, 'freeforall', randomCategory(rng), room.players.map(x => x.id), now, rng);
    case 'shortcut': {
      g.special.options = L.SPECIALS.filter(s => s.id !== 'shortcut').map(s => ({index: s.index, label: s.name}));
      banner(room, `Shortcut! ${p.name} jumps to any special space.`, 'big');
      return setStep(room, 'special', now, T.CHOOSE);
    }
    case 'swap': {
      g.special.options = others.map(o => ({targetId: o.id, label: `Swap with ${o.name}`})).concat([{skip: true, label: 'Stay put'}]);
      banner(room, `Swap! ${p.name} can swap places with anyone.`, 'big');
      return setStep(room, 'special', now, T.CHOOSE);
    }
    case 'jackpot': {
      const category = randomCategory(rng);
      banner(room, `Pot Luck Jackpot: ${catName(category)}! Right answer wins the token and 2 Brains.`, 'big');
      return askDirect(room, 'jackpot', category, 'choice', now, rng);
    }
    case 'showdown': {
      g.special.options = others.map(o => ({targetId: o.id, label: `Challenge ${o.name}`}));
      banner(room, `Showdown! ${p.name} picks an opponent.`, 'big');
      return setStep(room, 'special', now, T.CHOOSE);
    }
    default:
      return endTurn(room, now);
  }
}

function chooseSpecial(room, index, now, rng) {
  const g = b(room), sp = g.special, p = player(room, g.activeId);
  const opt = sp.options?.[index];
  if (!opt) fail('OPTION', 'Pick one of the options.');
  sp.chosen = index;
  switch (sp.type) {
    case 'go':
      if (opt.skip) return endTurn(room, now, `${p.name} keeps their Brains.`);
      addBrains(room, p.id, -BRAINS.TOKEN_PRICE);
      giveToken(room, p.id, opt.category);
      return endTurn(room, now, `${p.name} buys the ${catName(opt.category)} token!`);
    case 'smartalec': {
      const victim = player(room, opt.targetId);
      victim.tokens = victim.tokens.filter(c => c !== opt.category);
      giveToken(room, p.id, opt.category);
      return endTurn(room, now, `${p.name} steals ${catName(opt.category)} from ${victim.name}!`);
    }
    case 'double':
      if (!opt.bet) return endTurn(room, now, `${p.name} plays it cool. No bet.`);
      sp.bet = opt.bet;
      banner(room, `${p.name} bets ${opt.bet}. Type the answer!`, 'big');
      return askDirect(room, 'double', randomCategory(rng), 'typed', now, rng);
    case 'shortcut': {
      g.move = {playerId: p.id, from: p.position, to: opt.index, dir: 0, steps: 0, path: [opt.index], jump: true};
      p.position = opt.index;
      g.passedGo = false;
      if (opt.index === 0) addBrains(room, p.id, BRAINS.PASS_GO);
      return setStep(room, 'moving', now, T.MOVE_BASE + 500);
    }
    case 'swap': {
      if (opt.skip) return endTurn(room, now, `${p.name} stays put.`);
      const other = player(room, opt.targetId);
      [p.position, other.position] = [other.position, p.position];
      g.move = {playerId: p.id, swapWith: other.id, jump: true, path: [], steps: 0, dir: 0, from: other.position, to: p.position};
      return endTurn(room, now, `${p.name} swaps places with ${other.name}!`);
    }
    case 'showdown':
      return startShowdown(room, opt.targetId, now, rng);
    default:
      return endTurn(room, now);
  }
}

/* ---------- NOGGIN mini-games and Showdowns ----------
 * The NOGGIN engines run unchanged. They keep their state in room.board.minigame
 * or room.board.showdown and call finishTurn() when they end. NOGGIN pays out
 * "Sparks"; Smart Alec ignores those and pays Brains by its own rules instead. */
const MINI_CATEGORIES = ['speed', 'brain', 'create', 'together'];
const NOGGIN_KINDS = Object.keys(SHOWDOWN_KINDS).map(Number);   // corner indexes 6, 10, 18, 22
function gameTitle(room, game) { return game.title || (phase3.SPECS[game.id] ? phase3.titleFor(room, game.id) : phase4.SPECS[game.id]?.name) || 'Mini-game'; }
function syncSparks(room) { for (const p of room.players) p.sparks = p.brains || 0; }
function startMinigame(room, now, rng) {
  const g = b(room);
  syncSparks(room);
  const category = MINI_CATEGORIES[rng(MINI_CATEGORIES.length)];
  g.seenGames = g.seenGames || [];
  (category === 'speed' || category === 'brain' ? phase3 : phase4).start(room, category, now, rng);
  g.seenGames.push(g.minigame.id); g.lastGame = g.minigame.id;
  g.question = null;
  g.version += 1;
  banner(room, `Mini-game: ${gameTitle(room, g.minigame)}!`, 'big');
}
function startShowdown(room, opponentId, now, rng) {
  const g = b(room);
  syncSparks(room);
  g.landing = NOGGIN_KINDS[rng(NOGGIN_KINDS.length)];
  phase5.start(room, 'corner', now, opponentId, rng);
  g.version += 1;
  banner(room, `Showdown: ${g.showdown.title}! ${nameOf(room, g.activeId)} v ${nameOf(room, opponentId)}.`, 'big');
}
/** Called by a NOGGIN engine when its game ends. `game` is the game state captured just before. */
function finishNoggin(room, now, winners, game, kind) {
  const g = b(room);
  g.minigame = null; g.showdown = null;
  game = {...game, title: gameTitle(room, game)};
  const won = [...new Set(winners || [])].filter(id => room.players.some(p => p.id === id));
  const awards = {};
  const give = (id, n) => { if (n) { addBrains(room, id, n); awards[id] = (awards[id] || 0) + n; } };
  let text;
  if (kind === 'showdown') {
    const [winner] = won.length === 1 ? won : [];
    if (winner) {
      const loser = game.participants.find(id => id !== winner);
      const take = Math.min(BRAINS.SHOWDOWN, player(room, loser)?.brains || 0);
      addBrains(room, loser, -take);
      give(winner, take || BRAINS.SHOWDOWN_FLOOR);
      if (take) awards[loser] = -take;
      for (const [pid, pick] of Object.entries(game.cheers || {})) if (pick === winner) give(pid, BRAINS.SPOTLIGHT_PICK);
      text = `${nameOf(room, winner)} wins ${game.title}${take ? ` and takes ${take} Brains from ${nameOf(room, loser)}` : ` and gets ${BRAINS.SHOWDOWN_FLOOR} Brains`}!`;
    } else text = `${game.title} ends in a draw. Nobody loses Brains.`;
  } else {
    for (const id of won) give(id, BRAINS.MINIGAME_WIN);
    text = won.length ? `${game.title}: ${won.map(id => nameOf(room, id)).join(' & ')} win${won.length === 1 ? 's' : ''} ${BRAINS.MINIGAME_WIN} Brains!` : `${game.title}: no winner this time.`;
  }
  g.miniResult = {kind, title: game.title, text, awards};
  banner(room, text, won.length ? 'good' : 'bad');
  setStep(room, 'miniResult', now, T.GROUP_REVEAL);
}
const finishMinigameFor = game => (room, now, text, winners) => finishNoggin(room, now, winners, game, 'minigame');
const finishShowdownFor = game => (room, now, text, winners) => finishNoggin(room, now, winners, game, 'showdown');
function nogginTick(room, now, rng) {
  const g = b(room);
  if (g.step === 'showdown' && g.showdown) return phase5.tick(room, now, finishShowdownFor(g.showdown)) || false;
  if (g.step === 'minigame' && g.minigame) {
    const m = g.minigame;
    return (phase4.SPECS[m.id] ? phase4.tick(room, now, finishMinigameFor(m), rng) : phase3.tick(room, now, finishMinigameFor(m), rng)) || false;
  }
  return false;
}
function minigameInput(room, id, value, roundKey, now = Date.now()) {
  const g = b(room);
  if (g.step === 'showdown' && g.showdown) return phase5.submit(room, id, value, roundKey, now, finishShowdownFor(g.showdown));
  if (g.step !== 'minigame' || !g.minigame) fail('STEP', 'No mini-game is running.');
  const m = g.minigame;
  return phase4.SPECS[m.id] ? phase4.submit(room, id, value, roundKey, now, finishMinigameFor(m)) : phase3.submit(room, id, value, roundKey, now);
}
function minigameDraw(room, id, points, roundKey, now = Date.now()) {
  if (b(room).step !== 'minigame') fail('STEP', 'No drawing game is running.');
  return phase4.draw(room, id, points, roundKey, now);
}
/** Testing only: start a named NOGGIN game for the active player straight away. */
function debugStart(room, what, now = Date.now(), rng = crypto.randomInt) {
  const g = b(room);
  g.question = null; g.special = null; g.final = null;
  syncSparks(room);
  const kinds = {buzzer: 6, tug: 10, bid: 18, nerve: 22};
  if (kinds[what]) {
    g.landing = kinds[what];
    const other = room.players.find(p => p.id !== g.activeId);
    phase5.start(room, 'corner', now, other.id, rng);
    return;
  }
  const spec = phase3.SPECS[what] || phase4.SPECS[what];
  if (!spec) fail('GAME', 'Unknown game.');
  (phase4.SPECS[what] ? phase4 : phase3).start(room, spec.category, now, rng, what);
}
function cheer(room, id, targetId) { return phase5.cheer(room, id, targetId); }
function decideBid(room, accept, now = Date.now()) {
  const g = b(room);
  if (!g.showdown) fail('STEP', 'Nothing to judge.');
  return phase5.decideBid(room, accept, now, finishShowdownFor(g.showdown));
}

function defaultSpecial(room) {
  const sp = b(room).special;
  const opts = sp.options || [];
  if (sp.type === 'go' || sp.type === 'swap' || sp.type === 'double') return opts.findIndex(o => o.skip || o.bet === 0);
  return 0;
}

/* ---------- the Final Round ---------- */
function goFinal(room, id, now, rng) {
  requireStep(room, 'turn'); requireActive(room, id);
  const g = b(room), p = player(room, id);
  if (p.tokens.length < required(room)) fail('FINAL', 'Collect every token first.');
  const cats = room.settings.quickGame ? shuffle(p.tokens.slice(), rng).slice(0, 4) : shuffle(L.CATEGORY_IDS.slice(), rng);
  // Win with all but one right: 5 of 6 (Quick Game: 3 of 4). Missing two ends it early.
  g.final = {playerId: id, categories: cats, ids: cats.map(c => Q.pick(room, c, rng)), index: 0, results: [], predictions: {}, outcome: null, need: cats.length - 1};
  banner(room, `${p.name} goes for SMART ALEC! Everyone else: how many will they get right?`, 'big');
  setStep(room, 'predict', now, T.PREDICT);
}

function shuffle(list, rng) { for (let i = list.length - 1; i > 0; i--) { const j = rng(i + 1); [list[i], list[j]] = [list[j], list[i]]; } return list; }

function predict(room, id, n, now) {
  const f = b(room).final;
  if (id === f.playerId) fail('TURN', 'You cannot predict your own Final Round.');
  if (!Number.isInteger(n) || n < 0 || n > f.ids.length) fail('INPUT', 'Pick a number.');
  f.predictions[id] = n;
  const others = room.players.filter(p => p.id !== f.playerId && p.socketId);
  if (others.every(p => Number.isInteger(f.predictions[p.id]))) startFinal(room, now);
}

function startFinal(room, now) {
  const f = b(room).final;
  const total = room.settings.quickGame ? T.FINAL_QUICK : T.FINAL_FULL;
  f.startedAt = now;
  banner(room, `${nameOf(room, f.playerId)}: ${f.ids.length} questions, ${total / 1000} seconds. Get ${f.need} right. GO!`, 'big');
  setStep(room, 'final', now, Math.round(total * slow(room)));
}

function answerFinal(room, id, payload, now) {
  const f = b(room).final;
  if (id !== f.playerId) fail('TURN', 'This is not your Final Round.');
  const q = Q.get(f.ids[f.index]);
  const choice = payload.choice;
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.opts.length) fail('INPUT', 'Pick A, B, C or D.');
  const correct = choice === q.correct;
  f.results.push({choice, correct});
  f.index += 1;
  const misses = f.results.filter(r => !r.correct).length;
  if (misses > f.ids.length - f.need) return finishFinal(room, now);   // can no longer reach the target
  if (f.index >= f.ids.length) return finishFinal(room, now);
  b(room).version += 1;
}

/** Ends the Final Round: a win needs f.need right. A failed attempt costs nothing but the turn. */
function finishFinal(room, now) {
  const g = b(room), f = g.final, p = player(room, f.playerId);
  const score = f.results.filter(r => r.correct).length;
  f.outcome = score >= f.need ? 'win' : 'lose';
  f.score = score;
  f.missed = null;
  for (const [pid, n] of Object.entries(f.predictions)) if (n === score) addBrains(room, pid, BRAINS.PREDICT_EXACT);
  if (f.outcome === 'lose') {
    banner(room, `So close! ${p.name} got ${score} of ${f.ids.length} and needed ${f.need}. Try again next turn!`, 'bad');
  } else {
    banner(room, score === f.ids.length ? `${score} out of ${score}! ${p.name} is SMART ALEC!` : `${score} out of ${f.ids.length}! ${p.name} is SMART ALEC!`, 'big');
  }
  setStep(room, 'finalResult', now, T.FINAL_RESULT);
}

/* ---------- end of game ---------- */
function standings(room) {
  return [...room.players].sort((x, y) => y.tokens.length - x.tokens.length || y.brains - x.brains || x.seat - y.seat)
    .map((p, i) => ({id: p.id, place: i + 1, tokens: p.tokens.length, brains: p.brains}));
}
function finishGame(room, now, winnerId, reason) {
  const g = b(room);
  g.standings = standings(room);
  g.winnerId = winnerId || g.standings[0].id;
  g.endReason = reason;
  room.phase = 'over';
  banner(room, reason === 'time' ? `Time's up! ${nameOf(room, g.winnerId)} wins on tokens.` : `${nameOf(room, g.winnerId)} is crowned SMART ALEC!`, 'big');
  setStep(room, 'over', now, null);
}

/* ---------- player actions ---------- */
function choose(room, id, payload = {}, now = Date.now(), rng = crypto.randomInt) {
  const g = b(room);
  const step = g.step;
  if (payload.action === 'final') return goFinal(room, id, now, rng);
  if (step === 'direction') { requireActive(room, id); return pickMove(room, payload.option, now); }
  if (step === 'risk') { requireActive(room, id); return chooseRisk(room, payload.option, now, rng); }
  if (step === 'special') { requireActive(room, id); return chooseSpecial(room, payload.option, now, rng); }
  if (step === 'predict') return predict(room, id, payload.option, now);
  fail('STEP', 'That is not available right now.');
}

function answer(room, id, payload = {}, now = Date.now()) {
  const step = b(room).step;
  if (step === 'question') return b(room).question.forId === id ? answerQuestion(room, id, payload, now) : answerAlong(room, id, payload, now);
  if (step === 'steal' || step === 'group') return answerGroup(room, id, payload, now);
  if (step === 'final') return answerFinal(room, id, payload, now);
  fail('STEP', 'There is no question to answer right now.');
}

/* ---------- the clock ---------- */
function onDeadline(room, now, rng) {
  const g = b(room);
  switch (g.step) {
    case 'intro': return beginTurn(room, now);
    case 'turn': return doRoll(room, now, rng);
    case 'direction': return pickMove(room, 0, now);
    case 'moving': return g.special?.type === 'shortcut' ? startSpecialAfterJump(room, now, rng) : land(room, now, rng);
    case 'landed': return resolveLanding(room, now, rng);
    case 'risk': return chooseRisk(room, 'safe', now, rng);
    case 'question': return revealQuestion(room, now);
    case 'reveal': return afterReveal(room, now, rng);
    case 'steal': case 'group': return settleGroup(room, now);
    case 'groupReveal': return endTurn(room, now, g.question?.resultText);
    case 'miniResult': return endTurn(room, now, g.miniResult?.text);
    case 'special': return chooseSpecial(room, Math.max(0, defaultSpecial(room)), now, rng);
    case 'predict': return startFinal(room, now);
    case 'final': return finishFinal(room, now);
    case 'finalResult': return g.final.outcome === 'win' ? finishGame(room, now, g.final.playerId, 'final') : endTurn(room, now);
    case 'turnEnd': return afterTurnEnd(room, now);
    default: return undefined;
  }
}

function startSpecialAfterJump(room, now, rng) {
  const g = b(room), p = player(room, g.activeId);
  const space = L.SPACES[p.position];
  g.special = null;
  banner(room, `${p.name} takes the Shortcut to ${space.name}!`, 'big');
  if (space.type === 'go') return startSpecial(room, 'go', now, rng);
  setStep(room, 'landed', now, T.LANDED);
}

function tick(room, now = Date.now(), rng = crypto.randomInt) {
  if (room.phase !== 'board' || !room.board) return false;
  const g = b(room);
  if (Number.isFinite(g.pausedAt)) return false;
  if (g.step === 'minigame' || g.step === 'showdown') return nogginTick(room, now, rng);
  let changed = false;
  for (let guard = 0; guard < 4 && g.deadline && now >= g.deadline; guard++) {
    onDeadline(room, now, rng);
    changed = true;
    if (room.phase !== 'board' || g.step === 'minigame' || g.step === 'showdown') break;
  }
  return changed;
}

function hostPause(room, now) {
  const g = b(room);
  if (!g || room.phase !== 'board') fail('PHASE', 'Nothing to pause.');
  if (Number.isFinite(g.pausedAt)) return;
  g.pausedAt = now; g.pauseKind = 'host'; g.remaining = g.deadline ? Math.max(0, g.deadline - now) : null;
  g.version += 1;
}
function hostResume(room, now) {
  const g = b(room);
  if (!g || !Number.isFinite(g.pausedAt)) return;
  const delta = Math.max(0, now - g.pausedAt);
  if (g.remaining != null) g.deadline = now + g.remaining;
  if (g.timeLimitAt) g.timeLimitAt += delta;
  // NOGGIN games keep their own clocks: move every one of them on by the pause.
  const move = (obj, key) => { if (obj && Number.isFinite(obj[key])) obj[key] += delta; };
  for (const key of ['deadline', 'hardStop', 'openAt', 'startedAt', 'buzzWindowUntil']) move(g.showdown, key);
  for (const key of ['deadline', 'openAt', 'introUntil', 'stageStarted']) move(g.minigame, key);
  for (const key of ['readyAt', 'flashEndsAt', 'revealAt']) move(g.minigame?.display, key);
  if (g.minigame || g.showdown) g.deadline = (g.showdown || g.minigame).deadline;
  g.pausedAt = null; g.pauseKind = null; g.pauseReason = null; g.remaining = null;
  g.version += 1;
}
/** Host button: end whatever step is waiting on an offline phone right now. */
function skipDisconnected(room, now, rng = crypto.randomInt) {
  const g = b(room);
  if (Number.isFinite(g.pausedAt)) hostResume(room, now);
  if (g.step === 'minigame' || g.step === 'showdown') {
    const game = g.minigame || g.showdown;
    return finishNoggin(room, now, [], game, g.step === 'showdown' ? 'showdown' : 'minigame');
  }
  if (g.deadline) { g.deadline = now; tick(room, now, rng); }
}

/* ---------- what each screen may see ---------- */
function publicQuestion(room, viewerId) {
  const g = b(room), q = g.question;
  if (!q || !q.id) return q ? {kind: q.kind, category: q.category, mode: q.mode, forId: q.forId} : null;
  const playingAlong = g.step === 'question' && viewerId && viewerId !== q.forId && ['turn', 'jackpot'].includes(q.kind);
  const showOptions = q.mode === 'choice' || q.revealed || g.step === 'steal' || playingAlong;
  const view = Q.publicView(q.id, {options: showOptions, reveal: q.revealed});
  const answers = {};
  for (const [pid, a] of Object.entries(q.answers)) {
    answers[pid] = q.revealed || pid === viewerId
      ? {choice: a.choice ?? null, text: a.text ?? null, correct: q.revealed ? a.correct : undefined, ms: a.at - g.stepStartedAt}
      : {answered: true};
  }
  return {
    kind: q.kind, category: q.category, mode: q.mode, forId: q.forId, participants: q.participants || null,
    along: Object.keys(q.along || {}), myAlong: viewerId && q.along?.[viewerId] ? q.along[viewerId].choice : null,
    ...view, answers, revealed: q.revealed, result: q.result || null, resultText: q.resultText || null, awards: q.awards || null,
  };
}

function publicFinal(room, viewerId) {
  const g = b(room), f = g.final;
  if (!f) return null;
  const done = g.step === 'finalResult' || g.step === 'over';
  const current = g.step === 'final' && f.index < f.ids.length ? Q.publicView(f.ids[f.index]) : null;
  const predictions = {};
  for (const [pid, n] of Object.entries(f.predictions)) predictions[pid] = done || pid === viewerId ? n : true;
  return {
    playerId: f.playerId, categories: f.categories, index: f.index, total: f.ids.length, need: f.need, current,
    results: f.results.map(r => r.correct), predictions, outcome: f.outcome, missed: f.missed || null, score: f.score ?? null,
    // On a loss, show the last question they missed and its answer.
    lastAnswer: done && f.results.some(r => !r.correct) ? Q.publicView(f.ids[f.results.map(r => r.correct).lastIndexOf(false)], {reveal: true}) : null,
  };
}

function publicBoard(room, forTv = false, viewerId = null) {
  const g = room.board;
  if (!g) return null;
  const active = player(room, g.activeId);
  return {
    step: g.step, version: g.version, turnNo: g.turnNo, activeId: g.activeId,
    deadline: g.deadline, stepStartedAt: g.stepStartedAt, paused: Number.isFinite(g.pausedAt), remaining: g.remaining ?? null,
    timeLimitAt: g.timeLimitAt, required: required(room),
    canFinal: g.step === 'turn' && active && active.tokens.length >= required(room),
    dice: g.dice, moveOptions: g.moveOptions, move: g.move, landed: g.landed || null,
    question: publicQuestion(room, viewerId),
    special: g.special ? {type: g.special.type, options: g.special.options || null, chosen: g.special.chosen ?? null, bet: g.special.bet || 0} : null,
    final: publicFinal(room, viewerId),
    minigame: g.minigame ? (phase4.SPECS[g.minigame.id] ? phase4.publicState(room, forTv, viewerId) : phase3.publicState(room, forTv)) : null,
    showdown: g.showdown ? phase5.publicState(room, forTv, viewerId) : null,
    miniResult: g.step === 'miniResult' ? g.miniResult : null,
    banner: g.banner, log: g.log,
    winnerId: g.winnerId, standings: g.standings, endReason: g.endReason || null,
  };
}

module.exports = {
  T, BRAINS, start, roll, choose, answer, tick, hostPause, hostResume, skipDisconnected, publicBoard, standings, required,
  minigameInput, minigameDraw, cheer, decideBid, debugStart,
};
