'use strict';
/**
 * How to Play: 18 narrated slides on the TV. Each slide plays /voice/tut-NN.mp3
 * and moves on when Alec finishes. Until the recordings exist, the browser's own
 * British voice reads the caption instead, and if there is no voice at all the
 * slide waits long enough to read it.
 */
window.Tutorial = (() => {
  const $ = id => document.getElementById(id);
  const {el} = SA;
  const CATS = [
    ['potluck', 'Pot Luck'], ['screen', 'Screen Time'], ['music', 'Music'],
    ['sport', 'Sport'], ['timeplace', 'Time & Place'], ['brainbox', 'Brainbox'],
  ];
  let avatars = [];
  let index = 0, playing = true, audio = null, timer = null, speaking = false;

  /* ---------- small picture builders ---------- */
  const img = (src, cls) => { const i = el('img', cls); i.src = src; i.alt = ''; i.addEventListener('error', () => i.remove()); return i; };
  const row = (cls, ...kids) => { const r = el('div', 'tut-row ' + (cls || '')); r.append(...kids); return r; };
  const labelled = (pic, text, cls = '') => { const b = el('div', 'tut-item ' + cls); b.append(pic, el('span', 'tut-label', text)); return b; };
  const token = id => img(`/art/token-${id}.webp`, 'tut-token');
  const icon = id => img(`/art/icon-${id}.webp`, 'tut-icon');
  const emblem = id => img(`/art/special-${id}.webp`, 'tut-emblem');
  const face = (n, pose = 'think', size = 120) => SA.avatarEl(avatars[n], pose, size);
  function phone(...lines) {
    const p = el('div', 'tut-phone');
    for (const [text, cls] of lines) p.appendChild(el('div', 'tut-phone-btn ' + (cls || ''), text));
    return p;
  }
  function question(text, opts, right = -1, wrong = -1) {
    const card = el('div', 'tut-q');
    card.appendChild(el('p', 'tut-q-text', text));
    const grid = el('div', 'tut-q-opts');
    opts.forEach((o, i) => grid.appendChild(el('div', 'tut-q-opt' + (i === right ? ' right' : '') + (i === wrong ? ' wrong' : ''), `${'ABCD'[i]}  ${o}`)));
    card.appendChild(grid);
    return card;
  }

  /* ---------- the slides ---------- */
  const SLIDES = [
    {title: 'Welcome to Smart Alec!', pose: 'present', line: "Welcome to Smart Alec! I'm Alec, your host, and I'll show you how to play. It only takes a couple of minutes.",
      show: () => row('', img('/art/logo.webp', 'tut-logo'))},
    {title: 'Join on your phone', pose: 'present', line: 'First, everyone joins on their phone. Scan the code on the TV, type your name and pick a character. Your phone is your controller for the whole game.',
      show: () => row('', phone(['Room code: ABCD', 'code'], ['Your name', 'field'], ["I'm ready", 'gold']), (() => { const g = el('div', 'tut-faces'); for (let i = 0; i < 12; i++) g.appendChild(face(i, 'think', 92)); return g; })())},
    {title: 'How to win', pose: 'present', line: "To win, collect six tokens, one from each category. Then beat the Final Round, and you're crowned Smart Alec.",
      show: () => row('', ...CATS.map(([id]) => token(id)), el('span', 'tut-arrow', '→'), img('/art/alec-laugh.webp', 'tut-crown'))},
    {title: 'The six categories', pose: 'present', line: 'The six categories are Pot Luck, Screen Time, Music, Sport, Time and Place, and Brainbox.',
      show: () => row('', ...CATS.map(([id, name]) => labelled(icon(id), name, 'cat-' + id)))},
    {title: 'Your turn', pose: 'present', line: 'On your turn, tap Roll on your phone. Then choose which way to go round the board: clockwise or anticlockwise. Pick the space you want.',
      show: () => row('', phone(['Roll the die', 'gold']), el('span', 'tut-die', '4'), phone(['Music · 4 clockwise ↻', 'cat-music'], ['Sport · 4 anticlockwise ↺', 'cat-sport']))},
    {title: 'Category spaces', pose: 'think', line: 'Land on a coloured space and you get a question from that category. Only you answer, everyone else can play along on the TV.',
      show: () => row('', icon('sport'), question('How many players are there in a rugby union team?', ['13', '15', '11', '12']))},
    {title: 'Play Safe or Go Smart', pose: 'think', line: "Now choose. Play Safe gives you four options to pick from. Go Smart means no options: type the answer yourself, and win bonus Brains if you're right.",
      show: () => row('', labelled(phone(['Play Safe', 'gold']), 'Four options to pick from'), labelled(phone(['Go Smart', 'ghost'], ['Type your answer…', 'field']), 'Type it: bonus Brains'))},
    {title: 'Right answers', pose: 'laugh', line: "Get it right and you win that category's token. Already got that one? You win Brains instead.",
      show: () => row('', question('How many players are there in a rugby union team?', ['13', '15', '11', '12'], 1), el('span', 'tut-arrow', '→'), token('sport'))},
    {title: 'Bonus Steal', pose: 'shock', line: 'Get it wrong, and the question goes up for grabs! Everyone else races to answer on their phones. The fastest right answer steals two Brains.',
      show: () => row('', question('Up for grabs!', ['13', '15', '11', '12'], -1, 0), face(2, 'win', 130), face(6, 'win', 130), el('span', 'tut-badge', '+2 Brains'))},
    {title: 'Brains', pose: 'present', line: "Brains are your points. You earn them from steals, mini-games and special spaces. Land exactly on GO with ten Brains, and you can buy a token you're missing.",
      show: () => row('', el('span', 'tut-badge big', '12 Brains'), el('span', 'tut-arrow', '→'), labelled(emblem('go'), 'Buy a token for 10'))},
    {title: 'Mini-games', pose: 'laugh', line: 'Land on a blue game space, and everybody plays a mini-game: drawing, guessing, reactions and more. Winners get three Brains each.',
      show: () => row('', labelled(icon('minigame'), 'Mini-game space'), el('div', 'tut-games', '16 games: Quick Draw · Odd Spot · Colour Clash · Sketch & Sabotage · Bomb Squad · Caption This · and more'), el('span', 'tut-badge', '+3 Brains'))},
    {title: 'Special spaces', pose: 'present', line: 'The gold spaces are special. GO pays you a Brain every time you pass it. Smart Alec lets you pinch a token from another player. Double or Nothing: bet your Brains on one tough question. And Free-for-All: everyone answers, fastest wins.',
      show: () => row('', labelled(emblem('go'), 'GO: +1 Brain'), labelled(emblem('smartalec'), 'Smart Alec: steal a token'), labelled(emblem('double'), 'Double or Nothing'), labelled(emblem('freeforall'), 'Free-for-All'))},
    {title: 'More special spaces', pose: 'present', line: 'Shortcut jumps you to any other gold space. Swap trades places with any player. The Jackpot is a random question with a big reward. And Showdown: pick an opponent for a head-to-head battle. The winner takes Brains from the loser, and anyone who backed the winner gets one too.',
      show: () => row('', labelled(emblem('shortcut'), 'Shortcut'), labelled(emblem('swap'), 'Swap'), labelled(emblem('jackpot'), 'Jackpot'), labelled(emblem('showdown'), 'Showdown'))},
    {title: 'The Final Round', pose: 'think', line: 'Got all six tokens? On your next turn, go for Smart Alec! You get six questions and just sixty seconds. Before you start, everyone else guesses your score. Guess it exactly, and win two Brains.',
      show: () => row('final', ...CATS.map(([id]) => token(id)), el('span', 'tut-badge big', '6 questions · 60 seconds'))},
    {title: 'Winning and losing', pose: 'laugh', line: "Get all six right, and you're crowned Smart Alec! Miss just one, and you lose that category's token. Win it back, and try again.",
      show: () => row('', labelled(face(4, 'win', 170), 'All six right: you win!'), labelled(face(4, 'lose', 170), 'Miss one: lose that token'))},
    {title: 'Catching up', pose: 'present', line: "Falling behind? Don't worry. If the leader is nearly there and you're not, you'll get two dice and choose the one you like.",
      show: () => row('', el('span', 'tut-die', '2'), el('span', 'tut-die', '5'), el('span', 'tut-badge', 'Pick either one'))},
    {title: 'Game options', pose: 'present', line: 'In the lobby you can choose a Quick Game, with four tokens instead of six, set a time limit, or give everyone more time to answer.',
      show: () => row('', ...['Quick game: 4 tokens', 'Time limit', 'Relaxed timers', "Alec's voice"].map(t => el('div', 'tut-toggle', t)))},
    {title: "Let's play!", pose: 'laugh', line: "That's everything! Now grab your phones, and let's find out who's the real Smart Alec.",
      show: () => row('', img('/art/logo.webp', 'tut-logo'))},
  ];

  /* ---------- narration ---------- */
  function stopVoice() {
    clearTimeout(timer);
    if (audio) { audio.pause(); audio = null; }
    if (speaking) { try { speechSynthesis.cancel(); } catch { /* no speech */ } speaking = false; }
  }
  function readingTime(line) { return Math.max(4000, line.split(/\s+/).length * 380); }
  function afterLine() {
    if (!playing) return;
    timer = setTimeout(() => { if (index < SLIDES.length - 1) go(index + 1); else markDone(); }, 900);
  }
  function speakFallback(line) {
    // No recording yet: use the browser's British voice if there is one, otherwise just wait.
    try {
      if (!window.speechSynthesis || SA.isMuted()) throw new Error('none');
      const u = new SpeechSynthesisUtterance(line);
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find(v => /en-GB/i.test(v.lang) && /male|daniel|george|arthur/i.test(v.name)) || voices.find(v => /en-GB/i.test(v.lang)) || null;
      u.lang = 'en-GB'; u.rate = 1; u.pitch = 0.9;
      const started = Date.now();
      // If the browser 'speaks' suspiciously fast (no real voice installed), give people time to read instead.
      const finished = () => {
        if (!speaking) return;
        speaking = false;
        const left = readingTime(line) * 0.8 - (Date.now() - started);
        if (left > 0) timer = setTimeout(afterLine, left); else afterLine();
      };
      u.onend = finished;
      u.onerror = finished;
      speaking = true;
      speechSynthesis.speak(u);
      setTimeout(() => { if (speaking && !speechSynthesis.speaking) finished(); }, 1500);
    } catch {
      timer = setTimeout(afterLine, readingTime(line));
    }
  }
  function narrate(i) {
    stopVoice();
    const n = String(i + 1).padStart(2, '0');
    const line = SLIDES[i].line;
    if (SA.isMuted() || !AlecVoice.isEnabled()) { timer = setTimeout(afterLine, readingTime(line)); return; }
    const a = new Audio(`/voice/tut-${n}.mp3`);
    audio = a;
    a.addEventListener('ended', () => { if (audio === a) { audio = null; afterLine(); } });
    a.addEventListener('error', () => { if (audio === a) { audio = null; speakFallback(line); } });
    a.play().catch(() => { if (audio === a) { audio = null; speakFallback(line); } });
  }

  /* ---------- drawing ---------- */
  function render() {
    const s = SLIDES[index];
    $('tut-title').textContent = s.title;
    $('tut-step').textContent = `${index + 1} of ${SLIDES.length}`;
    $('tut-caption').textContent = s.line;
    $('tut-stage').replaceChildren(s.show());
    const alec = $('tut-alec');
    alec.src = `/art/alec-${s.pose}.webp`;
    $('tut-dots').replaceChildren(...SLIDES.map((_, i) => {
      const d = el('button', 'tut-dot' + (i === index ? ' on' : '') + (i < index ? ' done' : ''));
      d.setAttribute('aria-label', `Step ${i + 1}`);
      d.addEventListener('click', () => go(i));
      return d;
    }));
    $('tut-back').disabled = index === 0;
    $('tut-next').textContent = index === SLIDES.length - 1 ? 'Finish' : 'Next';
    $('tut-play').textContent = playing ? 'Pause' : 'Play';
    $('tut-card').classList.remove('enter'); void $('tut-card').offsetWidth; $('tut-card').classList.add('enter');
  }
  function go(i) {
    index = Math.max(0, Math.min(SLIDES.length - 1, i));
    render();
    if (playing) narrate(index); else stopVoice();
  }
  function markDone() { $('tut-next').textContent = 'Finish'; }

  function open(avatarList) {
    avatars = avatarList || [];
    playing = true;
    $('tutorial').hidden = false;
    SA.duck(true);
    go(0);
    $('tut-next').focus();
  }
  function close() {
    stopVoice();
    $('tutorial').hidden = true;
    SA.duck(false);
  }

  /* ---------- controls: buttons, keyboard and TV remote arrows ---------- */
  function wire() {
    $('tut-next').addEventListener('click', () => { if (index === SLIDES.length - 1) close(); else go(index + 1); });
    $('tut-back').addEventListener('click', () => go(index - 1));
    $('tut-play').addEventListener('click', () => { playing = !playing; render(); if (playing) narrate(index); else stopVoice(); });
    $('tut-close').addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if ($('tutorial').hidden) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); $('tut-next').click(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
      else if (e.key === 'Escape') close();
      else if (e.key === ' ') { e.preventDefault(); $('tut-play').click(); }
    });
    try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); } catch { /* none */ }
  }

  return {open, close, wire, isOpen: () => !$('tutorial').hidden, count: SLIDES.length};
})();
