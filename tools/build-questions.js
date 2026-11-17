'use strict';
/**
 * Builds data/questions.json from the Pub Quiz Powerhouse banks in source-banks/.
 *
 *   node tools/build-questions.js                    (all banks; preview questions tagged)
 *   node tools/build-questions.js --signed-off-only  (leave the 2020-2026 preview out)
 *
 * Every question gets a Smart Alec category and four A-D options worked out here,
 * once, so the server never has to guess at game time. The option builder is the
 * Pub Quiz Powerhouse `choicesFor` / `makeWrong` logic, moved to Node.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'source-banks');
const OUT = path.join(ROOT, 'data', 'questions.json');
// The 2020-2026 editorial preview carries most of the Sport and Music questions,
// so it is included by default and every one of its questions is tagged
// preview:true. The lobby can switch preview questions off.
const includePreview = !process.argv.includes('--signed-off-only');

/* ---------- category mapping ---------- */
function categoryFor(roundCat) {
  const c = String(roundCat || '').toUpperCase();
  if (/MUSIC|SONG|SINGER|BAND|CHART|RING RING/.test(c)) return 'music';
  if (/\bTV\b|SCREEN|FILM|MOVIE|ROMCOM|DVD|BIG BROTHER|SOAP|CINEMA|CHILDREN/.test(c)) return 'screen';
  if (/SPORT|OLYMPIC|FOOTBALL|TENNIS|MOTORSPORT|CRICKET|RUGBY|GOLF|BOXING|FORMULA/.test(c)) return 'sport';
  if (/HISTOR|GEOGRAPH|NEWS|KINGS|LAKES|POPULATION|ELECTION|PRESIDENT|HAPPENED FIRST|UK LIFE|ENGLAND|NATIONALIT|\bWAR\b|CAPITAL|COUNTR|YEAR/.test(c)) return 'timeplace';
  if (/SCIENCE|NATURE|\bART\b|LITERAT|BOOK|FOOD|DRINK|TECH|CATS|ANIMAL|SPACE/.test(c)) return 'brainbox';
  return 'potluck';
}

/* ---------- questions that cannot stand alone ---------- */
const DEPENDS_ON_ROUND = /\b(this round|previous (\w+ )?(answers?|questions?)|the answer to question|last answer|each answer|answers in this|name (any|all) \w+)\b/i;
function usable(q) {
  const a = String(q.a || '').trim();
  const text = String(q.q || '').trim();
  if (!a || !text) return false;
  if (a.includes(';')) return false;            // list answers need a quizmaster
  if (DEPENDS_ON_ROUND.test(text)) return false;
  if (text.length > 260 || a.length > 60) return false;
  return true;
}

/* ---------- answer type, so wrong options look like the right one ---------- */
function answerType(q) {
  const t = String(q.q || '');
  const a = cleanAns(q.a);
  if (/^\d{4}$/.test(a) && /\b(year|when)\b/i.test(t)) return 'year';
  if (/^[£$€]?\d[\d,.]*\s*[a-z%]*$/i.test(a)) return 'number';
  if (/\bwho\b/i.test(t)) return 'person';
  if (/\b(country|countries|nation)\b/i.test(t)) return 'country';
  if (/\b(city|capital|town)\b/i.test(t)) return 'city';
  if (/\b(film|movie)\b/i.test(t)) return 'film';
  if (/\b(tv|television|programme|sitcom|soap|series|show)\b/i.test(t)) return 'tv';
  if (/\b(band|group|singer|song|single|album|hit)\b/i.test(t)) return 'music';
  if (/\b(animal|bird|creature|fish|insect|mammal|breed|dog)\b/i.test(t)) return 'animal';
  if (/\b(team|club)\b/i.test(t)) return 'team';
  if (/\b(cheese|dish|food|drink|cocktail|fruit|vegetable|dessert|cake|sauce|pastry|bread|wine|beer|spirit)\b/i.test(t)) return 'food';
  if (/\b(sport|event|game)\b/i.test(t)) return 'sportname';
  if (/\b(word|letters?|anagram|phrase)\b/i.test(t)) return 'word';
  if (/\b(author|novel|book|poet|play|painter|artist)\b/i.test(t)) return 'arts';
  if (/\b(river|sea|ocean|lake|mountain|island)\b/i.test(t)) return 'place';
  return 'other';
}

