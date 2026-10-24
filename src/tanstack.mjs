// igor.computer as a TanStack AI computer-use driver.
//
//   import { createComputerUse } from '@tanstack/ai-computer-use'
//   import { igorComputer } from 'igor-computer/tanstack'
//   const computerUse = createComputerUse({ driver: igorComputer({ computer: 'acme' }) })
//
// Each chat thread gets its own workspace (desktop) on the computer, so the
// model's provider-native computer tool (Claude or OpenAI) drives a real
// Linux desktop that a person can watch and take over.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir, origin } from './config.mjs';

export const display = { width: 1440, height: 1000 };
const buttons = { left: 1, middle: 2, right: 3, back: 8, forward: 9 };
// KeyboardEvent.key names to X11 keysyms, for xdotool.
const keysyms = {
  Enter: 'Return', Escape: 'Escape', Backspace: 'BackSpace', Tab: 'Tab', ' ': 'space', Delete: 'Delete', Insert: 'Insert',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next',
  Control: 'ctrl', Shift: 'shift', Alt: 'alt', Meta: 'super', CapsLock: 'Caps_Lock', ContextMenu: 'Menu',
  '-': 'minus', '=': 'equal', '[': 'bracketleft', ']': 'bracketright', ';': 'semicolon', "'": 'apostrophe', ',': 'comma',
  '.': 'period', '/': 'slash', '\\': 'backslash', '`': 'grave', '!': 'exclam', '@': 'at', '#': 'numbersign', '$': 'dollar',
  '%': 'percent', '^': 'asciicircum', '&': 'ampersand', '*': 'asterisk', '(': 'parenleft', ')': 'parenright', '_': 'underscore',
  '+': 'plus', '{': 'braceleft', '}': 'braceright', ':': 'colon', '"': 'quotedbl', '<': 'less', '>': 'greater', '?': 'question',
  '|': 'bar', '~': 'asciitilde',
};
export function keysym(key) {
  if (keysyms[key]) return keysyms[key];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key) || /^[a-zA-Z0-9]$/.test(key)) return key;
  throw new Error(`Unsupported key ${JSON.stringify(key)}.`);
}

// `workspace` pins every thread to one workspace; by default each thread gets
// its own, named `thread-<id>`.
export function igorComputer({ url = process.env.IGOR_COMPUTER_URL || origin, token, tokenFile = process.env.IGOR_COMPUTER_TOKEN_FILE || join(stateDir, 'token'), computer = process.env.IGOR_COMPUTER || 'default', workspace } = {}) {
  const base = url.replace(/\/$/, '') + (computer === 'default' ? '' : '/computers/' + computer);
  let credential = token;
  async function call(name, args, space) {
    credential ??= (await readFile(tokenFile, 'utf8')).trim();
    const response = await fetch(base + '/computer', {
      method: 'POST', body: JSON.stringify({ name, arguments: args }),
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', 'X-Igor-Workspace': space },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'igor.computer request failed.');
    return data;
  }
  const png = async (args, space) => Uint8Array.from(Buffer.from((await call('computer_screenshot', args, space)).data, 'base64'));
  function driver(space) {
    const input = args => call('computer_input', args, space).then(() => {});
    return {
      display, environment: 'linux',
      screenshot: () => png({}, space),
      zoom: region => png({ region }, space),
      click: (x, y, { button = 'left', count = 1 } = {}) => input({ kind: 'click', x: Math.round(x), y: Math.round(y), button: buttons[button], count }),
      move: (x, y) => input({ kind: 'move', x: Math.round(x), y: Math.round(y) }),
      mouseDown: button => input({ kind: 'down', button: buttons[button] }),
      mouseUp: button => input({ kind: 'up', button: buttons[button] }),
      scroll: (x, y, dx, dy) => input({ kind: 'scroll', x: Math.round(x), y: Math.round(y), dx, dy }),
      keyDown: key => input({ kind: 'keydown', key: keysym(key) }),
      keyUp: key => input({ kind: 'keyup', key: keysym(key) }),
      press: keys => input({ kind: 'key', key: keys.map(keysym).join('+') }),
      type: text => input({ kind: 'type', text }),
      cursorPosition: () => call('computer_input', { kind: 'cursor' }, space),
    };
  }
  return {
    display, environment: 'linux', capabilities: { zoom: true, cursorPosition: true, navigate: false },
    create: async ({ threadId }) => driver(workspace || 'thread-' + String(threadId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 53)),
  };
}
