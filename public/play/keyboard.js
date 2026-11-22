'use strict';
/**
 * Android / iOS virtual-keyboard lifecycle.
 * The keyboard should only appear after a deliberate tap into a text field.
 * When a text control disappears, blur it BEFORE replacing its DOM nodes.
 */
// Keep the answer form visible when a mobile virtual keyboard reduces the visual viewport.
// A resize does not replace any controls or alter submitted answer state.
(function setupKeyboardViewport() {
  const viewport = window.visualViewport;
  let pending = false;
  const positionAnswer = () => {
    pending = false;
    const active = document.activeElement;
    if (!active?.matches?.('#view-game input, #view-game textarea')) return;
    const form = active.closest('form');
    if (!form) return;
    form.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  };
  const queuePosition = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(positionAnswer);
  };
  document.addEventListener('focusin', event => {
    if (!event.target?.matches?.('#view-game input, #view-game textarea')) return;
    document.body.classList.add('sa-answer-keyboard');
    queuePosition();
  });
  document.addEventListener('focusout', event => {
    if (!event.target?.matches?.('#view-game input, #view-game textarea')) return;
    document.body.classList.remove('sa-answer-keyboard');
  });
  viewport?.addEventListener('resize', queuePosition, {passive: true});
  viewport?.addEventListener('scroll', queuePosition, {passive: true});
})();

window.SAKeyboard = Object.freeze({
  dismiss(root = document) {
    const active = document.activeElement;
    if (!active || !active.matches?.('input, textarea, [contenteditable="true"]')) return false;
    if (root && !root.contains(active)) return false;
    active.blur();
    return true;
  },
});