/* ---------- the noun the question asks for: "which ALBUM", "what FILM" ---------- */
const HEADS = 'film|movie|album|novel|book|club|team|country|countries|city|capital|singer|band|group|song|single|hit|show|series|programme|sitcom|soap|sport|animal|bird|fish|dog|breed|river|actor|actress|planet|element|colour|color|car|company|brand|newspaper|cheese|drink|cocktail|game|character|instrument|language|island|mountain|ocean|sea|desert|king|queen|president|poet|author|writer|artist|painter|composer|musical|opera|ballet|play|state|county|month|day|network|broadcaster|service|party|act|song|duo|rapper|comedian|footballer|player|driver|horse|racecourse|stadium|ground|festival|award|prize|dish|fruit|vegetable|spice|herb|flower|tree|bone|organ|gas|metal|currency|airline|ship|vessel|bridge|building|tower|church|cathedral|university|school|magazine|comic|cartoon|superhero|villain|wizard|detective|spy|word|letter|number';
const HEAD_RE = new RegExp('\\b(?:which|what|name the)\\s+(?:[a-z0-9’\'-]+\\s+){0,3}?(' + HEADS + ')s?\\b', 'i');
function headNoun(q) {
  const m = String(q.q || '').match(HEAD_RE);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return {movie: 'film', countries: 'country', color: 'colour', single: 'song', hit: 'song', sitcom: 'show', programme: 'show', series: 'show', group: 'band', duo: 'band', actress: 'actor', writer: 'author', painter: 'artist', novel: 'book', broadcaster: 'network', service: 'network'}[h] || h;
}
const personLike = s => /^[A-Z][a-zà-ÿ'’-]+(\s(van|de|von|da|of|the|[A-Z][a-zà-ÿ'’.-]+)){1,3}$/.test(String(s).trim());

/* ---------- "Is it X or Y?" questions keep just those two options ---------- */
function eitherOr(q) {
  const t = String(q.q || '').trim();
  const m = t.match(/(?:^|[,:\s])(?:is (?:it|an?|the)?\s*|was (?:it|an?|the)?\s*|does (?:it|she|he)?\s*|did (?:it|she|he)?\s*)?([^,:?]{1,40}?)\s+or\s+([^,:?]{1,40}?)\?\s*$/i);
  if (!m) return null;
  const strip = x => x.trim().replace(/^(an?|the|his|her|their)\s+/i, '').replace(/^(it|she|he)\s+/i, '').trim();
  // Use the shortest sensible phrase either side of "or": the words just before it, matched in length.
  const right = strip(m[2]);
  const leftWords = strip(m[1]).split(/\s+/);
  const left = leftWords.slice(-Math.max(1, right.split(/\s+/).length)).join(' ');
  const ans = normAns(cleanAns(q.a));
  const opts = [ucfirst(left), ucfirst(right)];
  const correct = opts.findIndex(o => normAns(o) === ans || ans.endsWith(normAns(o)) || normAns(o).endsWith(ans));
  if (correct < 0 || normAns(opts[0]) === normAns(opts[1])) return null;
  return {text: t, opts, correct, answer: opts[correct]};
}

