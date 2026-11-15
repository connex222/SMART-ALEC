'use strict';
/**
 * TV drawing for the NOGGIN mini-games and Showdowns, ported from NOGGIN's
 * board-view.js (renderMini, renderPhase4, renderShowdown, howToCard). It draws
 * into the Smart Alec question card instead of NOGGIN's challenge panel.
 */
window.NogginTV = (() => {
  let howto = {};
  fetch('/shared/howto.json').then(r => r.json()).then(j => { howto = j; }).catch(() => {});
  const flashHandles = [];
  let onHop = null;
  const INK = {RED: '#E2434B', BLUE: '#2F7BFF', GREEN: '#1E9E3E', YELLOW: '#E0A800'};
  const CAT_LABEL = {speed: 'Speed game', brain: 'Brain game', create: 'Create game', together: 'Together game'};

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  const nameOf = (state, id) => state.players.find(p => p.id === id)?.name || 'Player';

  function shapeSvg(shape, word) {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'shape-clash-tv');
    const star = Array.from({length: 10}, (_, i) => { const r = i % 2 ? 20 : 46, a = -Math.PI / 2 + i * Math.PI / 5; return `${(50 + r * Math.cos(a)).toFixed(1)},${(53 + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
    const def = shape === 'CIRCLE' ? ['circle', {cx: 50, cy: 50, r: 43}] : shape === 'SQUARE' ? ['rect', {x: 9, y: 9, width: 82, height: 82}] : shape === 'TRIANGLE' ? ['polygon', {points: '50,6 95,92 5,92'}] : ['polygon', {points: star}];
    const outline = document.createElementNS(ns, def[0]); for (const [k, v] of Object.entries(def[1])) outline.setAttribute(k, v); outline.setAttribute('class', 'shape-outline');
    const text = document.createElementNS(ns, 'text'); text.setAttribute('x', '50'); text.setAttribute('y', shape === 'TRIANGLE' ? '72' : '57'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'shape-word'); text.textContent = word;
    svg.append(outline, text); return svg;
  }

  function howToCard(id, category, state, avatars, duelists = null) {
    const entry = howto[id];
    const steps = id === 'colour-clash' && state.settings?.colourBlindSafe && entry?.colourBlindSteps ? entry.colourBlindSteps : entry?.classicSteps || entry?.steps;
    if (!steps) return null;
    const card = el('div', 'howto-card');
    const row = el('ol', 'howto-steps');
    steps.forEach(([icon, text], i) => {
      const li = el('li'); li.style.setProperty('--i', String(i));
      li.append(el('span', 'howto-n', String(i + 1)), el('span', 'howto-icon', icon), el('span', 'howto-text', text));
      row.append(li);
    });
    card.append(row);
    const who = el('div', 'howto-host');
    const face = p => { const a = avatars.find(x => x.id === p?.avatarId); return SA.avatarEl(a, 'think', 64); };
    if (duelists?.length) {
      duelists.map(id => state.players.find(p => p.id === id)).filter(Boolean).forEach((p, i) => { if (i) who.append(el('b', 'howto-vs', 'v')); who.append(face(p), el('span', null, p.name)); });
    } else {
      const host = state.players.find(p => p.id === state.board.activeId);
      if (host) who.append(face(host), el('span', null, `Hosted by ${host.name}`));
    }
    card.append(who);
    return card;
  }

  function renderPhase4(m, state, prompt, options, avatars) {
    const span = (t, cls = 'mini-help') => { const x = el('div', cls, t); options.append(x); return x; };
    const actor = state.players.find(p => p.id === state.board.activeId);
    if (m.id === 'sketch-sabotage') {
      prompt.textContent = `${actor?.name || 'The artist'} draws. Category: ${m.display.category}. A secret saboteur is at work!`;
      const canvas = el('canvas', 'tv-sketch'); canvas.width = 1000; canvas.height = 580;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 580); ctx.strokeStyle = '#141A33'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const entry of m.display.strokes || []) { const p = entry.points; if (p.length < 2) continue; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1] * .82857); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1] * .82857); ctx.stroke(); }
      canvas.dataset.strokeCount = String((m.display.strokes || []).length); options.append(canvas);
    } else if (m.id === 'noise-annoys') {
      prompt.textContent = `${actor?.name || 'The host'} is making a mystery sound out loud. No words, no miming!`; span('Listen carefully…', 'p4-big');
    } else if (m.id === 'caption-this') {
      prompt.textContent = m.question;
      const faces = el('div', 'caption-avatars');
      if (m.display.image) { const pic = el('img', 'caption-scene'); pic.src = m.display.image; pic.alt = ''; faces.append(pic); }
      else for (const avatarId of m.display.avatars || []) faces.append(SA.avatarEl(avatars.find(a => a.id === avatarId), 'think', 150));
      options.append(faces);
      if (m.phase === 'vote') for (const c of m.display.options || []) span(`“${c}”`, 'p4-ballot');
      else span(`${m.display.entryCount || 0} captions in. Anonymous vote next.`);
    } else if (m.id === 'fib-factory') {
      prompt.textContent = m.question;
      if (m.phase === 'vote') for (const c of m.display.options || []) span(c, 'p4-ballot');
      else span(`${m.display.entryCount || 0} fibs in. The truth is hiding among them.`);
    } else if (m.id === 'mind-meld') {
      prompt.textContent = m.question;
      const groups = m.display.groups || [];
      if (!groups.length) span(`${actor?.name || 'Host'} + ${nameOf(state, m.display.partnerId) || 'choosing a partner'}`, 'p4-big');
      groups.forEach((g, i) => {
        const done = (m.display.matched || []).includes(i);
        const r = m.phase === 'reveal' ? (m.lastResult?.groups || []).find(x => x.ids.join() === g.join()) : null;
        span(`${done ? '✓ ' : ''}${g.map(id => nameOf(state, id)).join(' + ')}${r ? ` · ${r.words.join(' / ')}` : ''}`, done ? 'p4-ballot meld-done' : 'p4-ballot');
      });
      span(`Attempt ${m.round} of ${m.totalRounds}. No talking!`);
    } else if (m.id === 'majority-rules') {
      prompt.textContent = m.question; for (const c of m.display.options || []) span(c, 'p4-ballot');
      span(`${m.answered.length} of ${state.players.length} votes in`);
    } else if (m.id === 'relay-sums') {
      prompt.textContent = 'Two teams. Solve your sum to pass the baton!';
      for (let team = 0; team < 2; team++) { const id = m.display.activeIds[team]; span(`Team ${team + 1}: ${m.display.progress[team]}/${m.display.totals[team]} · ${id ? nameOf(state, id) : 'Finished'}`, 'p4-ballot'); }
    } else if (m.id === 'bomb-squad') {
      prompt.textContent = 'Share the clues on your phones. Cut four wires, then enter the code!';
      const wires = el('div', 'p4-wires');
      for (const c of m.display.wires || []) wires.append(el('span', 'p4-wire ' + c.toLowerCase() + (m.display.cut.includes(c) ? ' cut' : ''), m.display.cut.includes(c) ? `✓ ${c}` : c));
      options.append(wires);
      span(m.display.keypadReady ? 'Wires cut! Enter the four-digit code.' : 'Talk to each other. Cut the right wire!', 'p4-big');
    }
  }

  function renderMini(m, state, head, prompt, options, avatars) {
    head.title.textContent = m.title;
    head.type.textContent = m.phase === 'intro' ? (CAT_LABEL[m.category] || 'Mini-game') : `${CAT_LABEL[m.category] || 'Mini-game'} · round ${m.round} of ${m.totalRounds}`;
    prompt.textContent = m.question || '';
    if (m.phase === 'intro') {
      prompt.textContent = m.rule;
      const card = howToCard(m.id, m.category, state, avatars);
      if (card) options.append(card);
      return;
    }
    if (m.category === 'create' || m.category === 'together') { renderPhase4(m, state, prompt, options, avatars); return; }
    const span = (t, cls = 'mini-help') => { const x = el('span', cls, t); options.append(x); return x; };
    if (m.phase === 'reveal') {
      prompt.textContent = `Round ${m.round} results`;
      const result = m.lastRoundResult || {};
      if (result.answer !== undefined) span(`Answer: ${typeof result.answer === 'number' ? result.answer.toLocaleString('en-GB') : result.answer}${result.unit ? ` ${result.unit}` : ''}`, 'p4-big');
      const winners = (result.winners || []).map(id => nameOf(state, id));
      span(winners.length ? `Round winner${winners.length > 1 ? 's' : ''}: ${winners.join(', ')}` : 'No round winner', 'p4-ballot');
      if (Array.isArray(result.reactions) && result.reactions.length) {
        const list = el('ol', 'close-call-guesses');
        for (const r of result.reactions) list.append(el('li', null, `${nameOf(state, r.id)}: ${(r.reactionMs / 1000).toFixed(3)} s`));
        options.append(list); return;
      }
      if (Array.isArray(result.guesses) && result.guesses.length) {
        const list = el('ol', 'close-call-guesses');
        for (const g of result.guesses) list.append(el('li', null, `${nameOf(state, g.id)}: ${Number(g.guess).toLocaleString('en-GB')} ${result.unit || ''} · ${g.distance === 0 ? 'spot on!' : `off by ${Number(g.distance).toLocaleString('en-GB')}`}`));
        options.append(list); return;
      }
      span(m.finalReveal ? 'Final scores next' : 'Next round coming up', 'p4-ballot');
      return;
    }
    if (m.id === 'odd-spot') {
      const grid = el('div', 'mini-tv-grid');
      m.display.grid.forEach((sym, i) => {
        const cell = el('span', 'odd-tv-cell'); const icon = el('b', null, sym); const style = m.display.styles?.[i];
        if (style?.rotation) icon.style.transform = `rotate(${style.rotation}deg)`; if (style?.scale) icon.style.transform = `scale(${style.scale})`;
        cell.append(icon); grid.append(cell);
      });
      options.append(grid);
    } else if (m.id === 'colour-clash' && m.display.mode === 'shape') {
      prompt.textContent = ''; options.append(shapeSvg(m.display.shape, m.display.word)); span('Tap the shape you see, not the word', 'mini-help');
    } else if (m.id === 'colour-clash') {
      prompt.classList.add('stroop-tv'); prompt.style.color = INK[m.display.ink] || '';
    } else if (m.id === 'higher-lower') {
      span('Higher ▲', 'p4-ballot'); span('Lower ▼', 'p4-ballot');
      span(`${m.participants.filter(id => !m.eliminated.includes(id)).length} still in. Two strikes and you're out.`, 'mini-help');
    } else if (m.id === 'unscramble') {
      span(`Hint: ${m.hint}`, 'p4-ballot'); if (m.display.clue) span(`Clue: ${m.display.clue}`, 'p4-ballot');
    } else if (m.id === 'quick-draw') {
      span(m.phase === 'wait' ? 'Hold your nerve…' : 'DRAW!', 'mini-signal' + (m.phase === 'wait' ? '' : ' go'));
    } else if (m.id === 'count-flash') {
      if (m.phase === 'flash' && m.tvCue) {
        const {icon, distractor, count, total, seed, icons, counts} = m.tvCue; let x = seed || 1;
        const rand = () => { x = (Math.imul(1664525, x) + 1013904223) >>> 0; return x / 4294967296; };
        const scene = el('div', 'flash-scene');
        const spots = Array.from({length: total}, (_, i) => i);
        for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
        for (let i = 0; i < total; i++) {
          const s = el('span', null, icons && counts ? icons[i < counts[0] ? 0 : i < counts[0] + counts[1] ? 1 : 2] : i < count ? icon : distractor);
          const cell = spots[i]; s.style.gridColumn = String(cell % 6 + 1); s.style.gridRow = String(Math.floor(cell / 6) + 1); scene.append(s);
        }
        options.append(scene);
      } else span(`How many ${m.display.targetIcon || 'targets'} did you see?`, 'p4-big');
    } else if (m.id === 'memory-lane') {
      const pads = el('div', 'tv-memory-pads');
      ['●', '◆', '▲', '■', '★', '✦'].forEach((name, i) => pads.append(el('span', `tv-pad pad-${i}`, name)));
      options.append(pads);
      if (m.tvCue && m.phase === 'flash' && !state.board.paused) {
        const sequence = m.tvCue.sequence;
        const base = m.openAt - (1000 + sequence.length * 750);
        const serverTime = SA.now();
        sequence.forEach((pad, index) => {
          const begin = base + 1000 + index * 750, end = begin + 560;
          const light = () => { pads.children[pad]?.classList.add('lit'); onHop?.(); };
          const dim = () => pads.children[pad]?.classList.remove('lit');
          if (end <= serverTime) return;
          if (begin <= serverTime) pads.children[pad]?.classList.add('lit');
          else flashHandles.push(setTimeout(light, begin - serverTime));
          flashHandles.push(setTimeout(dim, end - serverTime));
        });
      }
      if (m.phase === 'play') span(m.display.reverse ? 'Final round: tap the pads in REVERSE order' : 'Repeat the sequence on your phones', 'mini-help');
    } else if (m.id === 'close-call') span(`Answer in ${m.display.unit || 'a number'}`, 'p4-big');
  }

  function renderShowdown(m, state, head, prompt, options, avatars) {
    head.type.textContent = 'Showdown';
    head.title.textContent = m.title;
    prompt.textContent = m.question || '';
    const label = (text, cls = 'p4-ballot') => { const x = el('div', cls, text); options.append(x); return x; };
    const names = m.participants.map(id => nameOf(state, id));
    if (m.phase === 'intro') {
      prompt.textContent = `${names[0]} v ${names[1]}`;
      const card = howToCard(m.kind, 'showdown', state, avatars, m.participants);
      if (card) options.append(card);
      label('Everyone else: back the winner on your phone. Right pick wins 1 Brain.', 'mini-help');
      return;
    }
    if (m.cheerCounts && Object.values(m.cheerCounts).some(Boolean)) {
      const total = Object.values(m.cheerCounts).reduce((a, b) => a + b, 0);
      label(m.participants.map((id, i) => `${names[i]}: ${m.cheerCounts[id] || 0} backer${(m.cheerCounts[id] || 0) === 1 ? '' : 's'}`).join('   ·   ') + `  (${total} picks)`, 'mini-help');
    }
    if (m.kind === 'buzzer') {
      const pts = m.participants.map(id => m.display.points[id]);
      label(`${names[0]}  ${pts[0]} : ${pts[1]}  ${names[1]}`, 'p4-big');
      label(`Question ${m.round} of ${m.totalRounds || 5} · first to 3 · ${m.phase === 'buzz' ? 'buzz to answer' : m.phase === 'answer' ? 'first buzzer is answering' : 'second chance'}`, 'mini-help');
      for (const c of m.display.choices || []) label(c, 'p4-ballot');
    } else if (m.kind === 'tug') {
      const rope = el('div', 'duel-rope'); const knot = el('span', 'duel-knot'); knot.style.left = `${50 + m.display.rope * 8}%`; rope.append(knot); options.append(rope);
      label(`${names[0]}   ◀ ${m.display.rope} ▶   ${names[1]}`, 'p4-big');
      label('Five notches wins. Only your phone shows your sum.', 'mini-help');
    } else if (m.kind === 'bid') {
      label(`Current bid: ${m.display.bid}`, 'p4-big');
      label(m.phase === 'auction' ? `${nameOf(state, m.display.turnId)}: raise the bid or challenge!` : m.phase === 'review' ? `Judging “${m.display.review?.text || m.display.review?.answer || ''}”` : `${nameOf(state, m.display.bidderId)}: ${m.display.correct}/${m.display.bid} answers accepted`, 'mini-help');
    } else if (m.kind === 'nerve') {
      label(String(m.display.number), 'nerve-counter');
      label(`${m.display.banks.length} of ${m.participants.length} have banked. The hidden bust is getting closer!`, 'mini-help');
    }
  }

  /** Draw the current mini-game or Showdown into the card. Returns true if it drew. */
  function render(card, state, avatars) {
    flashHandles.forEach(clearTimeout); flashHandles.length = 0;
    const b = state.board;
    const m = b.minigame, duel = b.showdown;
    if (!m && !duel) return false;
    card.replaceChildren();
    const headBox = el('div', 'card-head noggin-head');
    const head = {type: el('span', 'noggin-type'), title: el('span', 'cat-name')};
    headBox.append(head.title, head.type);
    const body = el('div', 'card-body noggin-body');
    const prompt = el('p', 'q-text noggin-prompt');
    const options = el('div', 'noggin-options');
    body.append(prompt, options);
    card.append(headBox, body);
    card.dataset.game = m ? m.id : duel.kind;
    card.dataset.cat = m ? m.category : 'showdown';
    if (m) renderMini(m, state, head, prompt, options, avatars); else renderShowdown(duel, state, head, prompt, options, avatars);
    return true;
  }

  function appendStroke({roundKey, index, points}, state) {
    const mini = state?.board?.minigame;
    if (mini?.id !== 'sketch-sabotage' || mini.phase !== 'play' || mini.roundKey !== roundKey || !Array.isArray(points) || points.length < 2) return;
    const canvas = document.querySelector('#card canvas.tv-sketch');
    if (!canvas) return;
    const seen = Number(canvas.dataset.strokeCount || 0);
    if (index !== seen) return;
    const ctx = canvas.getContext('2d');
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1] * .82857);
    for (const point of points.slice(1)) ctx.lineTo(point[0], point[1] * .82857);
    ctx.stroke();
    canvas.dataset.strokeCount = String(seen + 1);
  }

  return {render, appendStroke, setOnHop(fn) { onHop = fn; }};
})();
