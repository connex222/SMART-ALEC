'use strict';
/**
 * Scores every question's wrong A-D options and lists the weakest first.
 *   node tools/score-options.js          -> writes data/weak-options.csv, prints a summary
 * A wrong option loses points when it obviously does not look like the right answer:
 * a number next to words, a sentence next to a name, a wildly different length, and so on.
 */
const fs = require('node:fs');
const path = require('node:path');
const {questions} = require('../data/questions.json');
const {answerType} = require('./build-questions');

const isNum = s => /^[£$€]?\d[\d,.]*\s*[a-z%]*$/i.test(s.trim());
const words = s => s.trim().split(/\s+/).length;
const capped = s => /^[A-Z0-9£$€"'‘“]/.test(s.trim());
const personLike = s => /^[A-Z][a-zé'’-]+(\s(van|de|von|da|of|the|[A-Z][a-zé'’.-]+)){1,3}$/.test(s.trim());

function score(q) {
  // Hand-written packs already have chosen wrong options.
  if (q.opts.length < 4 || /^smart-alec-/.test(q.source || '')) return {score: 0, reasons: []};
  const right = q.opts[q.correct];
  const type = answerType({q: q.q, a: q.a});
  let total = 0;
  const reasons = new Set();
  q.opts.forEach((o, i) => {
    if (i === q.correct) return;
    if (isNum(right) !== isNum(o)) { total += 3; reasons.add('number v words'); }
    if (Math.abs(words(right) - words(o)) >= 2) { total += 2; reasons.add('length of words'); }
    const ratio = o.length / Math.max(1, right.length);
    if (ratio > 2.6 || ratio < 0.35) { total += 2; reasons.add('length'); }
    if (capped(right) !== capped(o)) { total += 1; reasons.add('capitals'); }
    if (type === 'person' && personLike(right) && !personLike(o)) { total += 3; reasons.add('not a person'); }
    if (type !== 'person' && !personLike(right) && personLike(o) && words(right) <= 2) { total += 2; reasons.add('a person among things'); }
  });
  return {score: total, reasons: [...reasons]};
}

if (require.main === module) {
  const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'option-overrides.json'), 'utf8'));
  const rows = questions.map(q => ({q, ...score(q)})).sort((a, b) => b.score - a.score);
  const weak = rows.filter(r => r.score >= 4 && !overrides[r.q.id]);
  const csv = [['score', 'reasons', 'id', 'category', 'question', 'answer', 'wrong options']]
    .concat(weak.map(r => [r.score, r.reasons.join('; '), r.q.id, r.q.category, r.q.q, r.q.answer, r.q.opts.filter((_, i) => i !== r.q.correct).join(' | ')]))
    .map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'weak-options.csv'), '\ufeff' + csv);
  console.log(`${questions.length} questions, ${weak.length} with weak options (score 4+), ${Object.keys(overrides).length} already fixed.`);
}
module.exports = {score};