/* ---------- Pub Quiz Powerhouse helpers (ported) ---------- */
const NUMW = ['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
function normAns(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2').replace(/&/g, ' and ').replace(/[^a-z0-9.\s]/g, ' ').replace(/\.(?!\d)/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, w => String(NUMW.indexOf(w) + 1))
    .replace(/\s+/g, ' ').trim();
}
const cleanAns = x => String(x || '').split(/\s+\/\s+/)[0].replace(/\s*\([^)]*\)/g, '').trim();
const ucfirst = s => s.charAt(0).toUpperCase() + s.slice(1);
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = (h >>> 0) || 1;
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return (h % 100000) / 100000; };
}
const LEX = {
  country: 'Afghanistan,Argentina,Australia,Austria,Belgium,Bosnia and Herzegovina,Botswana,Brazil,Bulgaria,Canada,Chile,China,Colombia,Croatia,Cuba,Cyprus,Czech Republic,Denmark,Egypt,England,Ethiopia,Finland,France,Germany,Ghana,Greece,Hungary,Iceland,India,Indonesia,Iran,Iraq,Ireland,Israel,Italy,Jamaica,Japan,Jordan,Kenya,Kosovo,Malta,Mexico,Morocco,Mozambique,Netherlands,New Zealand,Nigeria,Norway,Pakistan,Peru,Poland,Portugal,Romania,Russia,Rwanda,Saudi Arabia,Scotland,Serbia,South Africa,South Korea,Spain,Sweden,Switzerland,Taiwan,Tanzania,Thailand,Togo,Turkey,Uganda,Ukraine,United States,Uruguay,Vietnam,Wales,Zambia,Zimbabwe',
  city: 'Amsterdam,Athens,Barcelona,Beijing,Berlin,Birmingham,Bristol,Brussels,Budapest,Cairo,Calais,Cambridge,Canberra,Cardiff,Chicago,Cologne,Copenhagen,Dijon,Dublin,Edinburgh,Glasgow,Hamburg,Helsinki,Istanbul,Leeds,Lisbon,Liverpool,London,Madrid,Manchester,Melbourne,Memphis,Milan,Moscow,Munich,Naples,Newcastle,Nottingham,Oslo,Ottawa,Oxford,Paris,Perth,Prague,Preston,Rome,Rotterdam,Seoul,Sheffield,Stockholm,Sydney,Tokyo,Toronto,Venice,Vienna,Warsaw,Westminster,York,Blackpool,Brighton,Bournemouth,Scarborough,Eastbourne,Torquay,Skegness,Margate',
  state: 'Alabama,Alaska,Arizona,California,Colorado,Florida,Georgia,Hawaii,Idaho,Illinois,Kansas,Kentucky,Maine,Michigan,Montana,Nevada,New Hampshire,New Jersey,New Mexico,Ohio,Oregon,Tennessee,Texas,Utah,Vermont,Virginia,Wyoming',
  planet: 'Mercury,Venus,Earth,Mars,Jupiter,Saturn,Uranus,Neptune',
  colour: 'Red,Orange,Yellow,Green,Blue,Purple,Pink,Black,White,Brown,Grey,Silver',
  month: 'January,February,March,April,May,June,July,August,September,October,November,December',
  day: 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday',
  animal: 'Fox,Badger,Hare,Rabbit,Otter,Horse,Sheep,Goat,Pig,Mouse,Owl,Eagle,Canary,Parrot,Macaw,Puffin,Flamingo,Penguin,Lion,Tiger,Elephant,Giraffe,Bear,Wolf,Deer,Flea,Beetle,Spider,Crab,Dolphin,Shark,Hyena,Osprey,Colt,Mule',
  element: 'Hydrogen,Helium,Carbon,Nitrogen,Oxygen,Sodium,Iron,Copper,Lead,Neon,Argon,Calcium,Potassium,Zinc,Tin',
  sport: 'Football,Rugby,Cricket,Tennis,Golf,Snooker,Darts,Boxing,Wrestling,Basketball,Baseball,Hockey,Netball,Badminton,Squash,Cycling,Rowing,Athletics',
  numword: 'One,Two,Three,Four,Five,Six,Seven,Eight,Nine,Ten,Eleven,Twelve,Fifteen,Twenty',
  river: 'Thames,Severn,Trent,Tamar,Mersey,Tyne,Wye,Avon,Nile,Amazon,Danube,Rhine,Seine,Congo,Mississippi,Ganges,Volga,Shannon'
};
const LEX_LISTS = Object.values(LEX).map(s => s.split(','));
const KEYQ = [
  [/\b(country|countries|nation)\b/i, 'country'], [/\b(city|cities|capital|town|resort)\b/i, 'city'], [/\b(us|american) state\b/i, 'state'],
  [/\bcolou?r\b/i, 'colour'], [/\bplanet\b/i, 'planet'], [/\bmonth\b/i, 'month'], [/\bday of the week\b/i, 'day'],
  [/\b(animal|creature|bird|insect|mammal|breed)\b/i, 'animal'], [/\bsport\b/i, 'sport'], [/\b(element|gas)\b/i, 'element'], [/\briver\b/i, 'river']
];

