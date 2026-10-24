import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { hash } from './definition.mjs';
import { runtimeRoot, dockerConfig } from './config.mjs';
import { container } from './guest.mjs';
const exec = promisify(execFile);

export const baseImage = 'igor-computer-base';
export const finalImage = 'igor-computer:current';
const baseFiles = ['Dockerfile', 'supervisor.py', 'windows.py', 'computer.py', 'setup.py', 'seccomp.json'];
const buildTimeout = 30 * 60 * 1000;
// Bump when the generated final layer changes, so existing computers rebuild.
const layerVersion = 2;

export async function baseRevision(root = join(runtimeRoot, 'container')) {
  const parts = [];
  for (const name of baseFiles) parts.push([name, (await readFile(join(root, name))).toString('base64')]);
  return hash(parts);
}

// What supervisor.py and setup.py read inside the guest. Secrets stay out.
export function guestDefinition(definition, revision) {
  const { browser, services, repos, postCreateCommand, postStartCommand } = definition;
  return { revision, browser, services, repos, ...(postCreateCommand ? { postCreateCommand } : {}), ...(postStartCommand ? { postStartCommand } : {}) };
}

// The OS contract (see docs/computers.md). Definitions extend the parent OS
// manifest with their MCP servers; a disabled browser is removed from it.
export function parseManifest(text, image = 'image') {
  let manifest;
  try { manifest = JSON.parse(text); } catch { manifest = null; }
  if (manifest?.contract !== 1) throw new Error(`${image} does not implement the igor.computer OS contract (label ai.igor.computer.os). Build it FROM ${baseImage}, or add the label.`);
  for (const key of ['control', 'setup', 'desktopTools']) if (manifest[key] !== undefined && (!Array.isArray(manifest[key]) || !manifest[key].length || manifest[key].some(part => typeof part !== 'string'))) throw new Error(`${image}: OS manifest ${key} must be a command array.`);
  if (!manifest.control) throw new Error(`${image}: OS manifest needs a control command.`);
  if (!Number.isInteger(manifest.display?.port) || typeof manifest.display?.auth !== 'string') throw new Error(`${image}: OS manifest needs display.port and display.auth.`);
  if (!Array.isArray(manifest.browsers ?? []) || (manifest.browsers ?? []).some(item => !Number.isInteger(item?.cdpPort))) throw new Error(`${image}: OS manifest browsers need cdpPort.`);
  return { browsers: [], mcp: {}, ...manifest };
}

export function finalManifest(parent, definition) {
  return { ...parent, browsers: definition.browser ? parent.browsers : [], mcp: { ...parent.mcp, ...definition.mcp } };
}

export function finalDockerfile(parent, definition, revision, manifest) {
  const lines = [`FROM ${parent}`, 'USER root'];
  if (definition.packages.length) lines.push(`RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${definition.packages.join(' ')} && rm -rf /var/lib/apt/lists/*`);
  lines.push('COPY definition.json /opt/igor-computer/definition.json',
    `LABEL ai.igor.computer.revision=${revision} ai.igor.computer.os=${JSON.stringify(JSON.stringify(manifest))}`, 'USER browser');
  return lines.join('\n') + '\n';
}

