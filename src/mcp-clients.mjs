import { createMCPClient } from '@tanstack/ai-mcp';
import { stdioTransport } from '@tanstack/ai-mcp/stdio';

// One stdio MCP connection (Chrome DevTools MCP, computer-use-linux, or a
// server inside a computer), through TanStack AI's MCP client.
export async function connectStdio({ command, args = [], env, onClose }) {
  const client = await createMCPClient({ transport: stdioTransport({ command, args, ...(env ? { env } : {}) }), onClose, requestOptions: { timeout: 120000 } });
  return {
    async listTools() {
      return { tools: (await client.tools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    },
    callTool(request, { timeout = 120000, signal } = {}) {
      const limit = AbortSignal.timeout(timeout);
      return client.callTool(request.name, request.arguments || {}, { signal: signal ? AbortSignal.any([signal, limit]) : limit });
    },
    close: () => client.close(),
  };
}
