'use strict';
/**
 * What the game learns from play, shared by every room on this server:
 *
 *  - Recently asked questions, so regular players don't see repeats from one
 *    game to the next (the last RECENT_WINDOW questions asked are avoided while
 *    anything fresher is available).
 *  - How often each question is answered correctly. Once a question has been
 *    answered MIN_ATTEMPTS times, its real difficulty replaces the guessed one.
 *
 * Saved and restored alongside live games (see state-store.js).
 */
const RECENT_WINDOW = 1500;     // about 20 full games
const MIN_ATTEMPTS = 8;         // answers needed before trusting the numbers
const EASY_AT = 0.75;           // 75%+ right: easy
const MEDIUM_AT = 0.4;          // 40-75% right: medium, under 40%: hard

let seq = 0;                    // counts every question asked
const lastAsked = new Map();    // question id -> seq when last asked
const results = new Map();      // question id -> [attempts, correct]
let dirty = false;
const feedback = [];            // end-of-game feedback from players (newest last, at most 300)

/** A question was chosen for play. */
function markAsked(id) {
  seq += 1;
  lastAsked.set(id, seq);
  dirty = true;
  // Keep the map from growing forever: forget anything long out of the window.
  if (lastAsked.size > RECENT_WINDOW * 3) {
    for (const [k, v] of lastAsked) if (seq - v > RECENT_WINDOW) lastAsked.delete(k);
  }
}

/** True if the question was asked within the last RECENT_WINDOW questions. */
function isRecent(id) {
  const at = lastAsked.get(id);
  return at !== undefined && seq - at < RECENT_WINDOW;
}

/** When last asked (0 = never); lower is longer ago. */
function askedAt(id) { return lastAsked.get(id) || 0; }

/** Someone answered a question. Timeouts count as wrong for the active player. */
function record(id, correct) {
  if (!id) return;
  const r = results.get(id) || [0, 0];
  r[0] += 1;
  if (correct) r[1] += 1;
  results.set(id, r);
  dirty = true;
}

/** The level to use for a question: learned from play once there is enough data. */
function levelOf(q) {
  const r = results.get(q.id);
  if (!r || r[0] < MIN_ATTEMPTS) return q.level || 'medium';
  const rate = r[1] / r[0];
  return rate >= EASY_AT ? 'easy' : rate >= MEDIUM_AT ? 'medium' : 'hard';
}

/** A player's end-of-game feedback (already checked and trimmed by the gateway). */
function addFeedback(entry) {
  feedback.push(entry);
  if (feedback.length > 300) feedback.shift();
  dirty = true;
}

/** A short public summary (no player data): for /api/stats. */
function summary(all = []) {
  let answers = 0, learned = 0, moved = 0;
  const byId = new Map(all.map(q => [q.id, q]));
  for (const [id, [a]] of results) {
    answers += a;
    if (a >= MIN_ATTEMPTS) {
      learned += 1;
      const q = byId.get(id);
      if (q && levelOf(q) !== (q.level || 'medium')) moved += 1;
    }
  }
  const rated = [...results].filter(([, r]) => r[0] >= MIN_ATTEMPTS).map(([id, r]) => ({id, rate: r[1] / r[0], answers: r[0]}));
  rated.sort((x, y) => x.rate - y.rate);
  const show = list => list.map(x => ({id: x.id, question: byId.get(x.id)?.q || '', right: `${Math.round(x.rate * 100)}%`, answers: x.answers}));
  return {
    questionsAsked: seq, answersRecorded: answers, questionsWithEnoughAnswers: learned, levelChangedByPlay: moved,
    minimumAnswersBeforeLearning: MIN_ATTEMPTS, hardest: show(rated.slice(0, 10)), easiest: show(rated.slice(-10).reverse()),
    feedback: feedbackSummary(),
  };
}

/** Totals from players' feedback (individual notes are in the server log). */
function feedbackSummary() {
  const count = (key) => feedback.flatMap(f => f[key] || []).reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const rated = feedback.filter(f => f.fun);
  return {
    responses: feedback.length,
    averageFun: rated.length ? Math.round(10 * rated.reduce((a, f) => a + f.fun, 0) / rated.length) / 10 : null,
    bestBits: count('best'), dragged: count('drag'),
    latestNotes: feedback.filter(f => f.note).slice(-10).map(f => f.note),
  };
}

/* ---------- saving and restoring ---------- */
function snapshot() {
  return JSON.stringify({format: 1, seq, lastAsked: Object.fromEntries(lastAsked), results: Object.fromEntries(results), feedback});
}
function load(text) {
  if (!text) return false;
  const d = JSON.parse(text);
  if (d.format !== 1) return false;
  seq = Number.isFinite(d.seq) ? d.seq : 0;
  lastAsked.clear(); results.clear(); feedback.length = 0;
  if (Array.isArray(d.feedback)) feedback.push(...d.feedback.slice(-300));
  for (const [k, v] of Object.entries(d.lastAsked || {})) if (Number.isFinite(v)) lastAsked.set(k, v);
  for (const [k, v] of Object.entries(d.results || {})) if (Array.isArray(v) && v.length === 2) results.set(k, [v[0] | 0, v[1] | 0]);
  dirty = false;
  return true;
}
function takeDirty() { const was = dirty; dirty = false; return was; }
function reset() { seq = 0; lastAsked.clear(); results.clear(); feedback.length = 0; dirty = false; }

module.exports = {addFeedback, feedbackSummary, markAsked, isRecent, askedAt, record, levelOf, summary, snapshot, load, takeDirty, reset, RECENT_WINDOW, MIN_ATTEMPTS};
