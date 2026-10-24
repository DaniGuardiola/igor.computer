import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

// A computer definition is a devcontainer.json (https://containers.dev) whose
// igor.computer settings live under customizations["igor.computer"].
export const definitionFiles = ['.igor-computer/devcontainer.json', 'igor-computer.json', 'devcontainer.json'];
const supported = new Set(['name', 'image', 'build', 'features', 'containerEnv', 'remoteEnv', 'postCreateCommand', 'postStartCommand', 'mounts', 'runArgs', 'customizations', '$schema']);
const igorKeys = new Set(['resources', 'browser', 'packages', 'repos', 'mcp', 'services', 'secrets', 'idleSleep', 'lima']);
const envName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const itemName = /^[a-z][a-z0-9-]{0,30}$/;

// JSON with comments and trailing commas, as devcontainer.json allows.
export function parseJsonc(text) {
  let output = '', inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (inString) {
      output += char;
      if (char === '\\') output += text[++i] ?? '';
      else if (char === '"') inString = false;
    } else if (char === '"') { inString = true; output += char; }
    else if (char === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; output += '\n'; }
    else if (char === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; }
    else output += char;
  }
  return JSON.parse(output.replace(/,(\s*[\]}])/g, '$1'));
}

function fail(path, message) { throw new Error(`${path}: ${message}`); }
function stringMap(value, path, keyPattern = envName) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.');
  for (const [key, item] of Object.entries(value)) {
    if (!keyPattern.test(key)) fail(path, `invalid name "${key}".`);
    if (typeof item !== 'string') fail(`${path}.${key}`, 'must be a string.');
  }
  return { ...value };
}
function command(value, path) {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value) && value.length && value.every(part => typeof part === 'string')) return value;
  fail(path, 'must be a command string or an array of strings.');
}
export function parseDuration(value, path = 'idleSleep') {
  if (value === undefined) return undefined;
  if (value === false || value === 'never') return 0;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  const match = typeof value === 'string' && /^(\d+)\s*(s|m|h)$/.exec(value.trim());
  if (!match) fail(path, 'use seconds or a duration like "10m", or "never".');
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}
function size(value, path, minimum) {
  if (value === undefined) return undefined;
  const match = typeof value === 'number' ? [null, String(value)] : typeof value === 'string' && /^(\d+(?:\.\d+)?)\s*(?:GiB|G|GB)?$/i.exec(value.trim());
  if (!match || Number(match[1]) < minimum) fail(path, `use GiB, at least ${minimum}.`);
  return Number(match[1]);
}
function repo(value, index) {
  const path = `repos[${index}]`;
  const item = typeof value === 'string' ? { url: value } : value;
  if (!item || typeof item.url !== 'string' || !/^(https:\/\/|git@|ssh:\/\/)[^\s]+$/.test(item.url)) fail(path, 'needs an https or ssh git URL.');
  const fallback = item.url.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).at(-1);
  const target = item.path ?? fallback;
  if (typeof target !== 'string' || isAbsolute(target) || target.split('/').some(part => !part || part === '..' || part === '.git')) fail(path, 'path must stay inside /workspace.');
  if (item.ref !== undefined && (typeof item.ref !== 'string' || !/^[\w./-]{1,200}$/.test(item.ref))) fail(path, 'invalid ref.');
  return { url: item.url, path: target, ...(item.ref ? { ref: item.ref } : {}) };
}
function mcpServer(value, name) {
  const path = `mcp.${name}`;
  if (!itemName.test(name)) fail(path, 'names use lowercase letters, digits and dashes.');
  if (!value || typeof value.command !== 'string' || !value.command.trim()) fail(path, 'needs a command.');
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(arg => typeof arg !== 'string'))) fail(path + '.args', 'must be strings.');
  if (value.cwd !== undefined && (typeof value.cwd !== 'string' || !value.cwd.startsWith('/'))) fail(path + '.cwd', 'must be an absolute guest path.');
  return { command: value.command, args: value.args || [], env: stringMap(value.env, path + '.env'), ...(value.cwd ? { cwd: value.cwd } : {}) };
}

