// Regenerate the checked-in tool schemas from the pinned guest image.
// Run after a computer has built its base image; this never touches the live desktop.
// Usage: node scripts/catalog-computer-use.mjs [computer]
import { connectStdio } from '../src/mcp-clients.mjs';
import { writeFile } from 'node:fs/promises';
import { Registry, computerContext, defaultComputer } from '../src/computers.mjs';
import { desktopToolNames } from '../src/computer-use.mjs';
const name = process.argv[2] || defaultComputer;
const entry = (await new Registry().read())[name];
if (!entry) throw new Error(`Unknown computer ${name}.`);
const client = await connectStdio({ command: 'docker',
  args: ['run', '--rm', '-i', '--entrypoint', 'computer-use-linux', 'igor-computer-base', 'mcp'],
  env: computerContext(name, entry).env });
try {
  const { tools } = await client.listTools();
  const exposed = tools.filter(tool => desktopToolNames.has(tool.name));
  if (exposed.length !== desktopToolNames.size) throw new Error('Pinned desktop backend tool catalog changed.');
  await writeFile(new URL('../src/computer-use-tools.json', import.meta.url), JSON.stringify(exposed, null, 2) + '\n');
  console.log('Recorded ' + exposed.length + ' desktop tool schemas.');
} finally { await client.close(); }
