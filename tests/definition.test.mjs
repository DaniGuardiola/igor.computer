import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonc, normalizeDefinition, loadDefinition, limaExpression, resolveSecrets, parseDuration, substitute } from '../src/definition.mjs';

test('devcontainer JSONC accepts comments and trailing commas without touching strings', () => {
  assert.deepEqual(parseJsonc('{\n // note\n "a": "x // y", /* block */ "b": [1, 2,],\n}'), { a: 'x // y', b: [1, 2] });
});

test('an empty definition is the base computer', () => {
  const value = normalizeDefinition({});
  assert.equal(value.browser, true);
  assert.deepEqual(value.resources, { cpus: 2, memory: 3, disk: 30 });
  assert.equal(value.idleSleep, undefined);
  assert.deepEqual([value.mounts, value.runArgs, value.packages], [[], [], []]);
});

test('definitions validate igor.computer settings and reject typos', () => {
  const igor = settings => ({ customizations: { 'igor.computer': settings } });
  assert.throws(() => normalizeDefinition(igor({ brwoser: false })), /unknown setting "brwoser"/);
  assert.throws(() => normalizeDefinition(igor({ packages: ['ripgrep; rm -rf /'] })), /Debian package/);
  assert.throws(() => normalizeDefinition(igor({ repos: [{ url: 'https://github.com/a/b', path: '../escape' }] })), /inside \/workspace/);
  assert.throws(() => normalizeDefinition(igor({ secrets: { TOKEN: 'plain-value' } })), /references/);
  assert.throws(() => normalizeDefinition(igor({ mcp: { Bad: { command: 'x' } } })), /lowercase/);
  assert.throws(() => normalizeDefinition({ image: 'a', build: { dockerfile: 'Dockerfile' } }), /either image or build/);
  const value = normalizeDefinition(igor({ repos: ['https://github.com/acme/web.git', { url: 'git@github.com:acme/api.git', path: 'svc/api', ref: 'main' }],
    mcp: { db: { command: 'npx', args: ['server'], env: { MODE: 'ro' } } }, services: { worker: 'node w.js' }, idleSleep: '10m', resources: { memory: '8GiB', cpus: 4 } }));
  assert.deepEqual(value.repos, [{ url: 'https://github.com/acme/web.git', path: 'web' }, { url: 'git@github.com:acme/api.git', path: 'svc/api', ref: 'main' }]);
  assert.deepEqual(value.mcp.db, { command: 'npx', args: ['server'], env: { MODE: 'ro' } });
  assert.equal(value.idleSleep, 600);
  assert.deepEqual(value.resources, { cpus: 4, memory: 8, disk: 30 });
  assert.deepEqual(normalizeDefinition({ runArgs: ['--device=/dev/fuse'], foo: 1 }).ignored, ['foo']);
});

test('docker mounts follow devcontainer syntax; host binds share into the VM and disable sleep', () => {
  const value = normalizeDefinition({ mounts: ['source=${localEnv:HOME}/code,target=/code,type=bind,readonly', { type: 'volume', source: 'cache', target: '/cache' }] }, { env: { HOME: '/Users/a' } });
  assert.deepEqual(value.mounts, [{ type: 'bind', source: '/Users/a/code', target: '/code', readonly: true }, { type: 'volume', source: 'cache', target: '/cache', readonly: false }]);
  assert.equal(value.idleSleep, 0);
  assert.equal(limaExpression(value), '.mounts = [{"location":"/Users/a/code","writable":false}] | .mountType = "reverse-sshfs"');
  assert.throws(() => normalizeDefinition({ mounts: ['source=rel,target=/x,type=bind'] }), /absolute host source/);
  assert.throws(() => normalizeDefinition({ mounts: ['source=v,target=/profile'] }), /managed by igor.computer/);
  assert.equal(normalizeDefinition({ mounts: ['source=/a,target=/a,type=bind'], customizations: { 'igor.computer': { idleSleep: '1h', lima: { mountType: 'virtiofs' } } } }).idleSleep, 3600);
  assert.equal(limaExpression(normalizeDefinition({ customizations: { 'igor.computer': { lima: { vmType: 'qemu', cpuType: { aarch64: 'host' } } } } })), '.vmType = "qemu" | .cpuType = {"aarch64":"host"}');
  assert.equal(substitute('${localWorkspaceFolder}/x', { workspace: '/repo' }), '/repo/x');
  assert.equal(parseDuration('never'), 0);
});

test('definitions load from a source folder and track Dockerfile changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'igor-definition-'));
  try {
    await assert.rejects(loadDefinition(root), /No .igor-computer\/devcontainer.json/);
    await mkdir(join(root, '.igor-computer'));
    await writeFile(join(root, '.igor-computer/devcontainer.json'), '{"build":{"dockerfile":"Dockerfile"}}');
    await writeFile(join(root, '.igor-computer/Dockerfile'), 'FROM a');
    const first = await loadDefinition(root);
    assert.equal(first.dir, join(root, '.igor-computer'));
    await writeFile(join(root, '.igor-computer/Dockerfile'), 'FROM b');
    assert.notEqual((await loadDefinition(root)).revision, first.revision);
    assert.equal((await loadDefinition(null)).definition.browser, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('secrets resolve from host references only and fail closed', async () => {
  const run = async (command, args) => ({ stdout: command + ':' + args.at(-1) + '\n' });
  assert.deepEqual(await resolveSecrets({ A: 'env:FROM_ENV', B: 'keychain:svc', C: 'op://vault/item/field' }, { FROM_ENV: 'x' }, run),
    { A: 'x', B: 'security:-w', C: 'op:op://vault/item/field' });
  await assert.rejects(resolveSecrets({ A: 'env:MISSING' }, {}, run), /Secret A \(env\) is empty/);
  assert.deepEqual(await resolveSecrets({ A: 'env:MISSING?', B: 'file:/does/not/exist?' }, {}, run), {});
});