function inlineOpts(q) {
  const t = String(q.q || '');
  const m = t.match(/^([\s\S]*?)\s*(?:\.\.\.|\u2026|:)?\s*\ba\)\s*([\s\S]+?)\s*[;,]\s*(?:or\s+)?b\)\s*([\s\S]+?)(?:\s*[;,]\s*(?:or\s+)?c\)\s*([\s\S]+?))?(?:\s*[;,]\s*(?:or\s+)?d\)\s*([\s\S]+?))?\s*\?\s*["'\u201d\u2019]?\s*$/i);
  if (!m) return null;
  const opts = [m[2], m[3], m[4], m[5]].filter(Boolean).map(s => ucfirst(s.trim()));
  const lm = String(q.a || '').match(/\/\s*([a-d])\s*$/i);
  let correct = lm ? 'abcd'.indexOf(lm[1].toLowerCase()) : -1;
  if (correct < 0) correct = opts.findIndex(o => normAns(o) === normAns(cleanAns(q.a)));
  if (correct < 0 || correct >= opts.length) return null;
  const stem = m[1].replace(/^["\u201c']/, '').trim();
  return {stem: stem ? stem + (/[?.!]$/.test(stem) ? '' : '?') : t, opts, correct};
}

function makeWrong(q, n, exclude, roundAnswers, allAnswers, typedPool) {
  const ans = cleanAns(q.a);
  if (!ans || n <= 0) return [];
  const rnd = seeded('w|' + q.q + '|' + ans);
  const avoid = new Set([normAns(ans), normAns(q.a)].concat((exclude || []).map(normAns)));
  const out = [];
  const add = c => { c = cleanAns(c); const k = normAns(c); if (c && k && !avoid.has(k)) { avoid.add(k); out.push(c); } };
  const pick = list => { const L = list.slice(); while (L.length && out.length < n) add(L.splice(Math.floor(rnd() * L.length), 1)[0]); };
  const m = ans.match(/^([£$€]?)(\d[\d,]*(?:\.\d+)?)(\s*[A-Za-z%.]*)$/);
  if (m) {
    const raw = m[2], v = parseFloat(raw.replace(/,/g, '')), dec = (raw.split('.')[1] || '').length, commas = raw.includes(',');
    const fmt = x => { let s = dec ? x.toFixed(dec) : String(Math.round(x)); if (commas || (!dec && Math.abs(x) >= 10000)) s = Number(s).toLocaleString('en-GB', {minimumFractionDigits: dec, maximumFractionDigits: dec}); return m[1] + s + m[3]; };
    let c;
    if (!dec && !commas && v >= 1000 && v <= 2100) c = [-30, -14, -9, -4, -2, 3, 5, 8, 13, 21].map(o => v + o).filter(x => x <= 2030);
    else if (!dec && /^\s*[ap]m$/i.test(m[3])) c = [1, 2, -1, -2, 3, -3].map(o => ((v + o + 11) % 12) + 1);
    else if (!dec && v <= 12) c = [1, 2, 3, -1, -2, -3, 4].map(o => v + o).filter(x => x >= 0);
    else c = [0.5, 0.75, 0.8, 1.2, 1.25, 1.5, 2].map(f => v * f).map(x => dec ? x : (v >= 100 ? Math.round(x / 10) * 10 : Math.round(x)));
    pick(c.map(fmt));
    if (out.length >= n) return out;
  }
  const na = normAns(ans);
  LEX_LISTS.forEach(list => { if (out.length < n && list.some(x => normAns(x) === na)) pick(list); });
  if (out.length >= n) return out;
  if (ans.split(/\s+/).length <= 3 && !/\d/.test(ans)) KEYQ.forEach(([re, key]) => { if (out.length < n && re.test(q.q || '')) pick(LEX[key].split(',')); });
  if (out.length >= n) return out;
  const words = ans.split(/\s+/).length, hasNum = /\d/.test(ans);
  const isPerson = x => /^[A-Z][a-z]+(\s[A-Z][a-z'’-]+){1,2}$/.test(x) && !/^The\s/.test(x);
  const person = isPerson(ans);
  const caps = x => /^[A-Z0-9£$€]/.test(x);
  const shape = x => { x = cleanAns(x); return x.length < 40 && Math.abs(x.split(/\s+/).length - words) <= 1 && isPerson(x) === person && /\d/.test(x) === hasNum
    && caps(x) === caps(ans) && x.length >= ans.length * 0.4 && x.length <= ans.length * 2.5 + 3; };
  if (typedPool) {
    if (typedPool.sameHead) pick(typedPool.sameHead.filter(shape));
    if (out.length < n && typedPool.sameHead && typedPool.sameHead.length >= 6) pick(typedPool.sameHead);
    if (out.length < n && typedPool.type === 'person') pick(typedPool.sameType.filter(x => personLike(cleanAns(x))));
    if (out.length < n) pick(typedPool.sameCat.filter(shape));
    if (out.length < n) pick(typedPool.sameType.filter(shape));
    if (out.length < n && typedPool.type !== 'other') pick(typedPool.sameType);
  }
  if (out.length < n) pick(roundAnswers.filter(shape));
  if (out.length < n) pick(allAnswers.filter(shape));
  if (out.length < n) pick(allAnswers);
  return out.slice(0, n);
}

// "Which happened first: a) X; or b) Y" style questions keep their own options.
function lettered(q) {
  const t = String(q.q || '');
  const m = t.match(/^([\s\S]*?)\s*\ba\)\s*([\s\S]+?)\s*[;,]?\s*(?:or\s+)?\bb\)\s*([\s\S]+?)(?:\s*[;,]?\s*(?:or\s+)?\bc\)\s*([\s\S]+?))?(?:\s*[;,]?\s*(?:or\s+)?\bd\)\s*([\s\S]+?))?\s*[?.]?\s*$/i);
  if (!m) return null;
  const opts = [m[2], m[3], m[4], m[5]].filter(Boolean).map(x => ucfirst(x.trim().replace(/[?.]$/, '')));
  const ans = String(q.a || '').trim();
  const letter = ans.match(/^\(?([a-d])\)/i) || ans.match(/\/\s*([a-d])\s*$/i);
  let correct = letter ? 'abcd'.indexOf(letter[1].toLowerCase()) : -1;
  const plain = normAns(ans.replace(/^\(?[a-d]\)\s*/i, ''));
  if (correct < 0) correct = opts.findIndex(o => normAns(o) === plain);
  if (correct < 0 || correct >= opts.length) return null;
  const stem = m[1].replace(/[:\s]+$/, '').trim();
  return {text: stem + (/[?.!]$/.test(stem) ? '' : '?'), opts, correct, answer: opts[correct]};
}

