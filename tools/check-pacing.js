'use strict';
/**
 * Guards game length. Plays simulated games at the default (Sociable) pace and
 * fails if they run too long, so a timing change can't quietly double every game.
 * Simulated players never tap "We're ready", so real games should be a little shorter.
 *
 *   node tools/check-pacing.js
 */
const {playOne} = require('./simulate');

const CHECKS = [
  {label: '6 players, full game', players: 6, settings: {}, games: 12, maxAverage: 60},
  {label: '4 players, Quick Game', players: 4, settings: {quickGame: true}, games: 12, maxAverage: 30},
];

let failed = false;
for (const c of CHECKS) {
  const minutes = Array.from({length: c.games}, () => playOne(c.players, c.settings).minutes);
  const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const ok = avg <= c.maxAverage;
  if (!ok) failed = true;
  console[ok ? 'log' : 'error'](`${ok ? 'OK  ' : 'SLOW'} ${c.label}: average ${avg.toFixed(1)} min (limit ${c.maxAverage}), longest ${Math.max(...minutes).toFixed(0)} min`);
}
if (failed) {
  console.error('Games at the default pace are running too long. Check recent timing changes in server/engine.js and server/games/.');
  process.exit(1);
}
