import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry, computerContext, validateName } from '../src/computers.mjs';
import { finalDockerfile, finalManifest, guestDefinition, parseManifest } from '../src/image.mjs';
import { defaultManifest } from '../src/guest.mjs';
import { normalizeDefinition } from '../src/definition.mjs';

test('computers get stable unique port pairs and isolated VM names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'igor-registry-'));
  try {
    const registry = new Registry(root);
    await registry.ensureDefault();
    const team = await registry.create('team', '/defs/team');
    assert.deepEqual([team.cdpPort, team.displayPort], [18432, 18433]);
    await registry.remove('default');
    assert.equal((await registry.create('again')).cdpPort, 18430);
    await assert.rejects(registry.create('team'), /already exists/);
    const context = computerContext('team', team, root);
    assert.equal(context.vmName, 'igor-computer-team');
    assert.equal(context.cdpUrl, 'http://127.0.0.1:18432');
    assert.match(context.env.DOCKER_HOST, /igor-computer-team\/sock\/docker.sock$/);
    assert.equal(computerContext('git', { source: 'https://github.com/acme/eng', path: 'computers/web', cdpPort: 1, displayPort: 2 }, root).source, join(root, 'computers/git/source/computers/web'));
    assert.throws(() => validateName('Bad Name'));
    assert.throws(() => validateName('a'.repeat(21)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the OS contract is validated and extended, never assumed', () => {
  assert.throws(() => parseManifest(''), /does not implement the igor.computer OS contract/);
  assert.throws(() => parseManifest(JSON.stringify({ contract: 1, display: { port: 1, auth: '/a' } })), /control command/);
  const parent = parseManifest(JSON.stringify(defaultManifest));
  const definition = normalizeDefinition({ customizations: { 'igor.computer': { browser: false, packages: ['jq'], mcp: { db: { command: 'db-mcp' } } } } });
  const manifest = finalManifest(parent, definition);
  assert.deepEqual(manifest.browsers, []);
  assert.deepEqual(Object.keys(manifest.mcp), ['db']);
  const dockerfile = finalDockerfile('igor-computer-base', definition, 'rev', manifest);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends jq/);
  assert.match(dockerfile, /LABEL ai\.igor\.computer\.revision=rev ai\.igor\.computer\.os="\{.*\\"contract\\":1/);
  assert.match(dockerfile, /USER browser\n$/);
  assert.deepEqual(Object.keys(guestDefinition(definition, 'rev')).sort(), ['browser', 'repos', 'revision', 'services']);
});
