// Regenerate the checked-in tool schemas from the pinned guest image.
// Run after scripts/build-browser.sh; this never touches the live desktop.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFile } from 'node:fs/promises';
import { runtimeEnv } from '../src/config.mjs';
import { desktopToolNames } from '../src/computer-use.mjs';
const client = new Client({ name: 'igor-computer-tool-catalog', version: '0.2.0' });
await client.connect(new StdioClientTransport({ command: 'docker',
  args: ['run', '--rm', '-i', '--entrypoint', 'computer-use-linux', 'igor-computer:0.2.0', 'mcp'],
  env: runtimeEnv, stderr: 'inherit' }));
try {
  const { tools } = await client.listTools();
  const exposed = tools.filter(tool => desktopToolNames.has(tool.name));
  if (exposed.length !== desktopToolNames.size) throw new Error('Pinned desktop backend tool catalog changed.');
  await writeFile(new URL('../src/computer-use-tools.json', import.meta.url), JSON.stringify(exposed, null, 2) + '\n');
  console.log('Recorded ' + exposed.length + ' desktop tool schemas.');
} finally { await client.close(); }
