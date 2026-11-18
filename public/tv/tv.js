'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const {el} = SA;
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const LETTERS = ['A', 'B', 'C', 'D'];
  const HOP_MS = 220;
  const SPECIAL_TEXT = {
    go: 'Pass GO for a Brain. Land on it exactly to buy a missing token for 10 Brains.',
    smartalec: 'Steal a token from any player who has one you are missing.',
    double: 'Bet up to 10 Brains, then type the answer. Right doubles it, wrong loses it.',
    freeforall: 'One question for everyone. Fastest correct answer wins 3 Brains.',
    shortcut: 'Jump to any other special space and do what it says.',
    swap: 'Swap places on the board with any player.',
    jackpot: 'A random category. Right answer wins that token and 2 Brains.',
    showdown: 'Pick an opponent. Fastest correct answer takes 4 Brains from the other.',
  };

  /* ---------- fit the 1920x1080 stage to the window ---------- */
  function fit() {
    const reserve = document.body.dataset.saScreen === 'title' ? 0 : 58;
    const height = Math.max(160, window.innerHeight - reserve);
    const s = Math.min(window.innerWidth / 1920, height / 1080);
    $('stage').style.top = reserve ? 'calc(50% - 29px)' : '50%';
    $('stage').style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  window.addEventListener('resize', fit); fit();

  /* ---------- state ---------- */
  const socket = io({transports: ['websocket', 'polling']});
  SA.reportErrors(socket, 'tv');
  if (new URLSearchParams(location.search).has('debug')) window.__saSocket = socket;
  let state = null, prev = null, layout = null, avatars = [];
  let boardBuilt = false;
  const positions = [];          // centre point of each space
  const shown = new Map();       // playerId -> space index currently drawn
  let animating = null;          // {playerId, timer}
  const session = () => SA.store.get('sa-tv');

  function toast(text) {
    const t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 4200);
  }
  async function send(event, data) {
    try { return await SA.request(socket, event, data); } catch (e) { toast(e.message); return null; }
  }
  function show(screen) {
    for (const s of ['title', 'lobby', 'game', 'over']) $('screen-' + s).hidden = s !== screen;
    document.body.dataset.saScreen = screen;
    fit();
    // Make the signature theme available on the title screen. Browsers may
    // require the first key/click to unlock audio; shared/client.js retries.
    if (screen === 'title') SA.playMusic('mus-lobby', 0.18);
  }
  const av = id => avatars.find(a => a.id === id);
  const playerById = id => state?.players.find(p => p.id === id);
  const catMeta = id => layout.categories.find(c => c.id === id) || (id === 'minigame' ? layout.minigame : null);

  /* ---------- title and lobby ---------- */
  // The logo may finish loading before this script runs, so check as well as listen.
  const logoReady = () => { $('title-wordmark').hidden = true; };
  if ($('title-logo').complete && $('title-logo').naturalWidth > 0) logoReady();
  else if ($('title-logo').complete) $('title-logo').hidden = true;
  $('title-logo').addEventListener('load', logoReady);
  $('title-logo').addEventListener('error', () => { $('title-logo').hidden = true; });
  $('btn-new').addEventListener('click', async () => {
    SA.playMusic('mus-lobby');
    const r = await send('room:create');
    if (!r) return;
    SA.store.set('sa-tv', {code: r.code, token: r.token});
    setJoin(r);
    onState(r.state);
  });
  /* ---------- full screen and the story of the name ---------- */
  const fsButtons = () => document.querySelectorAll('.fs-btn');
  function showFullscreen() {
    const on = Boolean(document.fullscreenElement);
    fsButtons().forEach(b => { b.textContent = on ? 'Exit full screen' : 'Full screen'; });
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => toast('This browser would not go full screen. Try the F11 key.'));
  }
  if (!document.fullscreenEnabled) fsButtons().forEach(b => { b.hidden = true; });
  fsButtons().forEach(b => b.addEventListener('click', toggleFullscreen));
  document.addEventListener('fullscreenchange', showFullscreen);
  Tutorial.wire();
  const openTutorial = () => { AlecVoice.setEnabled(AlecVoice.isEnabled()); Tutorial.open(avatars); };
  $('btn-howto').addEventListener('click', openTutorial);
  $('btn-howto-lobby').addEventListener('click', openTutorial);
  $('btn-story').addEventListener('click', () => { $('story').hidden = false; $('btn-story-close').focus(); });
  $('btn-story-close').addEventListener('click', () => { $('story').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('story').hidden = true; });

  function setJoin(r) {
    if (r.qrDataUrl) $('lobby-qr').src = r.qrDataUrl;
    if (r.joinUrl) $('lobby-url').textContent = r.joinUrl.replace(/^https?:\/\//, '');
    $('lobby-code').textContent = r.code;
  }
  const setting = patch => send('room:settings', {patch});
  $('set-quick').addEventListener('click', () => setting({quickGame: !state.settings.quickGame}));
  const PACE_ORDER = ['sociable', 'relaxed', 'normal'];
  const PACE_TEXT = {sociable: 'Sociable: time to react after big moments (recommended)', relaxed: 'Leisurely: lots of time, a chat after every turn (longer games)', normal: 'Brisk: quick-fire, no chat pauses'};
  $('set-relaxed').addEventListener('click', () => setting({timerSpeed: PACE_ORDER[(PACE_ORDER.indexOf(state.settings.timerSpeed || 'sociable') + 1) % PACE_ORDER.length]}));
  $('chat-next').addEventListener('click', () => send('game:next-turn'));
  $('set-preview').addEventListener('click', () => setting({previewQuestions: !state.settings.previewQuestions}));
  const LEVEL_TEXT = {family: 'Family: easy and medium', mixed: 'Mixed: everything', buffs: 'Quiz buffs: medium and hard'};
  $('set-level').addEventListener('click', () => {
    const order = ['mixed', 'family', 'buffs'];
    setting({level: order[(order.indexOf(state.settings.level || 'mixed') + 1) % order.length]});
  });
  $('set-time').addEventListener('click', () => {
    const order = [0, 30, 45, 60];
    setting({timeLimit: order[(order.indexOf(state.settings.timeLimit) + 1) % order.length]});
  });
  $('btn-start').addEventListener('click', () => { SA.sfx('sfx-go'); send('game:start'); });
  function showVoice() {
    $('set-voice').setAttribute('aria-pressed', String(AlecVoice.isEnabled()));
    $('btn-voice').textContent = AlecVoice.isEnabled() ? 'Voice on' : 'Voice off';
  }
  const toggleVoice = () => { AlecVoice.setEnabled(!AlecVoice.isEnabled()); showVoice(); };
  $('set-voice').addEventListener('click', toggleVoice);
  $('btn-voice').addEventListener('click', toggleVoice);
  showVoice();

  function renderLobby() {
    show('lobby');
    SA.playMusic('mus-lobby');
    if (prev?.phase !== 'lobby') AlecVoice.say(prev?.phase === 'over' ? 'play-again' : 'welcome');
    else if (state.players.length > prev.players.length) AlecVoice.say('join');
    const s = state.settings;
    $('set-quick').setAttribute('aria-pressed', String(s.quickGame));
    $('set-pace-label').textContent = PACE_TEXT[s.timerSpeed] || PACE_TEXT.sociable;
    $('set-relaxed').classList.toggle('on', s.timerSpeed !== 'normal');
    $('set-preview').setAttribute('aria-pressed', String(s.previewQuestions));
    $('set-time').classList.toggle('on', s.timeLimit > 0);
    $('set-time-label').textContent = s.timeLimit ? `${s.timeLimit} minutes` : 'None';
    $('set-level-label').textContent = LEVEL_TEXT[s.level || 'mixed'];
    $('lobby-code').textContent = state.code;
    $('lobby-count').textContent = `${state.players.length} of 8`;
    const list = $('lobby-players');
    list.replaceChildren();
    for (const p of [...state.players].sort((a, b) => a.seat - b.seat)) {
      const card = el('div', 'lobby-player' + (p.ready ? ' ready' : '') + (p.online ? '' : ' offline'));
      card.append(SA.avatarEl(av(p.avatarId), p.ready ? 'win' : 'think', 130), el('div', 'name', p.name), el('div', 'status', p.online ? (p.ready ? 'Ready' : 'Getting ready…') : 'Phone offline'));
      list.appendChild(card);
    }
    for (let i = state.players.length; i < 8; i++) list.appendChild(el('div', 'lobby-empty', 'Seat ' + (i + 1)));
    $('btn-start').disabled = !state.canStart;
    const notReady = state.players.filter(p => !p.ready).length;
    $('lobby-hint').textContent = state.players.length < 2 ? 'Waiting for at least 2 players.'
      : notReady ? `Waiting for ${notReady} player${notReady > 1 ? 's' : ''} to press READY.` : 'Everyone is ready. Start the show!';
  }

  /* ---------- board ---------- */
  // Matched to the cream rim of board-bg.webp (stage coordinates, background-size: cover).
  const CORNERS = [[42, 970], [503, 158], [1412, 158], [1871, 970]];
  function buildBoard() {
    const svg = $('board');
    svg.replaceChildren();
    positions.length = 0;
    for (let side = 0; side < 4; side++) {
      const [ax, ay] = CORNERS[side], [bx, by] = CORNERS[(side + 1) % 4];
      for (let i = 0; i < 16; i++) positions.push([ax + (bx - ax) * i / 16, ay + (by - ay) * i / 16]);
    }
    const pts = CORNERS.map(p => p.join(',')).join(' ');
    svg.appendChild(svgEl('polygon', {points: pts, class: 'track'}));
    // marquee bulbs just outside the track
    const bulbs = svgEl('g', {class: 'bulbs chase'});
    const cx = 960, cy = 560;
    for (let side = 0; side < 4; side++) {
      const [ax, ay] = CORNERS[side], [bx, by] = CORNERS[(side + 1) % 4];
      const n = side % 2 ? 26 : 14;
      for (let i = 0; i < n; i++) {
        const x = ax + (bx - ax) * (i + 0.5) / n, y = ay + (by - ay) * (i + 0.5) / n;
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        bulbs.appendChild(svgEl('circle', {cx: x + dx / d * 62, cy: y + dy / d * 62, r: 7, class: 'bulb'}));
      }
    }
    svg.appendChild(bulbs);
    const spaces = svgEl('g', {id: 'spaces'});
    for (const sp of layout.spaces) {
      const [x, y] = positions[sp.index];
      const special = sp.kind === 'special';
      const r = special ? 36 : 25;
      const g = svgEl('g', {class: `space ${special ? 'special' : 'cat-' + sp.type}`, id: 'space-' + sp.index});
      g.appendChild(svgEl('circle', {cx: x, cy: y, r: r + 10, class: 'ring'}));
      const base = svgEl('circle', {cx: x, cy: y, r, class: 'base'});
      if (!special) base.setAttribute('fill', catMeta(sp.type).colour);
      g.appendChild(base);
      const label = svgEl('text', {x, y, 'font-size': special ? 14 : 22});
      label.textContent = special ? (layout.specials.find(s => s.index === sp.index)?.short || '') : glyph(sp.type);
      g.appendChild(label);
      const art = svgEl('image', {x: x - r, y: y - r, width: r * 2, height: r * 2, href: special ? `/art/special-${sp.type}.webp` : `/art/icon-${artName(sp.type)}.webp`});
      art.addEventListener('error', () => art.remove());
      g.appendChild(art);
      const opt = svgEl('text', {x, y: y - r - 26, class: 'opt-label'});
      g.appendChild(opt);
      spaces.appendChild(g);
    }
    svg.appendChild(spaces);
    svg.appendChild(svgEl('g', {id: 'pieces'}));
    boardBuilt = true;
    // When the board art is there, its own rim and lights replace the drawn track.
    const art = new Image();
    art.onload = () => $('screen-game').classList.add('has-art');
    art.src = '/art/board-bg.webp';
  }
  function glyph(type) { return {potluck: '?', screen: '▶', music: '♪', sport: '★', timeplace: '◷', brainbox: '✦', minigame: '◆'}[type] || ''; }
  function artName(type) { return type; }

  function pieceFor(p) {
    let g = document.getElementById('piece-' + p.id);
    if (g) return g;
    const a = av(p.avatarId);
    g = svgEl('g', {class: 'piece', id: 'piece-' + p.id});
    const clipId = 'clip-' + p.id;
    const defs = svgEl('defs');
    const clip = svgEl('clipPath', {id: clipId});
    clip.appendChild(svgEl('circle', {cx: 0, cy: 0, r: 24}));
    defs.appendChild(clip);
    g.appendChild(defs);
    g.appendChild(svgEl('circle', {cx: 0, cy: 0, r: 24, fill: a?.colour || '#888'}));
    const t = svgEl('text', {x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 26, fill: '#FFF6E3', 'font-family': 'Cabin, sans-serif'});
    t.textContent = (a?.name || p.name).replace(/^The /, '').charAt(0);
    g.appendChild(t);
    if (a) {
      const img = svgEl('image', {x: -24, y: -24, width: 48, height: 48, href: a.images.think, 'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice'});
      img.addEventListener('error', () => img.remove());
      g.appendChild(img);
    }
    g.appendChild(svgEl('circle', {cx: 0, cy: 0, r: 24, class: 'edge'}));
    $('pieces').appendChild(g);
    return g;
  }

  function placePieces() {
    const groups = new Map();
    for (const p of state.players) {
      const at = shown.has(p.id) ? shown.get(p.id) : p.position;
      if (!groups.has(at)) groups.set(at, []);
      groups.get(at).push(p);
    }
    for (const [index, list] of groups) {
      let [x, y] = positions[index];
      // Sit pieces just inside the track so they never fall off the screen edge or hide the space.
      const dx = 960 - x, dy = 600 - y, d = Math.hypot(dx, dy) || 1;
      x += dx / d * 58; y += dy / d * 58;
      list.forEach((p, i) => {
        const n = list.length;
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const rad = n > 1 ? 30 : 0;
        const g = pieceFor(p);
        g.setAttribute('transform', `translate(${x + Math.cos(ang) * rad}, ${y + Math.sin(ang) * rad})`);
        g.classList.toggle('active', p.id === state.board.activeId);
      });
    }
    // active piece on top
    const act = document.getElementById('piece-' + state.board.activeId);
    if (act) act.parentNode.appendChild(act);
  }

  function animateMove(move) {
    if (!move || !move.path?.length) return;
    clearTimeout(animating?.timer);
    const id = move.playerId;
    let i = 0;
    shown.set(id, move.from);
    const stepOn = () => {
      shown.set(id, move.path[i]);
      placePieces();
      SA.sfx('sfx-hop', 0.5);
      i += 1;
      if (i < move.path.length) animating = {playerId: id, timer: setTimeout(stepOn, HOP_MS)};
      else animating = {playerId: id, timer: setTimeout(() => { shown.delete(id); animating = null; placePieces(); }, 300)};
    };
    animating = {playerId: id, timer: setTimeout(stepOn, 250)};
  }

  function markTargets() {
    document.querySelectorAll('.space.target').forEach(n => n.classList.remove('target'));
    const b = state.board;
    if (b.step !== 'direction' || !b.moveOptions) return;
    for (const o of b.moveOptions) {
      const g = document.getElementById('space-' + o.target);
      if (!g) continue;
      g.classList.add('target');
      g.querySelector('.opt-label').textContent = (o.dir > 0 ? '↻ ' : '↺ ') + o.steps;
    }
  }

  /* ---------- scoreboard in the middle of the board ---------- */
  function renderScores() {
    const box = $('scores');
    box.replaceChildren();
    box.classList.toggle('many', state.players.length > 6);
    for (const p of [...state.players].sort((a, b) => a.seat - b.seat)) {
      const row = el('div', 'score' + (p.id === state.board.activeId ? ' active' : '') + (p.online ? '' : ' offline'));
      const info = el('div', 'score-info');
      info.appendChild(el('div', 'score-name', p.name));
      info.appendChild(pips(p.tokens));
      const brains = el('div', 'score-brains', String(p.brains));
      brains.appendChild(el('small', null, 'Brains'));
      row.append(SA.avatarEl(av(p.avatarId), 'think', state.players.length > 6 ? 56 : 70), info, brains);
      box.appendChild(row);
    }
  }
  function pips(tokens) {
    const wrap = el('div', 'pips');
    for (const c of layout.categories) {
      const pip = el('span', `pip cat-${c.id}` + (tokens.includes(c.id) ? ' on' : ''));
      pip.title = c.name;
      wrap.appendChild(pip);
    }
    return wrap;
  }

  function renderBanner() {
    const b = state.board, n = $('banner');
    const text = b.banner?.text || '';
    if (n.textContent !== text) {
      n.textContent = text;
      n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop');
    }
    n.className = 'banner pop ' + (b.banner?.tone || '');
  }
  function renderDice() {
    const b = state.board, d = $('dice');
    const showDice = ['direction', 'moving'].includes(b.step) && b.dice;
    d.hidden = !showDice;
    if (!showDice) { d.dataset.v = ''; return; }
    const key = b.version + ':' + b.dice.join(',');
    if (b.step === 'direction' && d.dataset.v !== key) {
      d.dataset.v = key;
      d.replaceChildren(...b.dice.map(v => el('div', 'die', String(v))));
    }
  }

  /* ---------- the card overlay ---------- */
  function cardHead(category, whoId, title, special = false) {
    const meta = category ? catMeta(category) : null;
    const head = el('div', 'card-head' + (special ? ' special' : ''));
    if (meta) head.classList.add('cat-' + category);
    head.appendChild(el('span', 'cat-name', title || meta?.name || ''));
    if (whoId) {
      const p = playerById(whoId);
      const who = el('span', 'who');
      who.append(SA.avatarEl(av(p?.avatarId), 'think', 56), document.createTextNode(p?.name || ''));
      head.appendChild(who);
    }
    return head;
  }
  function optionsEl(q, {answersByChoice = {}} = {}) {
    const grid = el('div', 'opts');
    (q.options || []).forEach((o, i) => {
      const cls = q.revealed ? (i === q.correct ? ' right' : (answersByChoice[i]?.length ? ' wrong' : ' dim')) : '';
      const row = el('div', 'opt' + cls);
      row.append(el('span', 'letter', LETTERS[i]), el('span', 'opt-text', o));
      if (answersByChoice[i]?.length) {
        const who = el('span', 'who-picked');
        for (const pid of answersByChoice[i]) who.appendChild(SA.avatarEl(av(playerById(pid)?.avatarId), 'think', 44));
        row.appendChild(who);
      }
      grid.appendChild(row);
    });
    return grid;
  }
  function answeredRow(q, ids) {
    const row = el('div', 'answered');
    const done = ids.filter(id => q.answers[id]);
    if (!done.length) { row.textContent = 'Waiting for answers…'; return row; }
    row.appendChild(document.createTextNode('Locked in: '));
    for (const id of done) row.appendChild(SA.avatarEl(av(playerById(id)?.avatarId), 'think', 52));
    return row;
  }

  function renderCard() {
    const b = state.board, card = $('card'), q = b.question;
    if (b.step === 'minigame' || b.step === 'showdown') {
      $('overlay').hidden = false;
      card.classList.add('noggin');
      NogginTV.render(card, state, avatars);
      const duel = b.showdown;
      if (duel?.kind === 'bid' && duel.phase === 'review') {
        const row = el('div', 'judge-row');
        const yes = el('button', 'btn btn-gold', 'Accept answer'), no = el('button', 'btn btn-ghost', 'Reject answer');
        yes.addEventListener('click', () => send('game:bid-review', {accept: true}));
        no.addEventListener('click', () => send('game:bid-review', {accept: false}));
        row.append(yes, no);
        card.querySelector('.card-body')?.appendChild(row);
      }
      return;
    }
    card.classList.remove('noggin');
    if (b.step === 'miniResult' && b.miniResult) {
      $('overlay').hidden = false;
      card.replaceChildren();
      const head = el('div', 'card-head noggin-head');
      head.append(el('span', 'cat-name', b.miniResult.title), el('span', 'noggin-type', b.miniResult.kind === 'showdown' ? 'Showdown result' : 'Mini-game result'));
      const body = el('div', 'card-body');
      body.appendChild(el('p', 'special-text', b.miniResult.text));
      const list = el('div', 'predictions');
      for (const [pid, n] of Object.entries(b.miniResult.awards || {})) {
        const chip = el('span', 'prediction');
        chip.append(SA.avatarEl(av(playerById(pid)?.avatarId), n > 0 ? 'win' : 'lose', 52), document.createTextNode(`${playerById(pid)?.name}  ${n > 0 ? '+' : ''}${n} Brains`));
        list.appendChild(chip);
      }
      if (list.childElementCount) body.appendChild(list);
      card.append(head, body);
      return;
    }
    const steps = ['risk', 'question', 'reveal', 'steal', 'group', 'groupReveal', 'special', 'predict', 'final', 'finalResult'];
    // Chat pause: a bar along the bottom, with how many phones are ready.
    const chatting = b.step === 'turnEnd' && Boolean(b.chat);
    $('chatbar').hidden = !chatting;
    if (chatting) {
      $('chat-text').textContent = b.banner?.text || 'What a moment!';
      $('chat-ready').textContent = b.chat.ready ? `${b.chat.ready} of ${b.chat.needed} needed tapped "We're ready" on their phones` : 'Tap "We\'re ready" on your phones when you want to carry on';
    }
    const showIt = steps.includes(b.step) && !(b.step === 'special' && !b.special);
    $('overlay').hidden = !showIt;
    $('overlay').classList.toggle('final-backdrop', ['predict', 'final', 'finalResult'].includes(b.step));
    if (!showIt) { card.dataset.key = ''; return; }
    card.replaceChildren();
    const body = el('div', 'card-body');

    if (b.step === 'risk') {
      card.appendChild(cardHead(q.category, q.forId));
      body.append(el('p', 'special-text', b.banner?.text || ''), el('p', 'special-sub', 'Choosing on their phone…'));
    } else if (['question', 'reveal', 'steal', 'group', 'groupReveal'].includes(b.step) && q) {
      const titles = {steal: 'Up for grabs!', lightning: 'Lightning Round', freeforall: 'Free-for-All', showdown: 'Showdown', jackpot: 'Pot Luck Jackpot', double: 'Double or Nothing'};
      card.appendChild(cardHead(q.category, q.forId, titles[q.kind] ? `${titles[q.kind]} · ${catMeta(q.category).name}` : null));
      body.appendChild(el('p', 'q-text', q.text || ''));
      const byChoice = {};
      if (q.revealed) for (const [pid, a] of Object.entries(q.answers || {})) if (a.choice != null) (byChoice[a.choice] = byChoice[a.choice] || []).push(pid);
      if (q.mode === 'typed' && !q.revealed) {
        body.appendChild(el('p', 'q-mode', 'Going Smart: no options, the answer is typed on the phone.'));
      }
      if (q.options) body.appendChild(optionsEl(q, {answersByChoice: byChoice}));
      if (q.mode === 'typed' && q.revealed && q.forId) {
        const a = q.answers[q.forId];
        body.appendChild(el('p', 'typed ' + (a?.correct ? 'right' : 'wrong'), a?.text ? `“${a.text}”` : 'No answer'));
      }
      if (q.revealed && q.answer && !q.options) body.appendChild(el('p', 'reveal-answer', 'Answer: ' + q.answer));
      if (q.participants && !q.revealed) body.appendChild(answeredRow(q, q.participants));
      if (b.step === 'question' && q.along?.length) {
        const row = el('div', 'answered');
        row.appendChild(document.createTextNode('Playing along: '));
        for (const id of q.along) row.appendChild(SA.avatarEl(av(playerById(id)?.avatarId), 'think', 52));
        body.appendChild(row);
      }
      if (q.revealed && q.resultText && (b.step === 'groupReveal' || b.step === 'reveal')) body.appendChild(el('p', 'reveal-answer', q.resultText));
    } else if (b.step === 'special' && b.special) {
      card.appendChild(cardHead(null, b.activeId, layout.specials.find(s => s.id === b.special.type)?.name, true));
      const img = el('img', 'special-emblem');
      img.src = `/art/special-${b.special.type}.webp`; img.alt = '';
      img.addEventListener('error', () => img.remove());
      body.append(img, el('p', 'special-text', SPECIAL_TEXT[b.special.type] || ''), el('p', 'special-sub', 'Choosing on their phone…'));
      if (b.special.options) {
        const list = el('div', 'option-list');
        b.special.options.forEach((o, i) => list.appendChild(el('span', 'option-chip' + (b.special.chosen === i ? ' chosen' : ''), o.label)));
        body.appendChild(list);
      }
    } else if (['predict', 'final', 'finalResult'].includes(b.step) && b.final) {
      const f = b.final;
      card.appendChild(cardHead(null, f.playerId, 'The Final Round', true));
      const slots = el('div', 'final-slots');
      f.categories.forEach((c, i) => {
        const done = i < f.results.length;
        const miss = done && f.results[i] === false;
        const s = el('div', `final-slot cat-${c}` + (done ? (miss ? ' miss' : ' done') : '') + (b.step === 'final' && i === f.index ? ' current' : ''), done ? (miss ? '✕' : '✓') : '');
        slots.appendChild(s);
      });
      body.appendChild(slots);
      if (b.step === 'predict') {
        body.append(el('p', 'special-text', `${f.total} questions. One clock. ${f.need} right wins. Everyone else: how many will ${playerById(f.playerId)?.name} get right?`));
      } else if (b.step === 'final' && f.current) {
        body.appendChild(el('p', 'q-text', f.current.text));
        body.appendChild(optionsEl({options: f.current.options, revealed: false}));
      } else if (b.step === 'finalResult') {
        body.appendChild(el('p', 'special-text', b.banner?.text || ''));
        if (f.lastAnswer) body.appendChild(el('p', 'special-sub', `Missed: “${f.lastAnswer.text}” Answer: ${f.lastAnswer.answer}`));
      }
      const preds = el('div', 'predictions');
      for (const [pid, n] of Object.entries(f.predictions || {})) {
        const chip = el('span', 'prediction');
        chip.append(SA.avatarEl(av(playerById(pid)?.avatarId), 'think', 44), document.createTextNode(n === true ? 'Locked in' : `Says ${n}`));
        preds.appendChild(chip);
      }
      if (preds.childElementCount) body.appendChild(preds);
    }
    card.appendChild(body);
  }

  /* ---------- timer bar ---------- */
  const TIMED = new Set(['turn', 'direction', 'risk', 'question', 'steal', 'group', 'special', 'predict', 'final', 'minigame', 'showdown']);
  let clockFor = null, clockStart = 0;
  function tickTimer() {
    const b = state?.board;
    const t = $('timer');
    const m = b?.minigame, duel = b?.showdown;
    const deadline = m ? (m.phase === 'intro' ? m.introUntil : m.deadline) : duel ? duel.deadline : b?.deadline;
    if (!b || state.phase !== 'board' || !TIMED.has(b.step) || !deadline || b.paused) { t.hidden = true; return; }
    if (clockFor !== deadline) { clockFor = deadline; clockStart = Math.min(SA.now(), deadline); }
    const total = (m || duel) ? deadline - clockStart : deadline - b.stepStartedAt;
    const left = Math.max(0, deadline - SA.now());
    t.hidden = false;
    $('timer-fill').style.transform = `scaleX(${total > 0 ? left / total : 0})`;
    const secs = Math.ceil(left / 1000);
    $('timer-num').textContent = secs + 's';
    t.classList.toggle('low', secs <= 5);
    if (secs <= 5 && secs > 0 && tickTimer.last !== secs && ['question', 'steal', 'group', 'final'].includes(b.step)) SA.sfx('sfx-tick', 0.4);
    tickTimer.last = secs;
    if (b.step === 'final' && secs === 15 && hurrySaid !== b.deadline) { hurrySaid = b.deadline; AlecVoice.say('final-hurry', {interrupt: true}); }
  }
  setInterval(tickTimer, 200);

  /* ---------- sounds from state changes ---------- */
  function sounds(b, old) {
    const phase = b.minigame?.phase || b.showdown?.phase, oldPhase = old?.minigame?.phase || old?.showdown?.phase;
    if (old && phase && phase !== oldPhase) {
      if (b.showdown && phase === 'intro') SA.sfx('sfx-showdown');
      else if (b.minigame && phase === 'intro') SA.sfx('sfx-reel');
      else if (phase === 'reveal') SA.sfx('sfx-reel-stop');
    }
    if (!old || old.step === b.step) return;
    if (b.step === 'miniResult') SA.sfx(Object.values(b.miniResult?.awards || {}).some(n => n > 0) ? 'sfx-crowd-cheer' : 'sfx-crowd-aww', 0.6);
    const s = b.step;
    if (s === 'direction') SA.sfx('sfx-dice-roll');
    if (s === 'reveal') SA.sfx(b.question?.result === 'right' ? 'sfx-correct' : 'sfx-wrong');
    if (s === 'steal' || s === 'group') SA.sfx('sfx-buzz', 0.6);
    if (s === 'groupReveal') SA.sfx(Object.keys(b.question?.awards || {}).length ? 'sfx-spark-gain' : 'sfx-wrong');
    if (s === 'special') SA.sfx('sfx-swap', 0.6);
    if (s === 'predict') SA.sfx('sfx-showdown');
    if (s === 'finalResult') SA.sfx(b.final?.outcome === 'win' ? 'sfx-crowd-cheer' : 'sfx-crowd-aww');
  }

  /* ---------- Alec ---------- */
  const hostArt = {};
  function hostPose(b) {
    const q = b.question;
    if (b.step === 'reveal') return q?.result === 'right' ? 'laugh' : 'shock';
    if (b.step === 'groupReveal') return Object.keys(q?.awards || {}).length ? 'laugh' : 'shock';
    if (b.step === 'finalResult') return b.final?.outcome === 'win' ? 'laugh' : 'shock';
    if (b.step === 'miniResult') return Object.values(b.miniResult?.awards || {}).some(n => n > 0) ? 'laugh' : 'shock';
    if (['risk', 'question', 'steal', 'group', 'predict', 'final', 'minigame', 'showdown'].includes(b.step)) return 'think';
    return 'present';
  }
  function renderHost() {
    const pose = hostPose(state.board);
    const host = $('host');
    host.classList.toggle('on-card', !$('overlay').hidden);
    if (host.dataset.pose === pose) return;
    host.dataset.pose = pose;
    host.classList.remove('pose-present', 'pose-think', 'pose-laugh', 'pose-shock', 'bob');
    host.classList.add('pose-' + pose);
    void host.offsetWidth; host.classList.add('bob');
    const img = $('host-art');
    if (hostArt[pose] === false) { host.classList.remove('has-art'); return; }
    host.classList.remove('has-art');
    img.onload = () => { hostArt[pose] = true; host.classList.add('has-art'); };
    img.onerror = () => { hostArt[pose] = false; host.classList.remove('has-art'); };
    img.src = `/art/alec-${pose}.webp`;
  }

  /* ---------- what Alec says, worked out from what just changed ---------- */
  const SPECIAL_LINE = {go: 'special-go', smartalec: 'special-smartalec', double: 'special-double', freeforall: 'special-freeforall', shortcut: 'special-shortcut', swap: 'special-swap', jackpot: 'special-jackpot', showdown: 'special-showdown'};
  let hurrySaid = null;
  function narrate(b, old, oldState) {
    const say = AlecVoice.say;
    if (!old) { if (oldState?.phase !== 'board') say(oldState?.phase === 'over' ? 'play-again' : 'start'); return; }
    if (b.paused !== old.paused) { say(b.paused ? 'paused' : 'resumed', {interrupt: true}); return; }
    const f = b.final, of = old.final;
    if (b.step === 'final' && f && of && f.results.length > of.results.length) say(f.results.at(-1) ? 'final-right' : 'final-wrong', {interrupt: true});
    if (b.step === old.step && b.turnNo === old.turnNo) return;
    const q = b.question, active = state.players.find(p => p.id === b.activeId);
    switch (b.step) {
      case 'turn':
        if (b.canFinal) say('final-unlock');
        else if (active && AlecVoice.chance(0.75)) say('turn-' + String(active.avatarId).padStart(2, '0'));
        else say('turn-any');
        break;
      case 'direction':
        if (b.dice?.length > 1) say('catchup'); else if (AlecVoice.chance(0.35)) say('roll');
        break;
      case 'landed': {
        const type = b.landed?.type;
        if (b.landed?.kind === 'category') say('land-' + type);
        else if (SPECIAL_LINE[type]) say(SPECIAL_LINE[type]);
        if (/passing GO/.test(b.banner?.text || '')) say('pass-go');
        break;
      }
      case 'risk': say('choose'); break;
      case 'question':
        if (old.step === 'risk') say(q?.mode === 'typed' ? 'smart' : 'safe');
        break;
      case 'reveal': {
        if (q?.kind === 'double') { say(q.result === 'right' ? 'double-win' : 'double-lose'); break; }
        if (q?.result === 'right') {
          say('right');
          const before = oldState.players.find(p => p.id === q.forId), after = state.players.find(p => p.id === q.forId);
          if (after && before && after.tokens.length > before.tokens.length) say('token');
        } else say(q?.result === 'timeout' ? 'timeout' : 'wrong');
        break;
      }
      case 'steal': say('steal'); break;
      case 'group': if (q?.kind === 'freeforall') say('special-freeforall'); break;
      case 'groupReveal': say(Object.keys(q?.awards || {}).length ? (q.kind === 'steal' ? 'steal-won' : 'right') : 'nobody'); break;
      case 'minigame': say('minigame'); break;
      case 'showdown': say('showdown-start'); break;
      case 'miniResult': {
        const won = Object.values(b.miniResult?.awards || {}).some(n => n > 0);
        say(!won ? 'nobody' : b.miniResult.kind === 'showdown' ? 'showdown-win' : 'mini-win');
        break;
      }
      case 'turnEnd': if (old.special?.type === 'go' && /buys/.test(b.banner?.text || '')) say('buy-token'); break;
      case 'predict': say('predict'); break;
      case 'final': hurrySaid = null; say(b.required === 6 && AlecVoice.chance(0.5) ? 'final-start-1' : 'final-start-2', {interrupt: true}); break;
      case 'finalResult':
        if (f?.outcome === 'win') say('final-win', {interrupt: true});
        else say('final-lose-2', {interrupt: true});   // final-lose-1 mentions losing a token, which no longer happens
        break;
      default: break;
    }
  }

  function renderGame() {
    show('game');
    if (Tutorial.isOpen()) Tutorial.close();
    const b = state.board;
    SA.playMusic(['predict', 'final', 'finalResult', 'minigame', 'showdown'].includes(b.step) ? 'mus-tension' : 'mus-board');
    // Let conversation and Alec's result voice remain audible without musical pressure.
    SA.setMusicVolume(['turnEnd', 'miniResult', 'groupReveal', 'reveal'].includes(b.step) ? 0.10 : 0.24);
    if (!boardBuilt) buildBoard();
    if (b.step === 'moving' && b.move && (!prev?.board || prev.board.version !== b.version)) animateMove(b.move);
    placePieces();
    markTargets();
    renderScores();
    renderBanner();
    renderDice();
    renderCard();
    renderHost();
    $('paused').hidden = !b.paused;
    $('paused-text').textContent = !state.hostOnline ? 'Waiting for the TV to reconnect.' : b.pauseKind === 'restored' ? 'Your saved game is back! Press Resume (or Space) when everyone has rejoined.' : 'Press resume when everyone is ready.';
    $('btn-pause').textContent = b.paused ? 'Resume' : 'Pause';
    sounds(b, prev?.board);
    narrate(b, prev?.phase === 'board' ? prev.board : null, prev);
  }

  function renderOver() {
    show('over');
    SA.playMusic(null);
    if (prev?.phase !== 'over') { SA.sfx('mus-victory', 0.7); AlecVoice.say(state.board.endReason === 'time' ? 'over-time' : 'over-win'); }
    const b = state.board, winner = playerById(b.winnerId);
    const box = $('over-winner');
    box.replaceChildren(SA.avatarEl(av(winner?.avatarId), 'win', 280), el('h2', null, winner ? `${winner.name} is Smart Alec!` : 'Game over'),
      el('p', null, b.endReason === 'time' ? 'Time ran out: most tokens wins.' : 'All six right in the Final Round.'));
    const list = $('over-standings');
    list.replaceChildren();
    for (const s of b.standings || []) {
      const p = playerById(s.id);
      const li = el('li');
      li.append(el('span', 'place', String(s.place)), SA.avatarEl(av(p?.avatarId), s.place === 1 ? 'win' : 'lose', 56), document.createTextNode(`${p?.name}  ·  ${s.tokens} tokens, ${s.brains} Brains`));
      list.appendChild(li);
    }
  }
  $('btn-again').addEventListener('click', () => send('game:start'));
  $('btn-lobby').addEventListener('click', () => send('game:lobby'));
  $('btn-back-lobby').addEventListener('click', async () => {
    if (!state || state.phase === 'lobby') return;
    if (state.phase === 'board' && !confirm('End the current game and return everyone to this room’s lobby? Scores and progress will reset.')) return;
    const result = await send('game:lobby');
    if (result?.state) onState(result.state);
  });

  function onState(next) {
    if (!next) return;
    prev = state; state = next;
    SA.syncClock(next.serverNow);
    if (!layout) return;
    if (state.phase === 'lobby') { boardBuilt = false; renderLobby(); }
    else if (state.phase === 'board') renderGame();
    else if (state.phase === 'over') renderOver();
    tickTimer();
  }

  /* ---------- host controls ---------- */
  let hideBar;
  document.addEventListener('mousemove', () => { $('hostbar').classList.add('show'); clearTimeout(hideBar); hideBar = setTimeout(() => $('hostbar').classList.remove('show'), 3000); });
  $('btn-pause').addEventListener('click', () => send(state?.board?.paused ? 'game:resume' : 'game:pause'));
  $('btn-skip').addEventListener('click', () => send('game:skip-offline'));
  $('btn-mute').addEventListener('click', () => { SA.setMuted(!SA.isMuted()); $('btn-mute').textContent = SA.isMuted() ? 'Sound off' : 'Sound on'; if (!SA.isMuted() && state) onState(state); });
  $('btn-mute').textContent = SA.isMuted() ? 'Sound off' : 'Sound on';
  $('btn-close').addEventListener('click', async () => {
    if (!confirm('End this game and close the room?')) return;
    await send('room:close');
    SA.store.remove('sa-tv'); state = null; show('title');
  });
  document.addEventListener('keydown', e => { if (e.key === ' ' && state?.phase === 'board' && !Tutorial.isOpen()) { e.preventDefault(); $('btn-pause').click(); } });

  /* ---------- connection ---------- */
  socket.on('room:state', onState);
  socket.on('game:stroke', e => NogginTV.appendStroke(e, state));
  NogginTV.setOnHop(() => SA.sfx('sfx-hop', 0.5));
  socket.on('room:closed', () => { SA.store.remove('sa-tv'); state = null; show('title'); toast('The room was closed.'); });
  socket.on('room:session-replaced', () => toast('This game was opened on another screen.'));
  socket.on('connect', async () => {
    const s = session();
    if (!s) { show('title'); return; }
    try {
      const r = await SA.request(socket, 'room:resume', {code: s.code, token: s.token, role: 'host'});
      setJoin(r); onState(r.state);
    } catch (e) {
      if (['AUTH', 'ROOM', 'CODE'].includes(e.code)) { SA.store.remove('sa-tv'); show('title'); }
      else toast(e.message);
    }
  });

  function renderCast() {
    const box = $('title-cast');
    box.replaceChildren();
    avatars.forEach((a, i) => {
      const card = el('div', 'cast-card');
      card.style.setProperty('--i', String(i));
      card.append(SA.avatarEl(a, 'think', 118), el('span', 'cast-name', a.name));
      box.appendChild(card);
    });
  }

  Promise.all([SA.layout(), SA.avatars()]).then(([l, a]) => { layout = l; avatars = a; renderCast(); if (state) onState(state); }).catch(() => toast('Could not load the board. Refresh the page.'));
})();
