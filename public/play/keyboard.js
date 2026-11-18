'use strict';
/**
 * Android / iOS virtual-keyboard lifecycle.
 * The keyboard should only appear after a deliberate tap into a text field.
 * When a text control disappears, blur it BEFORE replacing its DOM nodes.
 */
window.SAKeyboard = Object.freeze({
  dismiss(root = document) {
    const active = document.activeElement;
    if (!active || !active.matches?.('input, textarea, [contenteditable="true"]')) return false;
    if (root && !root.contains(active)) return false;
    active.blur();
    return true;
  },
});
