'use strict';
/**
 * Question service. Questions live in data/questions.json (built by
 * tools/build-questions.js). The server is the only thing that ever sees the
 * right answer; phones and the TV get it only at the reveal.
 */
const crypto = require('node:crypto');
const stats = require('./stats');
const bank = require('../data/questions.json');
const {CATEGORY_IDS} = require('./board-layout');

const ALL = bank.questions;
const BY_ID = new Map(ALL.map(q => [q.id, q]));

// Which difficulty levels each lobby setting allows.
const LEVELS = {family: ['easy', 'medium'], mixed: ['easy', 'medium', 'hard'], buffs: ['medium', 'hard']};
function pool(category, includePreview, levels = LEVELS.mixed) {
  // Questions the owner marked "Fix" are left out of Family games until fixed.
  const family = !levels.includes('hard');
  // stats.levelOf uses the difficulty learned from play once a question has enough answers.
  return ALL.filter(q => q.category === category && (includePreview || !q.preview) && levels.includes(stats.levelOf(q)) && !(family && q.needsFix));
}

/**
 * Pick a question this room has not used yet. When a category runs dry, its
 * used list is cleared so the game never stalls.
 */
function pick(room, category, randomInt = crypto.randomInt, {finalRound = false} = {}) {
  const used = room.board.usedQuestions || (room.board.usedQuestions = []);
  const usedSet = new Set(used);
  const includePreview = room.settings.previewQuestions !== false;
  let levels = LEVELS[room.settings.level] || LEVELS.mixed;
  // The Final Round never uses hard questions, except for quiz buffs.
  if (finalRound && room.settings.level !== 'buffs') levels = levels.filter(l => l !== 'hard');
  if (!pool(category, includePreview, levels).length) levels = LEVELS.mixed;
  let options = pool(category, includePreview, levels).filter(q => !usedSet.has(q.id));
  if (!options.length) {
    const inCategory = new Set(pool(category, includePreview, levels).map(q => q.id));
    room.board.usedQuestions = used.filter(id => !inCategory.has(id));
    options = pool(category, includePreview, levels);
  }
  if (!options.length) options = ALL.filter(q => q.category === category);
  // Avoid questions asked in recent games. If everything left is recent, use the
  // ones asked longest ago.
  const fresh = options.filter(q => !stats.isRecent(q.id));
  if (fresh.length) options = fresh;
  else {
    const sorted = options.slice().sort((a, b) => stats.askedAt(a.id) - stats.askedAt(b.id));
    options = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 5)));
  }
  const q = options[randomInt(options.length)];
  room.board.usedQuestions.push(q.id);
  stats.markAsked(q.id);
  return q.id;
}

function get(id) { return BY_ID.get(id) || null; }

/** What the TV and phones may see. `reveal` adds the right answer. */
function publicView(id, {options = true, reveal = false} = {}) {
  const q = get(id);
  if (!q) return null;
  return {
    id: q.id, category: q.category, text: q.q,
    options: options ? q.opts.slice() : null,
    ...(reveal ? {correct: q.correct, answer: q.answer} : {}),
  };
}

/* ---------- typed-answer marking (from Pub Quiz Powerhouse answer-review.js) ---------- */
function normalise(value) {
  return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-GB').replace(/&/g, ' and ')
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9.\s]/g, ' ').replace(/\.(?!\d)/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function numbersToDigits(s) { return s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, w => String(NUMBER_WORDS.indexOf(w))); }
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length];
}
function approvedAnswers(q) {
  const base = String(q.a || '').replace(/\s*\([^)]*\)/g, ' ');
  const entries = base.split(/\s+\/\s+|\s+or\s+/i).concat([q.answer]);
  return [...new Set(entries.concat(q.accepted || []).map(x => numbersToDigits(normalise(x))).filter(Boolean))];
}

/**
 * Smart Alec has no quizmaster, so close spellings are accepted automatically:
 * one slip for answers of 5+ letters, two for 12+, and a surname on its own
 * for a full name.
 */
function markTyped(id, typed) {
  const q = get(id);
  if (!q) return false;
  const t = numbersToDigits(normalise(typed));
  if (!t) return false;
  const variants = approvedAnswers(q);
  if (variants.includes(t)) return true;
  if (variants.some(x => x.length >= 5 && t.length >= 4 && distance(x, t) <= (x.length >= 12 ? 2 : 1))) return true;
  if (variants.some(x => x.split(' ').length >= 2 && x.split(' ').at(-1) === t && t.length >= 4)) return true;
  return false;
}

/** How many questions each category offers at a lobby setting (learned levels included). */
function counts(includePreview = true, level = 'mixed') {
  return Object.fromEntries(CATEGORY_IDS.map(c => [c, pool(c, includePreview, LEVELS[level] || LEVELS.mixed).length]));
}

module.exports = {pick, get, publicView, markTyped, normalise, counts, ALL, LEVELS};
