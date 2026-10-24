#!/usr/bin/env node
// igor-computer: manage computers on an igor.computer server.
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import http from 'node:http';
import https from 'node:https';
import { stateDir, origin } from './config.mjs';
import { isGitSource } from './computers.mjs';
import { loadDefinition } from './definition.mjs';

const usage = `usage: igor-computer <command>

  ls                              list computers
  create <name> [source]          create a computer; source is a folder, a
         [--path dir] [--ref ref]   devcontainer.json, or a git URL
  status [name]                   computer status
  rebuild <name>                  apply definition changes (keeps logins and files)
  update <name>                   pull a git-sourced definition, then rebuild to apply
  sleep <name> | wake <name>      save RAM and stop, or start
  rm <name>                       delete a computer, its VM and all its data
  viewer [name]                   print the viewer URL
  mcp [name]                      run the stdio MCP bridge for a computer
  check [path]                    validate a definition without a server
  init [folder]                   write a starter .igor-computer/devcontainer.json

Server: IGOR_COMPUTER_URL (default ${origin}), IGOR_COMPUTER_TOKEN_FILE.`;

const [command, ...rest] = process.argv.slice(2);
const flags = {}, positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  else positional.push(rest[i]);
}
const serverUrl = (process.env.IGOR_COMPUTER_URL || origin).replace(/\/$/, '');
const path = name => !name || name === 'default' ? '' : '/computers/' + name;

// Plain http(s) so long rebuilds are never cut off by fetch's header timeout.
async function call(route, args, method = args === undefined ? 'GET' : 'POST') {
  const token = (await readFile(process.env.IGOR_COMPUTER_TOKEN_FILE || join(stateDir, 'token'), 'utf8')).trim();
  const url = new URL(serverUrl + route);
  const data = args === undefined ? undefined : JSON.stringify(args);
  return new Promise((done, fail) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let value;
        try { value = JSON.parse(text); } catch { return fail(new Error(`Unexpected server response (${response.statusCode}).`)); }
        response.statusCode < 300 ? done(value) : fail(new Error(value.error || 'Request failed.'));
      });
    });
    request.on('error', () => fail(new Error(`igor.computer server is not reachable at ${serverUrl}.`)));
    request.end(data);
  });
}
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(row => String(row[i]).length)));
  for (const row of rows) console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd());
}
function need(value, what) { if (!value) { console.error(`Missing ${what}.\n\n${usage}`); process.exit(2); } return value; }

const starter = `// igor.computer definition: a devcontainer.json (https://containers.dev)
// built on the igor.computer base OS. See docs/computers.md.
{
  "name": "my-computer",
  // Devcontainer features install tools (needs docker-buildx).
  // "features": { "ghcr.io/devcontainers/features/node:1": {} },
  // Or extend the base OS with your own Dockerfile:
  // "build": { "dockerfile": "Dockerfile" },  // ARG IGOR_COMPUTER_BASE / FROM \${IGOR_COMPUTER_BASE}
  "containerEnv": {},
  // Docker --mount syntax. Host folders are shared into the VM automatically.
  // "mounts": ["source=\${localEnv:HOME}/code,target=/code,type=bind"],
  // "postCreateCommand": "cd /workspace/app && npm install",
  "customizations": {
    "igor.computer": {
      "resources": { "cpus": 2, "memory": "4GiB", "disk": "30GiB" },
      "browser": true,
      "packages": ["ripgrep", "jq"],
      "repos": [],
      "mcp": {},
      "services": {},
      "secrets": {},
      "idleSleep": "5m"
    }
  }
}
`;

try {
  switch (command) {
    case 'ls': case 'list': {
      const { computers } = await call('/computers');
      table([['NAME', 'STATE', 'MODE', 'BROWSER', 'MCP', 'SOURCE'], ...computers.map(item => [item.name, item.state, item.mode, item.browser ? 'yes' : 'no', item.mcp.join(',') || '-', item.source || '(base)'])]);
      break;
    }
    case 'create': {
      const name = need(positional[0], 'computer name');
      let source = positional[1] ?? null;
      if (source && !isGitSource(source)) source = resolve(source);
      const created = await call('/computers', { name, source, ...(flags.path ? { path: flags.path } : {}), ...(flags.ref ? { ref: flags.ref } : {}) });
      console.log(`Created ${created.name}. It builds and boots on first use, or now with: igor-computer wake ${created.name}`);
      break;
    }
    case 'status': console.log(JSON.stringify(await call(path(positional[0]) + '/status'), null, 2)); break;
    case 'rebuild': {
      const name = need(positional[0], 'computer name');
      console.error(`Rebuilding ${name}. This can take several minutes...`);
      console.log(JSON.stringify(await call(path(name) + '/rebuild', {}), null, 2));
      break;
    }
    case 'update': console.log((await call(path(need(positional[0], 'computer name')) + '/update', {})).output || 'Up to date.'); break;
    case 'sleep': case 'wake': {
      const name = need(positional[0], 'computer name');
      console.log(JSON.stringify(await call(path(name) + '/computer', { name: 'computer_' + command, arguments: {} }), null, 2));
      break;
    }
    case 'rm': case 'delete': {
      const name = need(positional[0], 'computer name');
      if (flags.yes !== true) {
        const prompt = createInterface({ input: process.stdin, output: process.stderr });
        const answer = await prompt.question(`This deletes computer ${name}, its VM, browser logins and /workspace. Type the name to confirm: `);
        prompt.close();
        if (answer.trim() !== name) { console.error('Not deleted.'); process.exit(1); }
      }
      await call(path(name) + '/', { confirm: name }, 'DELETE');
      console.log(`Deleted ${name}.`);
      break;
    }
    case 'viewer': console.log(serverUrl + path(positional[0]) + '/viewer'); break;
    case 'mcp': {
      if (positional[0]) process.env.IGOR_COMPUTER = positional[0];
      await import('./mcp.mjs');
      break;
    }
    case 'check': {
      const loaded = await loadDefinition(resolve(positional[0] || '.'));
      console.log(JSON.stringify({ file: loaded.file, ...loaded.definition }, null, 2));
      if (loaded.definition.ignored.length) console.error(`Note: igor.computer ignores ${loaded.definition.ignored.join(', ')}.`);
      break;
    }
    case 'init': {
      const folder = join(resolve(positional[0] || '.'), '.igor-computer');
      const file = join(folder, 'devcontainer.json');
      if (await stat(file).catch(() => null)) throw new Error(`${file} already exists.`);
      await mkdir(folder, { recursive: true });
      await writeFile(file, starter);
      console.log(`Wrote ${file}. Create a computer from it with: igor-computer create <name> ${resolve(positional[0] || '.')}`);
      break;
    }
    default: console.log(usage); process.exit(command && command !== 'help' ? 2 : 0);
  }
} catch (error) { console.error(error.message); process.exit(1); }