// devcontainer variables: ${localEnv:NAME} and ${localWorkspaceFolder}.
export function substitute(value, { env = process.env, workspace } = {}) {
  return value.replace(/\$\{(localEnv:([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?|localWorkspaceFolder)\}/g, (_match, kind, name, fallback) =>
    kind === 'localWorkspaceFolder' ? (workspace ?? fail('mounts', '${localWorkspaceFolder} needs a definition folder.')) : env[name] ?? fallback ?? '');
}
// Docker --mount syntax, as a string or object, as in devcontainer.json.
function mount(value, index, variables) {
  const path = `mounts[${index}]`;
  const item = typeof value === 'string' ? Object.fromEntries(value.split(',').map(part => { const [key, ...rest] = part.split('='); return [key.trim(), rest.join('=') || 'true']; })) : value;
  if (!item || typeof item !== 'object') fail(path, 'must be a mount string or object.');
  const target = item.target ?? item.destination ?? item.dst;
  const source = item.source ?? item.src;
  const type = item.type ?? 'volume';
  if (!['bind', 'volume', 'tmpfs'].includes(type)) fail(path, 'type must be bind, volume or tmpfs.');
  if (typeof target !== 'string' || !target.startsWith('/')) fail(path, 'needs an absolute target.');
  if (['/profile', '/home/browser', '/workspace', '/opt/igor-computer'].includes(target.replace(/\/$/, ''))) fail(path, `${target} is managed by igor.computer.`);
  const resolved = typeof source === 'string' ? substitute(source, variables) : undefined;
  if (type === 'bind' && (!resolved || !isAbsolute(resolved))) fail(path, 'bind mounts need an absolute host source.');
  if (type === 'volume' && (!resolved || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(resolved))) fail(path, 'volume mounts need a volume name.');
  const readonly = ['readonly', 'ro'].some(key => item[key] === true || item[key] === 'true' || item[key] === '1');
  return { type, ...(resolved ? { source: resolved } : {}), target, readonly };
}

export function normalizeDefinition(raw = {}, variables = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('definition', 'must be a JSON object.');
  const ignored = Object.keys(raw).filter(key => !supported.has(key));
  const igor = raw.customizations?.['igor.computer'] ?? {};
  if (typeof igor !== 'object' || Array.isArray(igor)) fail('customizations["igor.computer"]', 'must be an object.');
  for (const key of Object.keys(igor)) if (!igorKeys.has(key)) fail('customizations["igor.computer"]', `unknown setting "${key}".`);
  if (raw.image !== undefined && (typeof raw.image !== 'string' || !raw.image.trim())) fail('image', 'must be an image reference.');
  if (raw.image && raw.build) fail('definition', 'use either image or build, not both.');
  let build;
  if (raw.build !== undefined) {
    if (typeof raw.build?.dockerfile !== 'string') fail('build.dockerfile', 'is required.');
    build = { dockerfile: raw.build.dockerfile, context: raw.build.context ?? '.', args: stringMap(raw.build.args, 'build.args'), ...(raw.build.target ? { target: String(raw.build.target) } : {}) };
  }
  if (raw.features !== undefined && (typeof raw.features !== 'object' || Array.isArray(raw.features))) fail('features', 'must be an object.');
  const resources = igor.resources ?? {};
  const cpus = resources.cpus ?? 2;
  if (!Number.isInteger(cpus) || cpus < 1 || cpus > 64) fail('resources.cpus', 'must be 1-64.');
  const packages = igor.packages ?? [];
  if (!Array.isArray(packages) || packages.some(item => typeof item !== 'string' || !/^[a-z0-9][a-z0-9.+-]*(=[\w.+:~-]+)?$/.test(item))) fail('packages', 'must be Debian package names.');
  const repos = (igor.repos ?? []).map(repo);
  if (new Set(repos.map(item => item.path)).size !== repos.length) fail('repos', 'two repos use the same path.');
  const services = {};
  for (const [name, value] of Object.entries(igor.services ?? {})) {
    if (!itemName.test(name)) fail(`services.${name}`, 'names use lowercase letters, digits and dashes.');
    services[name] = command(value, `services.${name}`);
  }
  const mcp = {};
  for (const [name, value] of Object.entries(igor.mcp ?? {})) mcp[name] = mcpServer(value, name);
  const secrets = stringMap(igor.secrets, 'secrets');
  for (const [name, ref] of Object.entries(secrets)) if (!/^(env|file|keychain|op):.+/.test(ref) && !ref.startsWith('op://')) fail(`secrets.${name}`, 'use env:, file:, keychain: or op:// references.');
  if (igor.browser !== undefined && typeof igor.browser !== 'boolean') fail('browser', 'must be true or false.');
  if (raw.mounts !== undefined && !Array.isArray(raw.mounts)) fail('mounts', 'must be an array.');
  const mounts = (raw.mounts ?? []).map((item, index) => mount(item, index, variables));
  if (raw.runArgs !== undefined && (!Array.isArray(raw.runArgs) || raw.runArgs.some(arg => typeof arg !== 'string'))) fail('runArgs', 'must be an array of strings.');
  const lima = igor.lima ?? {};
  if (typeof lima !== 'object' || Array.isArray(lima)) fail('lima', 'must be an object of Lima settings.');
  for (const key of Object.keys(lima)) if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) fail('lima', `invalid key "${key}".`);
  const hostMounts = mounts.some(item => item.type === 'bind');
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    ...(raw.image ? { image: raw.image } : {}), ...(build ? { build } : {}),
    features: raw.features ?? {},
    containerEnv: { ...stringMap(raw.containerEnv, 'containerEnv'), ...stringMap(raw.remoteEnv, 'remoteEnv') },
    postCreateCommand: command(raw.postCreateCommand, 'postCreateCommand'),
    postStartCommand: command(raw.postStartCommand, 'postStartCommand'),
    resources: { cpus, memory: size(resources.memory, 'resources.memory', 2) ?? 3, disk: size(resources.disk, 'resources.disk', 10) ?? 30 },
    browser: igor.browser ?? true, packages, repos, services, mcp, secrets,
    // QEMU cannot snapshot a VM with live host shares, so host mounts default to no idle sleep.
    idleSleep: parseDuration(igor.idleSleep) ?? (hostMounts ? 0 : undefined),
    mounts, runArgs: raw.runArgs ?? [], lima,
    ignored,
  };
}