function choicesFor(q, roundAnswers, allAnswers, typedPool, override) {
  const lt = lettered(q);
  if (lt) return lt;
  if (!override) { const eo = eitherOr(q); if (eo) return eo; }
  const io = inlineOpts(q);
  if (io) return {text: io.stem, opts: io.opts, correct: io.correct, answer: io.opts[io.correct]};
  let wrong = (override || q.wrong || []).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
  // A hand-written override is used exactly as given (1 to 3 wrong options).
  if (!override && !(q.wrong || []).length && wrong.length < 3) wrong = wrong.concat(makeWrong(q, 3 - wrong.length, wrong, roundAnswers, allAnswers, typedPool));
  const rnd = seeded(q.id + '|' + q.a);
  const right = String(q.a || '').replace(/\s*\([^)]*\)/g, '').trim() || q.a;
  const order = [right].concat(wrong).map((o, i) => ({o, i, k: rnd()})).sort((x, y) => x.k - y.k);
  return {text: q.q, opts: order.map(x => x.o), correct: order.findIndex(x => x.i === 0), answer: right};
}

/* ---------- difficulty ----------
 * First pass, by where a question came from; data/difficulty-overrides.json
 * ({"QD101-Q04": "easy", ...}) corrects any single question.
 *   Smart Alec packs (written for families)      -> easy
 *   Pub Quiz Powerhouse quizzes                  -> medium
 *   2020-26 editorial preview (awards, news)     -> hard, unless it's a headline everyone knew
 */
