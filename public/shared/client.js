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

  /* ---------- sound ---------- */
  const sounds = {};
  let muted = store.get('sa-muted') === true;
  let music = null;
  function sfx(name, volume = 0.8) {
    if (muted) return;
    try {
      const a = sounds[name] || (sounds[name] = new Audio(`/sounds/${name}.mp3`));
      const copy = a.cloneNode();
      copy.volume = volume;
      copy.play().catch(() => {});
    } catch { /* sound is optional */ }
  }
  function playMusic(name, volume = 0.28) {
    if (music && music.dataset.name === name) return;
    if (music) { music.pause(); music = null; }
    if (muted || !name) return;
    try {
      music = new Audio(`/sounds/${name}.ogg`);
      music.dataset.name = name;
      music.loop = true; music.volume = volume;
      music.play().catch(() => {});
    } catch { music = null; }
  }
  /** Quieten the music while Alec is talking. */
  function duck(on) { if (music) music.volume = on ? 0.08 : 0.28; }
  function setMuted(value) {
    muted = value; store.set('sa-muted', value);
    if (muted && music) { music.pause(); music = null; }
  }
  function isMuted() { return muted; }
  function vibrate(ms = 30) { try { navigator.vibrate?.(ms); } catch { /* not supported */ } }

  return {store, request, layout, avatars, avatarEl, el, syncClock, now, secondsLeft, sfx, playMusic, setMuted, isMuted, vibrate, duck};
})();
