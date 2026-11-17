'use strict';
/**
 * Makes sure every file the game can ask for actually exists:
 * Alec's voice lines, the tutorial narration, sounds, avatars and art.
 * A missing file fails silently in the browser, so this catches it first.
 *
 *   node tools/check-assets.js
 */
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const exists = f => fs.existsSync(path.join(PUB, f));
const missing = [];
const need = (file, why) => { if (!exists(file)) missing.push(`${file}  (${why})`); };

const CATEGORIES = ['potluck', 'screen', 'music', 'sport', 'timeplace', 'brainbox'];
const SPECIALS = ['go', 'smartalec', 'double', 'freeforall', 'shortcut', 'swap', 'jackpot', 'showdown'];

/* ---------- Alec's game lines ---------- */
const voice = read('tv/voice.js');
// The GROUPS table is plain object syntax from our own file, so read it as code.
const groups = new Function(`return {${voice.match(/const GROUPS = \{([^}]*)\}/)[1]}};`)();
for (const [name, takes] of Object.entries(groups)) for (let i = 1; i <= takes; i++) need(`voice/${name}-${i}.mp3`, 'Alec game line');
const tv = read('tv/tv.js');
const said = new Set();
// Only look inside calls that play Alec's voice: say(...) and AlecVoice.say(...).
for (const m of tv.matchAll(/(?:AlecVoice\.)?\bsay\(([^;]*?)\)(?:;|\s*\/\/|\s*$)/gm)) {
  for (const n of m[1].matchAll(/(?<!(?:===|!==)\s*)'([a-z0-9-]+)'/g))  // skip comparisons like === 'over'
    if (!n[1].endsWith('-') && !['interrupt'].includes(n[1])) said.add(n[1]);
}
for (const m of tv.matchAll(/SPECIAL_LINE = \{([^}]*)\}/g)) for (const n of m[1].matchAll(/'(special-[a-z]+)'/g)) said.add(n[1]);
for (const c of CATEGORIES) said.add(`land-${c}`);
for (let i = 1; i <= 12; i++) said.add(`turn-${String(i).padStart(2, '0')}`);
for (const name of said) if (!groups[name] && /^[a-z]/.test(name) && !/^(mus|sfx)-/.test(name)) need(`voice/${name}.mp3`, 'Alec game line');

/* ---------- tutorial narration ---------- */
const tut = read('tv/tutorial.js');
const slides = (tut.match(/\{title: /g) || []).length;
const overrides = [...tut.matchAll(/\{title:[^\n]*?file: '(tut-[0-9a-z]+)'/g)].map(m => m[1]);
const overriddenSlides = new Set();
tut.split('{title: ').slice(1).forEach((s, i) => { const f = s.match(/file: '(tut-[0-9a-z]+)'/); if (f) overriddenSlides.add(i + 1); });
for (let i = 1; i <= slides; i++) if (!overriddenSlides.has(i)) need(`voice/tut-${String(i).padStart(2, '0')}.mp3`, 'tutorial narration');
for (const f of overrides) need(`voice/${f}.mp3`, 'tutorial narration');

/* ---------- sounds ---------- */
const client = read('shared/client.js');
const audio = client.match(/const AUDIO = \{([\s\S]*?)\};/)[1];
for (const m of audio.matchAll(/'([a-z-]+)':\s*'([a-z0-9]+)'/g)) need(`sounds/${m[1]}.${m[2]}`, 'sound');

/* ---------- avatars ---------- */
for (const a of JSON.parse(read('shared/avatars.json'))) for (const [pose, url] of Object.entries(a.images)) need(url.replace(/^\//, ''), `avatar ${a.name} ${pose}`);

/* ---------- art: named directly in HTML, CSS and JS ---------- */
for (const f of ['tv/index.html', 'tv/tv.css', 'tv/tv.js', 'tv/tutorial.js', 'play/index.html', 'play/play.css', 'play/play.js', 'shared/theme.css']) {
  for (const m of read(f).matchAll(/\/art\/([a-z0-9-]+\.webp)/g)) need(`art/${m[1]}`, `named in ${f}`);
}
/* ---------- art: built from category, special and pose names ---------- */
for (const c of [...CATEGORIES, 'minigame']) need(`art/icon-${c}.webp`, 'board space icon');
for (const c of CATEGORIES) need(`art/token-${c}.webp`, 'category token');
for (const s of SPECIALS) need(`art/special-${s}.webp`, 'special space badge');
for (const pose of ['present', 'think', 'laugh', 'shock']) need(`art/alec-${pose}.webp`, 'Alec pose');

if (missing.length) {
  console.error(`Assets: ${missing.length} missing file(s)`);
  for (const m of missing) console.error(`  - public/${m}`);
  process.exit(1);
}
console.log(`Assets OK: ${Object.values(groups).reduce((a, b) => a + b, 0) + said.size} voice names, ${slides} tutorial slides, sounds, avatars and art all present.`);