const HEADLINE = /\b(world cup|euros?\b|wimbledon|best picture|prime minister|olympics?|king|queen|coronation|jubilee|eurovision song contest\b|premier league)\b/i;
function difficultyFor(q, file, preview) {
  if (['easy', 'medium', 'hard'].includes(q.level)) return q.level;   // a pack can set its own levels
  if (/^smart-alec-/.test(file)) return 'easy';
  if (preview) return HEADLINE.test(q.q) ? 'medium' : 'hard';
  return 'medium';
}

/* ---------- read the banks ---------- */
function readRounds() {
  const rounds = [];
  const add = (file, preview) => {
    const raw = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
    const quizzes = Array.isArray(raw) ? raw : raw.quizzes;
    for (const quiz of quizzes) for (const r of quiz.rounds || []) rounds.push({file, preview, type: r.type, questions: r.questions || []});
  };
  add('quizdemon-batch1.json', false);
  add('weekly-745-754-batch2.json', false);
  if (includePreview) add('2020-2026-editorial-preview.json', true);
  // New Smart Alec packs stay tagged as preview until the owner signs them off.
  for (const f of fs.readdirSync(SRC).filter(f => /^smart-alec-.*\.json$/.test(f)).sort()) if (includePreview) add(f, true);
  return rounds;
}