export async function findDefinition(source) {
  if (!source) return null;
  const info = await stat(source).catch(() => null);
  if (!info) throw new Error(`Definition source ${source} does not exist.`);
  if (info.isFile()) return source;
  for (const name of definitionFiles) {
    const file = join(source, name);
    if (await stat(file).then(item => item.isFile(), () => false)) return file;
  }
  throw new Error(`No ${definitionFiles.join(' or ')} in ${source}.`);
}

// Returns the normalized definition plus where relative build paths resolve.
export async function loadDefinition(source) {
  const file = await findDefinition(source);
  if (!file) return { file: null, dir: null, definition: normalizeDefinition({}), revision: hash({}) };
  let raw;
  try { raw = parseJsonc(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`${file}: ${error.message}`); }
  const dir = dirname(file);
  const workspace = dir.endsWith('/.igor-computer') ? dirname(dir) : dir;
  const definition = normalizeDefinition(raw, { workspace });
  let dockerfile = '';
  if (definition.build) {
    const path = resolve(dir, definition.build.dockerfile);
    if (relative(dir, path).startsWith('..') && relative(resolve(dir, definition.build.context), path).startsWith('..')) throw new Error('build.dockerfile must be inside the definition folder or build context.');
    dockerfile = await readFile(path, 'utf8');
  }
  return { file, dir, definition, revision: hash({ definition, dockerfile }) };
}

export function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Secrets resolve on the host at container start and never enter the image.
// A trailing ? marks a secret as optional.
export async function resolveSecrets(secrets, environment = process.env, run = exec) {
  const values = {};
  for (const [name, reference] of Object.entries(secrets)) {
    const optional = reference.endsWith('?');
    const ref = optional ? reference.slice(0, -1) : reference;
    let value;
    try {
    if (ref.startsWith('env:')) value = environment[ref.slice(4)];
    else if (ref.startsWith('file:')) value = (await readFile(ref.slice(5).replace(/^~(?=\/)/, environment.HOME || ''), 'utf8')).trim();
    else if (ref.startsWith('keychain:')) value = (await run('security', ['find-generic-password', '-s', ref.slice(9), '-w'])).stdout.trim();
    else value = (await run('op', ['read', ref.replace(/^op:(?!\/\/)/, 'op://')])).stdout.trim();
    } catch { value = ''; }
    if (!value && optional) continue;
    if (!value) throw new Error(`Secret ${name} (${ref.split(':')[0]}) is empty or unavailable.`);
    values[name] = value;
  }
  return values;
}

// Lima settings as yq expressions for limactl --set. Host bind mounts are first
// shared into the VM at the same path, then bound into the container.
export function limaExpression(definition) {
  const settings = { ...definition.lima };
  const binds = definition.mounts.filter(item => item.type === 'bind');
  if (binds.length) {
    const mounts = [...(settings.mounts || [])];
    for (const item of binds) if (!mounts.some(existing => existing.location === item.source)) mounts.push({ location: item.source, writable: !item.readonly });
    settings.mounts = mounts;
    settings.mountType ??= 'reverse-sshfs';
  }
  return Object.entries(settings).map(([key, value]) => `.${key} = ${JSON.stringify(value)}`).join(' | ');
}
