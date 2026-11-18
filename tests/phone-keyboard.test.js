'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function harness(active, included = true) {
  const document = {
    activeElement: active,
    contains(element) { return included && element === active; },
  };
  const window = {};
  vm.runInNewContext(read('public/play/keyboard.js'), {window, document});
  return {keyboard: window.SAKeyboard, document};
}

test('mobile keyboard is dismissed when a text-entry field is being removed', () => {
  let blurred = 0;
  const input = {matches: selector => selector.includes('input'), blur: () => {blurred++;}};
  const {keyboard} = harness(input);
  assert.equal(keyboard.dismiss(), true);
  assert.equal(blurred, 1);
});

test('answer buttons and inputs outside the replaced panel do not lose focus', () => {
  let blurred = 0;
  const button = {matches: () => false, blur: () => {blurred++;}};
  const {keyboard: onButton} = harness(button);
  assert.equal(onButton.dismiss(), false);
  const input = {matches: s => s.includes('input'), blur: () => {blurred++;}};
  const {keyboard: onInput} = harness(input, false);
  assert.equal(onInput.dismiss(), false);
  assert.equal(blurred, 0);
});

test('typing remains available, but focus is never forced when a new typed question appears', () => {
  const phone = read('public/play/play.js');
  assert.doesNotMatch(phone, /setTimeout\(\(\) => input\.focus\(\)/);
  assert.match(phone, /SAKeyboard\.dismiss\(\$\('panel'\)\)/);
  assert.match(phone, /const typing = document\.activeElement\?\.id === 'typed-answer'/);
});

test('mini-game transitions release the keyboard and do not refocus invisible inputs', () => {
  const phone = read('public/play/noggin-phone.js');
  assert.match(phone, /if\s*\(!sameControls\s*&&\s*priorFocused\) SAKeyboard\.dismiss/);
  assert.doesNotMatch(phone, /\.focus\(\)/);
  assert.doesNotMatch(phone, /input\.select\(\)/);
});
