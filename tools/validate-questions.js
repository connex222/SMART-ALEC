'use strict';
/**
 * Checks the question bank the live game reads (data/questions.json).
 * Fails (exit code 1) on anything that would break or spoil a question in play.
 *
 *   node tools/validate-questions.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CATEGORIES = ['potluck', 'screen', 'music', 'sport', 'timeplace', 'brainbox'];
const LEVELS = ['easy', 'medium', 'hard'];
const MIN_PER_CATEGORY = 150;          // enough for a full game without repeats
const MIN_FAMILY_PER_CATEGORY = 120;   // the Family setting (easy + medium)

const problems = [];
const fail = (id, msg) => problems.push(`${id}: ${msg}`);

let data;
try {
  data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'questions.json'), 'utf8'));
} catch (err) {
  console.error(`data/questions.json could not be read: ${err.message}`);
  process.exit(1);
}
const list = data.questions;
if (!Array.isArray(list) || !list.length) { console.error('data/questions.json has no questions.'); process.exit(1); }

const ids = new Set();
const perCategory = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
const familyPerCategory = Object.fromEntries(CATEGORIES.map(c => [c, 0]));

for (const q of list) {
  const id = q.id || '(no id)';
  if (!q.id) fail(id, 'missing id');
  else if (ids.has(q.id)) fail(id, 'duplicate id');
  ids.add(q.id);
  if (!CATEGORIES.includes(q.category)) fail(id, `unknown category "${q.category}"`);
  if (!LEVELS.includes(q.level)) fail(id, `unknown level "${q.level}"`);
  if (typeof q.q !== 'string' || q.q.trim().length < 8) fail(id, 'question text missing or too short');
  if (typeof q.answer !== 'string' || !q.answer.trim()) fail(id, 'answer missing');
  if (!Array.isArray(q.opts) || q.opts.length < 2 || q.opts.length > 4) fail(id, 'needs 2 to 4 options');
  else {
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.opts.length) fail(id, 'correct option index out of range');
    else if (q.opts[q.correct] !== q.answer) fail(id, `correct option "${q.opts[q.correct]}" is not the answer "${q.answer}"`);
    const seen = new Set(q.opts.map(o => String(o).trim().toLowerCase()));
    if (seen.size !== q.opts.length) fail(id, 'two options are the same');
    if (q.opts.some(o => !String(o).trim())) fail(id, 'an option is blank');
  }
  if (/Ã|â€|\uFFFD/.test(`${q.q}${q.answer}${(q.opts || []).join('')}`)) fail(id, 'garbled characters (bad text encoding)');
  if (CATEGORIES.includes(q.category)) {
    perCategory[q.category] += 1;
    if (q.level !== 'hard') familyPerCategory[q.category] += 1;
  }
}

for (const c of CATEGORIES) {
  if (perCategory[c] < MIN_PER_CATEGORY) fail(c, `only ${perCategory[c]} questions (need ${MIN_PER_CATEGORY})`);
  if (familyPerCategory[c] < MIN_FAMILY_PER_CATEGORY) fail(c, `only ${familyPerCategory[c]} Family questions (need ${MIN_FAMILY_PER_CATEGORY})`);
}

// Every source pack must be valid JSON, or the next rebuild would fail.
for (const file of fs.readdirSync(path.join(ROOT, 'source-banks')).filter(f => f.endsWith('.json'))) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, 'source-banks', file), 'utf8')); }
  catch (err) { fail(`source-banks/${file}`, `not valid JSON: ${err.message}`); }
}

if (problems.length) {
  console.error(`Question bank: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 60)) console.error(`  - ${p}`);
  if (problems.length > 60) console.error(`  ...and ${problems.length - 60} more`);
  process.exit(1);
}
console.log(`Question bank OK: ${list.length} questions.`, perCategory);
