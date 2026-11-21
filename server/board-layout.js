'use strict';
/**
 * The Smart Alec board: 40 spaces around a trapezium, ten on each side.
 * The eight specials alternate with four ordinary spaces, preserving all
 * existing special actions while giving every on-screen tile more room.
 */
const SIZE = 40;

const CATEGORIES = Object.freeze([
  {id: 'potluck', name: 'Pot Luck', colour: '#7B4DFF', icon: '?'},
  {id: 'screen', name: 'Screen Time', colour: '#FF4F9A', icon: '🎬'},
  {id: 'music', name: 'Music', colour: '#FF7A3D', icon: '♪'},
  {id: 'sport', name: 'Sport', colour: '#2FBF4A', icon: '🏆'},
  {id: 'timeplace', name: 'Time & Place', colour: '#FFB800', icon: '🌍'},
  {id: 'brainbox', name: 'Brainbox', colour: '#00B8A9', icon: '💡'},
]);
const CATEGORY_IDS = Object.freeze(CATEGORIES.map(c => c.id));
const MINIGAME = Object.freeze({id: 'minigame', name: 'Mini-game', colour: '#2F7BFF', icon: '🎮'});

const SPECIALS = Object.freeze([
  {index: 0, id: 'go', name: 'GO', short: 'GO'},
  {index: 5, id: 'smartalec', name: 'Smart Alec', short: 'Steal'},
  {index: 10, id: 'double', name: 'Double or Nothing', short: 'Double'},
  {index: 15, id: 'freeforall', name: 'Free-for-All', short: 'Free 4 All'},
  {index: 20, id: 'shortcut', name: 'Shortcut', short: 'Shortcut'},
  {index: 25, id: 'swap', name: 'Swap', short: 'Swap'},
  {index: 30, id: 'jackpot', name: 'Pot Luck Jackpot', short: 'Jackpot'},
  {index: 35, id: 'showdown', name: 'Showdown', short: 'Showdown'},
]);

// Each run of four ordinary spaces rotates through the seven activity types.
// The 32 ordinary positions give each type four or five opportunities per lap.
const ORDER = ['potluck', 'screen', 'music', 'sport', 'timeplace', 'brainbox', 'minigame'];
function buildSpaces() {
  const spaces = [];
  for (let i = 0; i < SIZE; i++) {
    const special = SPECIALS.find(s => s.index === i);
    if (special) { spaces.push({index: i, kind: 'special', type: special.id, name: special.name}); continue; }
    const block = Math.floor(i / 5);          // 0..7
    const pos = (i % 5) - 1;                  // 0..3
    const type = ORDER[(pos + block * 5) % 7];
    const meta = type === 'minigame' ? MINIGAME : CATEGORIES.find(c => c.id === type);
    spaces.push({index: i, kind: type === 'minigame' ? 'minigame' : 'category', type, name: meta.name});
  }
  return Object.freeze(spaces.map(Object.freeze));
}
const SPACES = buildSpaces();

/** Where you land moving `steps` from `from`; dir is +1 clockwise, -1 anticlockwise. */
function target(from, steps, dir) { return ((from + dir * steps) % SIZE + SIZE) % SIZE; }
/** True if the move crosses or lands on GO (index 0). Leaving GO does not count. */
function passesGo(from, steps, dir) { return dir > 0 ? from + steps >= SIZE : from > 0 && from - steps <= 0; }

module.exports = {SIZE, SPACES, SPECIALS, CATEGORIES, CATEGORY_IDS, MINIGAME, target, passesGo};