function build() {
  const rounds = readRounds();
  const allAnswers = rounds.flatMap(r => r.questions.map(q => q.a)).filter(Boolean);
  // Pools of answers grouped by answer type, and by type + category.
  const byType = new Map(), byTypeCat = new Map(), byHead = new Map();
  for (const r of rounds) for (const q of r.questions) {
    if (!q.a || String(q.a).includes(';')) continue;
    const t = answerType(q), k = t + '|' + categoryFor(q.cat);
    if (!byType.has(t)) byType.set(t, []);
    if (!byTypeCat.has(k)) byTypeCat.set(k, []);
    byType.get(t).push(q.a); byTypeCat.get(k).push(q.a);
    const h = headNoun(q);
    if (h) { if (!byHead.has(h)) byHead.set(h, []); byHead.get(h).push(q.a); }
  }
  const overridesFile = path.join(ROOT, 'data', 'option-overrides.json');
  const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {};
  const excluded = new Set(Array.isArray(overrides._exclude) ? overrides._exclude : []);
  // Hand-tidied wording for individual questions: {"PHNEW-0442": "Who played ...?"}
  const editsFile = path.join(ROOT, 'data', 'question-edits.json');
  const edits = fs.existsSync(editsFile) ? JSON.parse(fs.readFileSync(editsFile, 'utf8')) : {};
  // Owner's review decisions from the review page: {pack: {id: {d: keep|fix|cut, l?: level, n?: note}}}
  const reviewFile = path.join(ROOT, 'data', 'review-decisions.json');
  const reviewRaw = fs.existsSync(reviewFile) ? JSON.parse(fs.readFileSync(reviewFile, 'utf8')) : {};
  const review = {};
  for (const pack of Object.values(reviewRaw)) if (pack && typeof pack === 'object') Object.assign(review, pack);
  for (const [id, r] of Object.entries(review)) if (r && r.d === 'cut') excluded.add(id);
  const levelsFile = path.join(ROOT, 'data', 'difficulty-overrides.json');
  const levelOverrides = fs.existsSync(levelsFile) ? JSON.parse(fs.readFileSync(levelsFile, 'utf8')) : {};
  const seen = new Set();
  const out = [];
  let skipped = 0;
  for (const r of rounds) {
    const roundAnswers = r.type !== 'letters' ? r.questions.map(x => x.a).filter(Boolean) : [];
    for (const q of r.questions) {
      if (!usable(q) || seen.has(q.id) || excluded.has(q.id)) { skipped++; continue; }
      const type = answerType(q);
      const head = headNoun(q);
      const typedPool = {type, sameHead: head ? byHead.get(head) : null, sameCat: byTypeCat.get(type + '|' + categoryFor(q.cat)) || [], sameType: byType.get(type) || []};
      const c = choicesFor(q, roundAnswers, allAnswers, typedPool, Array.isArray(overrides[q.id]) ? overrides[q.id] : null);
      if (c.opts.length < 2 || c.opts.length > 4 || new Set(c.opts.map(normAns)).size !== c.opts.length) { skipped++; continue; }
      seen.add(q.id);
      out.push({
        id: q.id, category: categoryFor(q.cat), q: typeof edits[q.id] === 'string' ? edits[q.id] : c.text, a: String(q.a).trim(), answer: c.answer,
        opts: c.opts, correct: c.correct, accepted: Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : [],
        source: r.file.replace('.json', ''),
        // Reviewed and kept by the owner: no longer behind the "Unreviewed questions" switch.
        ...(r.preview && !(review[q.id] && review[q.id].d === 'keep') ? {preview: true} : {}),
        // Marked "Fix" on the review page: stays out of Family games until it is fixed.
        ...(review[q.id] && review[q.id].d === 'fix' ? {needsFix: true} : {}),
        level: ['easy', 'medium', 'hard'].includes(review[q.id] && review[q.id].l) ? review[q.id].l
          : ['easy', 'medium', 'hard'].includes(levelOverrides[q.id]) ? levelOverrides[q.id] : difficultyFor(q, r.file, r.preview)
      });
    }
  }
  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify({builtAt: new Date().toISOString().slice(0, 10), count: out.length, questions: out}));
  const counts = out.reduce((m, q) => (m[q.category] = (m[q.category] || 0) + 1, m), {});
  const levels = out.reduce((m, q) => (m[q.level] = (m[q.level] || 0) + 1, m), {});
  console.log('Difficulty:', levels);
  console.log(`Wrote ${out.length} questions to data/questions.json (${skipped} skipped).`);
  console.log(counts);
  // A review sheet: open it in Excel, fix weak wrong options, save them in data/option-overrides.json.
  const csv = [['id', 'category', 'level', 'question', 'answer', 'option A', 'option B', 'option C', 'option D', 'correct']]
    .concat(out.map(q => [q.id, q.category, q.level, q.q, q.answer, ...[0, 1, 2, 3].map(i => q.opts[i] || ''), 'ABCD'[q.correct]]))
    .map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  fs.writeFileSync(path.join(ROOT, 'data', 'options-review.csv'), '\ufeff' + csv);
}

if (require.main === module) build();
module.exports = {categoryFor, choicesFor, normAns, usable, answerType, headNoun};
