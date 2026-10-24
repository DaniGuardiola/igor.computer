import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { igorComputer, keysym } from '../src/tanstack.mjs';
import { chooseModel } from '../src/agent.mjs';

test('KeyboardEvent key names map to X11 keysyms', () => {
  assert.deepEqual(['Enter', 'Control', 'ArrowLeft', 'a', 'F5', ' ', '/', 'PageDown'].map(keysym), ['Return', 'ctrl', 'Left', 'a', 'F5', 'space', 'slash', 'Next']);
  assert.throws(() => keysym('Ctrl;rm'), /Unsupported key/);
});

test('the TanStack driver drives a per-thread workspace through the computer API', async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      calls.push({ path: req.url, auth: req.headers.authorization, workspace: req.headers['x-igor-workspace'], ...JSON.parse(body) });
      const { name, arguments: args } = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(name === 'computer_screenshot' ? { data: Buffer.from('png').toString('base64') } : args.kind === 'cursor' ? { x: 3, y: 4 } : { ok: true }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const factory = igorComputer({ url: `http://127.0.0.1:${server.address().port}`, token: 't', computer: 'acme' });
    assert.deepEqual(factory.display, { width: 1440, height: 1000 });
    assert.equal(factory.capabilities.zoom, true);
    const driver = await factory.create({ threadId: 'chat/1' });
    assert.equal(Buffer.from(await driver.screenshot()).toString(), 'png');
    await driver.click(10.4, 20.6, { button: 'right', count: 2 });
    await driver.press(['Control', 'Shift', 't']);
    await driver.scroll(5, 6, 0, -250);
    assert.deepEqual(await driver.cursorPosition(), { x: 3, y: 4 });
    await driver.zoom({ x: 0, y: 0, width: 10, height: 10 });
    assert.ok(calls.every(call => call.path === '/computers/acme/computer' && call.auth === 'Bearer t' && call.workspace === 'thread-chat-1'));
    assert.deepEqual(calls.map(call => call.arguments), [{}, { kind: 'click', x: 10, y: 21, button: 3, count: 2 }, { kind: 'key', key: 'ctrl+shift+t' },
      { kind: 'scroll', x: 5, y: 6, dx: 0, dy: -250 }, { kind: 'cursor' }, { region: { x: 0, y: 0, width: 10, height: 10 } }]);
  } finally { server.close(); }
});

test('the built-in agent picks a model from flags or available API keys', () => {
  assert.deepEqual(['anthropic', 'openai', 'openrouter'].map(name => chooseModel(name, { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', OPENROUTER_API_KEY: 'r' }).model), ['claude-sonnet-5-5', 'gpt-6.1-sol', 'anthropic/claude-sonnet-5-5']);
  assert.equal(chooseModel(undefined, { OPENAI_API_KEY: 'o' }).provider, 'openai');
  assert.equal(chooseModel('anthropic:claude-opus-5-5', { ANTHROPIC_API_KEY: 'a' }).model, 'claude-opus-5-5');
  assert.throws(() => chooseModel('anthropic', {}), /Set ANTHROPIC_API_KEY/);
  assert.throws(() => chooseModel('mystery', {}), /Unknown provider/);
});
