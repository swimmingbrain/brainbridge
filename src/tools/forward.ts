import type { ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppName } from '../protocol.js';
import type { Bridge } from '../server.js';
import { fail, text } from './result.js';

export interface Forward {
  name: string;
  title: string;
  description: string;
  shape: ZodRawShape;
}

// registers a tool that sends its arguments to one app's command unchanged
// and answers with what the tab returns
export function forward(server: McpServer, bridge: Bridge, app: AppName, cmd: string, tool: Forward): void {
  server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.shape }, async (args) => {
    try {
      return text(await bridge.call(app, cmd, args as Record<string, unknown>));
    } catch (error) {
      return fail(error);
    }
  });
}
