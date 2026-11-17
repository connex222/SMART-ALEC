'use strict';
/* Small helpers shared by the TV and the phones. No external code. */
window.SA = (() => {
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
  };

  function request(socket, event, data = {}) {
    return new Promise((resolve, reject) => {
      socket.timeout(8000).emit(event, data, (err, result) => {
        if (err) return reject(Object.assign(new Error('No answer from the server. Check your connection.'), {code: 'TIMEOUT'}));
        if (!result || !result.ok) return reject(Object.assign(new Error(result?.message || 'Something went wrong.'), {code: result?.code || 'SERVER'}));
        resolve(result);
      });
    });
  }

  let layoutCache = null;
  async function layout() {
    if (!layoutCache) layoutCache = await (await fetch('/api/layout')).json();
    return layoutCache;
  }
  let avatarCache = null;
  async function avatars() {
    if (!avatarCache) avatarCache = await (await fetch('/shared/avatars.json')).json();
    return avatarCache;
  }

  /** An avatar picture, falling back to a coloured initial until the art exists. */
  function avatarEl(av, pose = 'think', size = 64) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar';
    wrap.style.width = wrap.style.height = size + 'px';
    if (!av) return wrap;
    wrap.style.background = av.colour;
    const initial = document.createElement('span');
    initial.className = 'avatar-initial';
    initial.style.fontSize = Math.round(size * 0.46) + 'px';
    initial.textContent = av.name.replace(/^The /, '').charAt(0);
    wrap.appendChild(initial);
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => { wrap.classList.add('has-art'); };
    // A missing pose falls back to the think pose, then to the coloured initial.
    img.onerror = () => { if (pose !== 'think' && img.src.indexOf(av.images.think) < 0) img.src = av.images.think; else img.remove(); };
    img.src = av.images[pose] || av.images.think;
    wrap.appendChild(img);
    return wrap;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Server clock offset, so timers agree between devices. */
  let offset = 0;
  function syncClock(serverNow) { if (Number.isFinite(serverNow)) offset = serverNow - Date.now(); }
  function now() { return Date.now() + offset; }
  function secondsLeft(deadline) { return deadline ? Math.max(0, Math.ceil((deadline - now()) / 1000)) : null; }

  /* ---------- sound: shared, bounded Web Audio buffer cache ---------- */
  const AUDIO = {
    'mus-lobby': 'ogg', 'mus-board': 'ogg', 'mus-tension': 'ogg',
    'mus-victory': 'mp3', 'sfx-tick': 'mp3', 'sfx-correct': 'mp3',
    'sfx-wrong': 'mp3', 'sfx-dice-roll': 'mp3', 'sfx-go': 'mp3',
    'sfx-crowd-cheer': 'mp3', 'sfx-crowd-aww': 'mp3',
    'sfx-hop': 'mp3', 'sfx-spark-gain': 'mp3', 'sfx-spark-lose': 'mp3',
    'sfx-swap': 'mp3', 'sfx-reel': 'mp3', 'sfx-reel-stop': 'mp3',
    'sfx-countdown': 'mp3', 'sfx-join': 'mp3', 'sfx-showdown': 'mp3',
    'sfx-buzz': 'mp3'
  };
  const PRIORITY = new Set(['sfx-correct', 'sfx-crowd-cheer', 'sfx-wrong']);
  const cache = new Map();
  let ctx = null, music = null, musicName = null, musicVolume = 0.28;
  let voiceDucked = false, effectsDucked = 0, muted = store.get('sa-muted') === true;
  let musicGain = null, resumePromise = null, fallbackMusic = null;
  const audioUrl = name => `/sounds/${name}.${AUDIO[name]}`;
  function context() {
    if (ctx || !window.AudioContext && !window.webkitAudioContext) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = ctx.createGain(); musicGain.connect(ctx.destination);
    } catch { ctx = null; }
    return ctx;
  }
  function loadSound(name) {
    if (!Object.hasOwn(AUDIO, name)) return Promise.resolve(null);
    if (cache.has(name)) return cache.get(name);
    const promise = (async () => {
      const ac = context();
      if (!ac) return null;
      const response = await fetch(audioUrl(name));
      if (!response.ok) throw new Error(`Audio ${name}: ${response.status}`);
      return await ac.decodeAudioData(await response.arrayBuffer());
    })().catch(() => null);
    cache.set(name, promise);
    return promise;
  }
  // Run downloads in small batches; browsers only permit actual playback after a gesture.
  // Only short effects are decoded into memory. Music is streamed (see playMusic):
  // decoded, the three tracks would take about 170 MB, too much for phones and TV sticks.
  async function preloadAudio(names = ['sfx-tick', 'sfx-correct', 'sfx-wrong', 'sfx-dice-roll', 'sfx-go', 'sfx-crowd-cheer']) {
    for (let i = 0; i < names.length; i += 3) await Promise.all(names.slice(i, i + 3).map(loadSound));
  }
  function unlockAudio() {
    const ac = context();
    if (!ac) return Promise.resolve(false);
    if (ac.state === 'running') return Promise.resolve(true);
    if (!resumePromise) resumePromise = ac.resume().then(() => ac.state === 'running').catch(() => false).finally(() => { resumePromise = null; });
    return resumePromise;
  }
  function applyDuck() {
    const target = muted ? 0 : musicVolume * (voiceDucked ? 0.25 : 1) * (effectsDucked ? 0.35 : 1);
    if (musicGain && ctx) musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.055);
    if (fallbackMusic) fallbackMusic.volume = Math.min(1, target);
  }
  async function sfx(name, volume = 0.8) {
    if (muted || !Object.hasOwn(AUDIO, name)) return;
    const ac = context();
    if (!ac) return;
    const buffer = await loadSound(name);
    if (muted || !buffer || ac.state !== 'running') return;
    const source = ac.createBufferSource(), gain = ac.createGain();
    source.buffer = buffer; gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain); gain.connect(ac.destination);
    const priority = PRIORITY.has(name);
    if (priority) { effectsDucked++; applyDuck(); }
    source.onended = () => {
      source.disconnect(); gain.disconnect();
      if (priority) { effectsDucked = Math.max(0, effectsDucked - 1); applyDuck(); }
    };
    source.start();
  }
  async function playMusic(name, volume = 0.28) {
    if (name === musicName && fallbackMusic && !muted) return;
    if (music) { try { music.stop(); } catch {} music.disconnect(); music = null; }
    if (fallbackMusic) { fallbackMusic.pause(); fallbackMusic = null; }
    musicName = name; musicVolume = volume;
    if (!name || muted || !Object.hasOwn(AUDIO, name)) return;
    // Stream music through an audio element: tiny memory use, and the volume still dips for Alec.
    try {
      const track = new Audio(audioUrl(name));
      track.loop = true; track.preload = 'auto';
      fallbackMusic = track; applyDuck();
      await track.play();
    } catch { /* blocked until the next tap or key press; warm() retries */ }
  }
  function duck(on) { voiceDucked = Boolean(on); applyDuck(); }
  function setMuted(value) {
    muted = Boolean(value); store.set('sa-muted', muted); applyDuck();
    if (muted) { if (music) { try { music.stop(); } catch {} music.disconnect(); music = null; } if (fallbackMusic) { fallbackMusic.pause(); fallbackMusic = null; } }
    else if (musicName) playMusic(musicName, musicVolume);
  }
  function isMuted() { return muted; }
  function vibrate(ms = 30) { try { navigator.vibrate?.(ms); } catch { /* optional */ } }
  // Initialize on idle, not in a critical render. Playback remains gesture-gated.
  const warm = () => { unlockAudio(); if (musicName && !muted && (!fallbackMusic || fallbackMusic.paused)) { if (fallbackMusic) fallbackMusic.play().catch(() => {}); else playMusic(musicName, musicVolume); } };
  window.addEventListener('pointerdown', warm, {passive: true});
  window.addEventListener('keydown', warm);
  if ('requestIdleCallback' in window) requestIdleCallback(() => preloadAudio());
  else setTimeout(() => preloadAudio(), 1500);

  /**
   * Catch browser errors and send them to the server's log, so problems on real
   * TVs and phones can be found. Errors before the connection is ready are kept.
   */
  function reportErrors(socket, where) {
    const queue = [];
    let sent = 0;
    const send = report => {
      if (sent >= 10) return;
      if (!socket.connected) { if (queue.length < 10) queue.push(report); return; }
      sent += 1;
      socket.emit('client:error', report);
    };
    const report = (message, source) => send({where, message: String(message).slice(0, 300), source: String(source || '').slice(0, 120), agent: navigator.userAgent.slice(0, 120)});
    window.addEventListener('error', e => report(e.message || 'Unknown error', e.filename ? `${e.filename.split('/').slice(-2).join('/')}:${e.lineno}` : ''));
    window.addEventListener('unhandledrejection', e => report(`Unhandled: ${e.reason?.message || e.reason}`, ''));
    socket.on('connect', () => { while (queue.length && sent < 10) { sent += 1; socket.emit('client:error', queue.shift()); } });
  }

  return {reportErrors, store, request, layout, avatars, avatarEl, el, syncClock, now, secondsLeft, sfx, playMusic, setMuted, isMuted, vibrate, duck, preloadAudio, unlockAudio};
})();
