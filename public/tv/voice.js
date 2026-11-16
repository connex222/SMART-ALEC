'use strict';
/**
 * Alec's voice. Plays one line at a time from /voice/, picks a random take
 * where there are several, never repeats the last take, drops lines that have
 * waited too long, and lowers the music while he talks.
 */
window.AlecVoice = (() => {
  const GROUPS = {
    welcome: 3, join: 3, start: 2, 'turn-any': 3, roll: 2, smart: 2, right: 6, token: 3, wrong: 6,
    timeout: 2, steal: 3, 'steal-won': 2, nobody: 2, minigame: 3, 'mini-win': 2, 'final-unlock': 2,
    'final-start': 2, 'final-win': 2, 'final-lose': 2,
  };
  const MAX_WAIT_MS = 6000;
  // Chatter that can be cut short when something that matters happens (a right or wrong answer, a steal...).
  const LOW = /^(turn|roll|land-|choose|safe|smart|join|pass-go|catchup|welcome)/;
  let enabled = SA.store.get('sa-voice') !== false;
  let current = null;
  const queue = [];
  const lastTake = {};

  function file(name) {
    const takes = GROUPS[name];
    if (!takes) return name;
    let n;
    do { n = 1 + Math.floor(Math.random() * takes); } while (takes > 1 && n === lastTake[name]);
    lastTake[name] = n;
    return `${name}-${n}`;
  }

  function next() {
    if (current) return;
    while (queue.length && Date.now() - queue[0].at > MAX_WAIT_MS) queue.shift();
    const item = queue.shift();
    if (!item) { SA.duck(false); return; }
    const audio = new Audio(`/voice/${item.file}.mp3`);
    audio.low = item.low;
    current = audio;
    SA.duck(true);
    const done = () => { if (current === audio) { current = null; next(); } };
    audio.addEventListener('ended', done);
    audio.addEventListener('error', done);
    audio.play().catch(done);
  }

  /** Queue a line. `interrupt` cuts off whatever he is saying (big moments only). */
  function say(name, {interrupt = false} = {}) {
    if (!enabled || SA.isMuted() || !name) return;
    if (interrupt) { queue.length = 0; if (current) { current.pause(); current = null; } }
    if (queue.length >= 2) queue.shift();
    const low = LOW.test(name);
    if (!low) {
      // An important line clears any queued chatter and cuts off chatter already playing.
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].low) queue.splice(i, 1);
      if (current && current.low) { current.pause(); current = null; }
    }
    queue.push({file: file(name), at: Date.now(), low});
    next();
  }

  function setEnabled(on) {
    enabled = on;
    SA.store.set('sa-voice', on);
    if (!on) { queue.length = 0; if (current) { current.pause(); current = null; } SA.duck(false); }
  }

  return {say, setEnabled, isEnabled: () => enabled, chance: p => Math.random() < p};
})();
