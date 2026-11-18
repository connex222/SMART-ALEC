'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const {el} = SA;
  const LETTERS = ['A', 'B', 'C', 'D'];
  const socket = io({transports: ['websocket', 'polling']});
  SA.reportErrors(socket, 'phone');
  let state = null, layout = null, avatars = [];
  let pickedAvatar = null;
  let panelKey = '';
  const params = new URLSearchParams(location.search);

  const session = () => SA.store.get('sa-player');
  const me = () => state?.players.find(p => p.id === state.you);
  const av = id => avatars.find(a => a.id === id);
  const nameOf = id => state?.players.find(p => p.id === id)?.name || 'Someone';
  const catMeta = id => layout?.categories.find(c => c.id === id) || (id === 'minigame' ? layout?.minigame : null);
  function show(view) {
    // A join-name or typed-answer field must not keep the soft keyboard open
    // after the phone has switched to a button-only screen.
    const oldView = document.activeElement?.closest?.('.view');
    if (oldView && oldView.id !== 'view-' + view) SAKeyboard.dismiss(oldView);
    for (const v of ['join', 'lobby', 'game', 'over']) $('view-' + v).hidden = v !== view;
  }
  async function send(event, data) {
    try { return await SA.request(socket, event, data); }
    catch (e) { flash(e.message); if (e.code === 'AUTH') { SA.store.remove('sa-player'); state = null; renderJoin(); } return null; }
  }
  function flash(text) { const n = $('game-banner'); if (n) { n.textContent = text; n.className = 'game-banner result-bad'; } $('join-error').textContent = text; }

  /* ---------- the logo: picture if it loads, wordmark if not ---------- */
  document.querySelectorAll('.logo-img').forEach(img => {
    const ok = () => img.closest('.logo').classList.add('has-art');
    if (img.complete && img.naturalWidth > 0) ok(); else img.addEventListener('load', ok);
    img.addEventListener('error', () => img.remove());
  });

  /* Fullscreen must have a discoverable control even where the browser
     forbids the API (notably some iPhones). Never show a dead button. */
  {
    const fs = $('btn-fs-phone');
    const supported = typeof document.documentElement.requestFullscreen === 'function' &&
      typeof document.exitFullscreen === 'function';
    fs.hidden = false;
    fs.disabled = !supported;
    fs.title = supported ? 'Toggle fullscreen' : 'This browser does not support webpage fullscreen';
    fs.setAttribute('aria-label', supported ? 'Toggle fullscreen' : 'Fullscreen unavailable in this browser');
    fs.addEventListener('click', async () => {
      if (!supported) return;
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (_) { fs.title = 'Fullscreen was blocked; try your browser controls'; }
    });
    document.addEventListener('fullscreenchange', () => {
      fs.textContent = document.fullscreenElement ? '⤢ Exit fullscreen' : '⛶ Fullscreen';
    });
  }

  $('phone-back-lobby').addEventListener('click', event => {
    if (state && state.phase !== 'lobby' &&
        !confirm('Return to Games Night? The game will continue on the TV. You can rejoin this room later.')) event.preventDefault();
  });

  /* ---------- join ---------- */
  function avatarGrid(container, taken, current, onPick) {
    container.replaceChildren();
    for (const a of avatars) {
      const b = el('button', 'avatar-btn' + (a.id === current ? ' picked' : ''));
      b.type = 'button';
      b.disabled = taken.has(a.id) && a.id !== current;
      b.append(SA.avatarEl(a, 'think', 58), el('span', null, a.name));
      b.addEventListener('click', () => onPick(a.id));
      container.appendChild(b);
    }
  }
  async function refreshJoinAvatars() {
    const code = $('join-code').value.trim().toUpperCase();
    let taken = new Set();
    if (code.length === 4) {
      try { const r = await SA.request(socket, 'room:peek', {code}); taken = new Set(r.state.players.map(p => p.avatarId)); $('join-error').textContent = ''; }
      catch (e) { $('join-error').textContent = e.message; }
    }
    if (taken.has(pickedAvatar)) pickedAvatar = null;
    avatarGrid($('join-avatars'), taken, pickedAvatar, id => { pickedAvatar = id; $('join-picked').textContent = av(id).name; refreshJoinAvatars(); });
  }
  function renderJoin() {
    show('join');
    if (params.get('room') && !$('join-code').value) $('join-code').value = params.get('room').toUpperCase().slice(0, 4);
    $('join-name').value = $('join-name').value || SA.store.get('sa-name') || '';
    refreshJoinAvatars();
  }
  $('join-code').addEventListener('input', () => { $('join-code').value = $('join-code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if ($('join-code').value.length === 4) refreshJoinAvatars(); });
  $('btn-join').addEventListener('click', async () => {
    const code = $('join-code').value.trim(), name = $('join-name').value.trim();
    if (code.length !== 4) return flash('Enter the 4-letter room code from the TV.');
    if (!name) return flash('Type your name.');
    if (!pickedAvatar) return flash('Pick a character.');
    $('btn-join').disabled = true;
    try {
      const r = await SA.request(socket, 'room:join', {code, name, avatarId: pickedAvatar});
      SA.store.set('sa-player', {code: r.code, token: r.token});
      SA.store.set('sa-name', name);
      onState(r.state);
    } catch (e) { flash(e.message); if (e.code === 'TAKEN') refreshJoinAvatars(); }
    finally { $('btn-join').disabled = false; }
  });

  /* ---------- lobby ---------- */
  $('btn-ready').addEventListener('click', () => { SA.vibrate(); send('room:ready', {ready: !me()?.ready}); });
  $('btn-start').addEventListener('click', () => send('game:start'));
  $('btn-leave').addEventListener('click', async () => { await send('room:leave'); SA.store.remove('sa-player'); state = null; renderJoin(); });
  function renderLobby() {
    show('lobby');
    const p = me();
    if (!p) return;
    $('lobby-me').replaceChildren(SA.avatarEl(av(p.avatarId), p.ready ? 'win' : 'think', 150), el('div', 'name', p.name));
    $('btn-ready').textContent = p.ready ? 'Ready! (tap to undo)' : "I'm ready";
    $('btn-ready').classList.toggle('on', p.ready);
    const waiting = state.players.filter(x => !x.ready).length;
    $('lobby-status').textContent = state.players.length < 2 ? 'Waiting for another player to join.' : waiting ? `Waiting for ${waiting} more to press ready.` : 'Everyone is ready!';
    $('btn-start').hidden = !(state.vipId === p.id && state.canStart);
    const taken = new Set(state.players.map(x => x.avatarId));
    avatarGrid($('lobby-avatars'), taken, p.avatarId, id => send('room:avatar', {avatarId: id}));
  }

  /* ---------- game ---------- */
  function meBar() {
    const p = me();
    const bar = $('me-bar');
    bar.replaceChildren();
    if (!p) return;
    const info = el('div', 'info');
    info.appendChild(el('div', 'name', p.name));
    const pips = el('div', 'pips');
    for (const c of layout.categories) pips.appendChild(el('span', `pip cat-${c.id}` + (p.tokens.includes(c.id) ? ' on' : '')));
    info.appendChild(pips);
    const brains = el('div', 'brains', String(p.brains));
    brains.appendChild(el('small', null, 'Brains'));
    bar.append(SA.avatarEl(av(p.avatarId), 'think', 54), info, brains);
  }

  const act = (event, data) => { SA.vibrate(20); return send(event, data); };
  function watch(title, sub) {
    const box = el('div', 'watch');
    box.appendChild(el('h2', null, title));
    if (sub) box.appendChild(el('p', 'sub', sub));
    return [box];
  }
  function answerButtons(options, onPick, chosen = null) {
    return options.map((o, i) => {
      const b = el('button', 'answer' + (chosen === i ? ' chosen' : ''));
      b.type = 'button';
      b.append(el('span', 'letter', LETTERS[i]), el('span', null, o));
      b.addEventListener('click', () => { SAKeyboard.dismiss($('panel')); onPick(i); });
      return b;
    });
  }

  function buildPanel() {
    const b = state.board, p = me();
    const mine = b.activeId === p.id;
    const active = nameOf(b.activeId);
    const q = b.question;
    switch (b.step) {
      case 'intro': return watch('Get ready!', 'Watch the TV.');
      case 'turn': {
        if (!mine) return watch(`${active}'s turn`, 'Watch the TV.');
        const out = [el('h2', null, 'Your turn!')];
        const roll = el('button', 'btn btn-gold btn-huge', 'Roll the die');
        roll.addEventListener('click', () => { SA.sfx('sfx-dice-roll'); act('game:roll'); });
        out.push(roll);
        if (b.canFinal) {
          const fin = el('button', 'btn btn-ghost btn-big', 'Go for Smart Alec!');
          fin.addEventListener('click', () => act('game:choose', {action: 'final'}));
          out.push(fin, el('p', 'sub', `${b.required} questions, one clock. Get ${b.required - 1} right to win. Missing out costs nothing but this turn.`));
        }
        return out;
      }
      case 'direction': {
        if (!mine) return watch(`${active} is choosing where to go`);
        const out = [el('h2', null, b.dice.length > 1 ? `You rolled ${b.dice.join(' and ')}` : `You rolled a ${b.dice[0]}`), el('p', 'sub', 'Where do you want to land?')];
        b.moveOptions.forEach((o, i) => {
          const sp = layout.spaces[o.target];
          const meta = sp.kind === 'special' ? null : catMeta(sp.type);
          const btn = el('button', 'choice ' + (meta ? 'cat-' + sp.type : 'cat-special'));
          const label = sp.kind === 'special' ? sp.name : meta.name;
          const owned = sp.kind === 'category' && p.tokens.includes(sp.type);
          const meta2 = el('span', 'meta');
          meta2.append(document.createTextNode(label), el('small', null, `${o.steps} ${o.dir > 0 ? 'clockwise ↻' : 'anticlockwise ↺'}${owned ? ' · token already won' : ''}`));
          btn.append(el('span', 'swatch'), meta2);
          btn.addEventListener('click', () => act('game:choose', {option: i}));
          out.push(btn);
        });
        return out;
      }
      case 'moving': case 'landed': return watch(b.banner?.text || 'Moving…');
      case 'risk': {
        if (!mine) return watch(`${active} is choosing`, catMeta(q.category)?.name);
        const owned = p.tokens.includes(q.category);
        const box = el('div', 'risk');
        const safe = el('button', 'btn btn-gold');
        safe.append(document.createTextNode('Play Safe'), el('small', null, owned ? 'A–D options · 1 Brain' : 'A–D options · win the token'));
        safe.addEventListener('click', () => act('game:choose', {option: 'safe'}));
        const smart = el('button', 'btn btn-ghost');
        smart.append(document.createTextNode('Go Smart'), el('small', null, owned ? 'Type the answer · 3 Brains' : 'Type the answer · token + 2 Brains'));
        smart.addEventListener('click', () => act('game:choose', {option: 'smart'}));
        box.append(safe, smart);
        return [el('h2', null, catMeta(q.category)?.name || ''), box];
      }
      case 'question': {
        if (q.forId !== p.id) {
          if (!['turn', 'jackpot'].includes(q.kind) || !q.options) return watch(`${active} is answering`, 'Watch the TV.');
          if (q.myAlong !== null && q.myAlong !== undefined) return [el('p', 'locked', `Locked in: ${LETTERS[q.myAlong]}`), el('p', 'sub', `If ${active} gets it wrong, the fastest right answer steals 2 Brains.`)];
          return [el('h2', null, 'Play along!'), el('p', 'sub', `Lock in now. If ${active} gets it wrong, the fastest right answer steals 2 Brains.`), el('p', 'qtext', q.text), ...answerButtons(q.options, i => act('game:answer', {choice: i}))];
        }
        if (q.answers?.[p.id]) return [el('p', 'locked', 'Locked in!')];
        const out = [el('p', 'qtext', q.text)];
        if (q.mode === 'typed') {
          const form = el('form', 'typed-form');
          const input = el('input');
          input.id = 'typed-answer'; input.autocomplete = 'off'; input.maxLength = 80; input.placeholder = 'Type your answer';
          const go = el('button', 'btn btn-gold btn-big', 'Lock it in');
          go.type = 'submit';
          form.append(input, go);
          form.addEventListener('submit', e => { e.preventDefault(); if (!input.value.trim()) { input.focus(); return; } act('game:answer', {text: input.value}); });
          out.push(form);
        } else {
          out.push(...answerButtons(q.options || [], i => act('game:answer', {choice: i})));
        }
        return out;
      }
      case 'steal': case 'group': {
        const inIt = (q.participants || []).includes(p.id);
        if (!inIt) return watch(b.step === 'steal' ? 'Up for grabs! (not for you this time)' : `${nameOf(q.participants?.[0])} v ${nameOf(q.participants?.[1])}`, 'Watch the TV.');
        if (q.answers?.[p.id]) return [el('p', 'locked', 'Locked in!')];
        const title = b.step === 'steal' ? 'Steal it! Fastest wins.' : ({lightning: 'Lightning Round!', freeforall: 'Free-for-All!', showdown: 'Showdown!'}[q.kind] || 'Answer!');
        return [el('h2', null, title), el('p', 'qtext', q.text), ...answerButtons(q.options || [], i => act('game:answer', {choice: i}))];
      }
      case 'reveal': case 'groupReveal': return watch(q?.resultText || b.banner?.text || '', q?.answer ? `Answer: ${q.answer}` : '');
      case 'special': {
        const sp = b.special;
        if (!mine || !sp?.options) return watch(b.banner?.text || `${active} is choosing`);
        const out = [el('h2', null, layout.specials.find(s => s.id === sp.type)?.name || '')];
        if (sp.type === 'double') {
          const grid = el('div', 'numbers');
          sp.options.forEach((o, i) => {
            const n = el('button', 'btn ' + (o.bet ? 'btn-gold' : 'btn-ghost'), o.bet ? String(o.bet) : 'No');
            n.addEventListener('click', () => act('game:choose', {option: i}));
            grid.appendChild(n);
          });
          out.push(el('p', 'sub', 'How many Brains will you bet? Then type the answer.'), grid);
          return out;
        }
        sp.options.forEach((o, i) => {
          const btn = el('button', 'choice ' + (o.category ? 'cat-' + o.category : 'cat-special'));
          btn.append(el('span', 'swatch'), el('span', 'meta', o.label));
          btn.addEventListener('click', () => act('game:choose', {option: i}));
          out.push(btn);
        });
        return out;
      }
      case 'predict': {
        const f = b.final;
        if (f.playerId === p.id) return watch('Final Round!', 'Everyone is guessing your score. Get ready…');
        if (f.predictions?.[p.id] !== undefined && f.predictions[p.id] !== true) return [el('p', 'locked', `You said ${f.predictions[p.id]}`)];
        const grid = el('div', 'numbers');
        for (let n = 0; n <= f.total; n++) {
          const btn = el('button', 'btn btn-gold', String(n));
          btn.addEventListener('click', () => act('game:choose', {option: n}));
          grid.appendChild(btn);
        }
        return [el('h2', null, `How many will ${nameOf(f.playerId)} get right?`), el('p', 'sub', `${f.need} right wins. Spot on wins you 2 Brains.`), grid];
      }
      case 'final': {
        const f = b.final;
        if (f.playerId !== p.id) return watch(`${nameOf(f.playerId)} is going for Smart Alec!`, `Question ${f.index + 1} of ${f.total}`);
        if (!f.current) return [el('p', 'locked', '…')];
        return [el('h2', null, `Question ${f.index + 1} of ${f.total}`), el('p', 'qtext', f.current.text), ...answerButtons(f.current.options, i => act('game:answer', {choice: i}))];
      }
      case 'finalResult': return watch(b.banner?.text || '');
      case 'miniResult': { const n = b.miniResult?.awards?.[p.id]; return watch(b.miniResult?.text || '', n ? `You ${n > 0 ? 'win' : 'lose'} ${Math.abs(n)} Brains` : ''); }
      case 'turnEnd': {
        if (!b.chat) return watch(b.banner?.text || 'Next turn…');
        if (b.chat.mine) return watch(b.banner?.text || 'Chat time', `You're ready. Waiting for the others (${b.chat.ready} of ${b.chat.needed}).`);
        return [el('h2', null, b.banner?.text || 'Chat time'), el('p', 'sub', 'Have a laugh about that one. Tap when you want to carry on.'),
          (() => { const r = el('button', 'btn btn-gold btn-big', "We're ready"); r.addEventListener('click', () => { r.disabled = true; act('game:ready'); }); return r; })()];
      }
      default: return watch('Watch the TV.');
    }
  }

  function panelSignature() {
    const b = state.board, p = me();
    const q = b.question;
    return [b.step, b.version, b.activeId, q?.id, q?.answers?.[p.id] ? 'A' : '', q?.myAlong ?? '', b.final?.index, b.final?.predictions?.[p.id], b.canFinal, p.tokens.length].join('|');
  }

  /* ---------- NOGGIN's phone text is written in capitals; show it in normal sentence case ---------- */
  const KEEP_CAPS = new Set(['TV', 'OK', 'A', 'B', 'C', 'D', 'UK', 'USA', 'DJ']);
  function sentenceCase(text) {
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length < 3 || letters !== letters.toUpperCase()) return text;   // already mixed case, leave it
    let out = text.toLowerCase().replace(/(^\s*|[.!?]\s+|:\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    out = out.replace(/\b([a-z]+)\b/g, w => (KEEP_CAPS.has(w.toUpperCase()) && w.length > 1 ? w.toUpperCase() : w === 'i' ? 'I' : w));
    return out;
  }
  function soften(root) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const next = sentenceCase(n.nodeValue);
      if (next !== n.nodeValue) n.nodeValue = next;
    }
    for (const input of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
      const next = sentenceCase(input.placeholder);
      if (next !== input.placeholder) input.placeholder = next;
    }
  }
  let softener = null;

  let nogginPhone = null;
  function renderNoggin() {
    if (!nogginPhone) nogginPhone = NogginPhone({
      socket,
      onState: next => onState(next),
      rerender: () => state && onState(state),
      onError: msg => { const n = $('game-banner'); n.textContent = msg; n.className = 'game-banner result-bad'; },
    });
    if (panelKey !== 'noggin') {
      SAKeyboard.dismiss($('panel'));
      panelKey = 'noggin';
      nogginPhone.reset();
      const box = el('div', 'noggin-phone');
      const h = el('h2'); h.id = 'gameHeadline';
      const d = el('p', 'sub'); d.id = 'gameDescription';
      const buttons = el('div', 'noggin-controls'); buttons.id = 'gameButtons';
      box.append(h, d, buttons);
      $('panel').replaceChildren(box);
      softener?.disconnect();
      softener = new MutationObserver(() => soften(box));
      softener.observe(box, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder']});
    }
    nogginPhone.update(state, me());
    soften($('panel'));
  }

  function renderGame() {
    show('game');
    meBar();
    if (['minigame', 'showdown'].includes(state.board.step)) { renderNoggin(); return; }
    const sig = panelSignature();
    // Keep the typing box intact while the same question is open.
    const typing = document.activeElement?.id === 'typed-answer' && state.board.step === 'question';
    if (sig !== panelKey && !(typing && sig.split('|')[0] === panelKey.split('|')[0] && sig.split('|')[3] === panelKey.split('|')[3] && !state.board.question?.answers?.[state.you])) {
      const wasMine = panelKey.split('|')[2] === state.you && panelKey.split('|')[0] === 'turn';
      SAKeyboard.dismiss($('panel'));
      panelKey = sig;
      $('panel').replaceChildren(...buildPanel());
      if (state.board.step === 'turn' && state.board.activeId === state.you && !wasMine) SA.vibrate([60, 40, 60]);
    }
    const b = state.board;
    $('game-banner').className = 'game-banner';
    $('game-banner').textContent = b.paused ? 'Paused on the TV.' : '';
  }

  let clockFor = null, clockStart = 0;
  function tickTimer() {
    const b = state?.board, t = $('phone-timer');
    const m = b?.minigame, duel = b?.showdown;
    const deadline = m ? (m.phase === 'intro' ? m.introUntil : m.deadline) : duel ? duel.deadline : b?.deadline;
    if (!b || state.phase !== 'board' || !deadline || b.paused || ['moving', 'landed', 'turnEnd', 'reveal', 'groupReveal', 'finalResult', 'intro', 'miniResult'].includes(b.step)) { t.hidden = true; return; }
    if (clockFor !== deadline) { clockFor = deadline; clockStart = Math.min(SA.now(), deadline); }
    const total = (m || duel) ? deadline - clockStart : deadline - b.stepStartedAt, left = Math.max(0, deadline - SA.now());
    t.hidden = false;
    $('phone-timer-fill').style.transform = `scaleX(${total > 0 ? left / total : 0})`;
    t.classList.toggle('low', left < 5000);
  }
  setInterval(tickTimer, 250);

  function renderOver() {
    show('over');
    const b = state.board, p = me();
    const place = b.standings?.find(s => s.id === p.id)?.place;
    const won = b.winnerId === p.id;
    $('over-box').replaceChildren(SA.avatarEl(av(p.avatarId), won ? 'win' : 'lose', 170), el('h2', null, won ? 'You are Smart Alec!' : `${nameOf(b.winnerId)} wins`), el('p', null, place ? `You finished ${ordinal(place)} with ${p.tokens.length} tokens and ${p.brains} Brains.` : ''));
    $('btn-again').hidden = state.vipId !== p.id;
    renderFeedback();
  }
  $('btn-again').addEventListener('click', () => send('game:start'));

  /* ---------- 30-second feedback card after each game (for playtesting) ---------- */
  const FUN = [['1', '😐'], ['2', '🙂'], ['3', '😀'], ['4', '😄'], ['5', '🤩']];
  const BEST = ['Bonus Steal', 'Play along', 'Mini-games', 'Showdowns', 'Special spaces', 'Final Round', 'Alec', 'The questions'];
  const DRAG = ['Too long', 'Waiting for my turn', 'Rules confusing', 'Questions too hard', 'Questions too easy', 'Mini-games', 'Phone fiddly', 'Sound or music'];
  let feedbackFor = null;   // the game (by start time) the card was built for
  function renderFeedback() {
    const box = $('feedback-box');
    const gameKey = state.board && state.board.startedAt;
    if (!gameKey || feedbackFor === gameKey) return;   // built once per game, so typing isn't lost on updates
    feedbackFor = gameKey;
    const answers = {fun: null, best: new Set(), drag: new Set()};
    const chips = (list, set) => {
      const wrap = el('div', 'fb-chips');
      for (const label of list) {
        const b = el('button', 'fb-chip', label); b.type = 'button'; b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => { const on = !set.has(label); on ? set.add(label) : set.delete(label); b.setAttribute('aria-pressed', String(on)); });
        wrap.append(b);
      }
      return wrap;
    };
    const fun = el('div', 'fb-fun');
    for (const [n, face] of FUN) {
      const b = el('button', 'fb-face', face); b.type = 'button'; b.setAttribute('aria-label', `${n} out of 5`); b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { answers.fun = Number(n); for (const x of fun.children) x.setAttribute('aria-pressed', String(x === b)); });
      fun.append(b);
    }
    const note = el('textarea', 'fb-note'); note.maxLength = 240; note.placeholder = 'Anything else? (optional)';
    const sendBtn = el('button', 'btn btn-gold', 'Send feedback');
    const skip = el('button', 'link', 'Skip');
    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true;
      const res = await send('game:feedback', {fun: answers.fun, best: [...answers.best], drag: [...answers.drag], note: note.value});
      box.replaceChildren(el('p', 'fb-thanks', res ? 'Thanks! Your feedback helps make Smart Alec better.' : 'That didn\'t send, but thanks anyway.'));
    });
    skip.addEventListener('click', () => { box.hidden = true; });
    box.replaceChildren(
      el('h3', null, 'Help make Smart Alec better'),
      el('p', 'fb-q', 'How much fun was that?'), fun,
      el('p', 'fb-q', 'Best bits?'), chips(BEST, answers.best),
      el('p', 'fb-q', 'Anything drag or confuse?'), chips(DRAG, answers.drag),
      note, sendBtn, skip,
    );
    box.hidden = false;
  }
  function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'); }

  let paintQueued = false;
  function onState(next) {
    if (!next) return;
    state = next;
    SA.syncClock(next.serverNow);
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      if (!layout || !me()) return;
      if (state.phase === 'lobby') { panelKey = ''; renderLobby(); }
      else if (state.phase === 'board') renderGame();
      else if (state.phase === 'over') { panelKey = ''; renderOver(); }
      tickTimer();
    });
  }

  const ready = Promise.all([SA.layout(), SA.avatars()]).then(([l, a]) => { layout = l; avatars = a; if (state) onState(state); });

  /* ---------- tactile feedback ---------- */
  $('panel').addEventListener('pointerdown', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || !event.isPrimary) return;
    SA.vibrate(18);
    SA.sfx('sfx-tick', 0.18);
  }, {passive: true});

  /* ---------- connection ---------- */
  socket.on('room:state', onState);
  socket.on('room:closed', () => { SA.store.remove('sa-player'); state = null; renderJoin(); flash('The TV closed the room.'); });
  socket.on('room:session-replaced', () => { flash('You opened this game on another device.'); });
  socket.on('disconnect', () => { $('offline').hidden = false; });
  socket.on('connect', async () => {
    $('offline').hidden = true;
    await ready;
    const s = session();
    const wanted = params.get('room')?.toUpperCase();
    if (!s || (wanted && wanted !== s.code)) { if (wanted && s && wanted !== s.code) SA.store.remove('sa-player'); renderJoin(); return; }
    try {
      const r = await SA.request(socket, 'room:resume', {code: s.code, token: s.token, role: 'player'});
      onState(r.state);
    } catch (e) {
      if (['AUTH', 'ROOM', 'EXPIRED', 'CODE'].includes(e.code)) { SA.store.remove('sa-player'); renderJoin(); flash(e.message); }
    }
  });
})();