export class ImageBuilder {
  constructor(context, { run = (args, options = {}) => exec('docker', args, { env: context.env, maxBuffer: 16 * 1024 * 1024, timeout: buildTimeout, ...options }), log = message => console.error(`[${context.name}] ${message}`) } = {}) {
    this.context = context; this.run = run; this.log = log;
  }
  async label(image, name) {
    try { return (await this.run(['image', 'inspect', '--format', `{{index .Config.Labels "${name}"}}`, image])).stdout.trim(); }
    catch { return ''; }
  }
  async base() {
    const revision = await baseRevision();
    if (await this.label(baseImage, 'ai.igor.computer.runtime-revision') !== revision) {
      this.log('building base image');
      await this.run(['build', '--build-arg', `IGOR_RUNTIME_REVISION=${revision}`, '-t', baseImage, join(runtimeRoot, 'container')]);
    }
    return revision;
  }
  async features(parent, features, definitionDir) {
    if (Object.keys(features).some(id => id.startsWith('.') || id.startsWith('/'))) throw new Error('Local devcontainer features are not supported yet. Publish them to an OCI registry.');
    try { await this.run(['buildx', 'version']); }
    catch { throw new Error('Devcontainer features need Docker buildx. Install it with: brew install docker-buildx'); }
    const dir = join(this.context.dir, 'features');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'devcontainer.json'), JSON.stringify({ image: parent, features }));
    const cli = createRequire(import.meta.url).resolve('@devcontainers/cli/devcontainer.js');
    this.log('applying devcontainer features');
    await exec(process.execPath, [cli, 'build', '--workspace-folder', definitionDir || dir, '--config', join(dir, 'devcontainer.json'),
      '--image-name', 'igor-computer-features', '--docker-path', 'docker', '--log-level', 'info'],
    { env: this.context.env, maxBuffer: 32 * 1024 * 1024, timeout: buildTimeout });
    return 'igor-computer-features';
  }
  async build(loaded, { force = false } = {}) {
    const { definition } = loaded;
    const base = await this.base();
    const revision = hash([layerVersion, base, loaded.revision]);
    if (!force && await this.label(finalImage, 'ai.igor.computer.revision') === revision) return revision;
    let parent = baseImage;
    if (definition.build) {
      const context = resolve(loaded.dir, definition.build.context);
      this.log('building definition Dockerfile');
      await this.run(['build', '-f', resolve(loaded.dir, definition.build.dockerfile), '--build-arg', `IGOR_COMPUTER_BASE=${baseImage}`,
        ...Object.entries(definition.build.args).flatMap(([key, value]) => ['--build-arg', `${key}=${value}`]),
        ...(definition.build.target ? ['--target', definition.build.target] : []), '-t', 'igor-computer-custom', context]);
      parent = 'igor-computer-custom';
    } else if (definition.image) {
      if (!await this.label(definition.image, 'ai.igor.computer.os')) await this.run(['pull', definition.image]);
      parent = definition.image;
    }
    const manifest = finalManifest(parseManifest(await this.label(parent, 'ai.igor.computer.os'), definition.image || 'The build.dockerfile image'), definition);
    if (Object.keys(definition.features).length) parent = await this.features(parent, definition.features, loaded.dir);
    const dir = join(this.context.dir, 'build');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'Dockerfile'), finalDockerfile(parent, definition, revision, manifest));
    await writeFile(join(dir, 'definition.json'), JSON.stringify(guestDefinition(definition, revision)));
    // The server's private umask must not make the file unreadable in the guest.
    await chmod(join(dir, 'definition.json'), 0o644);
    this.log('building computer image');
    await this.run(['build', '-t', finalImage, dir]);
    return revision;
  }
  async manifest() {
    return parseManifest(await this.label(finalImage, 'ai.igor.computer.os'), finalImage);
  }
  // Volumes keep the profile, home and /workspace across image changes.
  async start(definition, manifest, secrets = {}) {
    const environment = { ...definition.containerEnv, ...secrets };
    const envRevision = hash([Object.entries(environment).sort(), definition.mounts, definition.runArgs, definition.resources]);
    let current;
    try { current = JSON.parse((await this.run(['container', 'inspect', container])).stdout)[0]; } catch {}
    const image = (await this.run(['image', 'inspect', '--format', '{{.Id}}', finalImage])).stdout.trim();
    if (current && current.Image === image && current.Config.Labels?.['ai.igor.computer.env'] === envRevision) {
      if (!current.State.Running) await this.run(['start', container]);
      return;
    }
    if (current) {
      this.log('replacing computer container');
      await this.run(['stop', '--time', '30', container]).catch(() => {});
      await this.run(['rm', container]);
    }
    for (const volume of ['profile', 'home', 'workspace']) await this.run(['volume', 'create', 'igor-computer-' + volume]);
    const { cpus, memory } = definition.resources;
    // Values travel through the Docker CLI's environment, never its arguments.
    await this.run(['run', '-d', '--name', container, '--restart', 'unless-stopped',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true',
      '--security-opt', `seccomp=${join(runtimeRoot, 'container/seccomp.json')}`,
      '--shm-size', '512m', '--memory', `${Math.max(1, memory - 1)}g`, '--cpus', String(cpus),
      // Lima forwards these VM ports to the computer's own host ports.
      '-p', `127.0.0.1:18423:${manifest.display.port}`, ...(manifest.browsers[0] ? ['-p', `127.0.0.1:18422:${manifest.browsers[0].cdpPort}`] : []),
      '-v', 'igor-computer-profile:/profile', '-v', 'igor-computer-home:/home/browser', '-v', 'igor-computer-workspace:/workspace',
      '--label', `ai.igor.computer.env=${envRevision}`,
      ...Object.keys(environment).flatMap(name => ['-e', name]),
      ...definition.mounts.map(item => '--mount=' + [`type=${item.type}`, ...(item.source ? [`source=${item.source}`] : []), `target=${item.target}`, ...(item.readonly ? ['readonly'] : [])].join(',')),
      // devcontainer runArgs pass straight through to docker run.
      ...definition.runArgs, finalImage],
    { env: { ...this.context.env, ...environment } });
  }
}

export async function dockerConfigReady() {
  await mkdir(dockerConfig, { recursive: true, mode: 0o700 });
  await writeFile(join(dockerConfig, 'config.json'), JSON.stringify({ cliPluginsExtraDirs: ['/opt/homebrew/lib/docker/cli-plugins', '/usr/local/lib/docker/cli-plugins', '/usr/lib/docker/cli-plugins'] }));
}
