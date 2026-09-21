#!/usr/bin/env node
// entry point: the socket server on the loopback interface, the mcp server on stdio.
// stdout belongs to the mcp transport, so everything we say goes to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { appUrl, Bridge } from './server.js';
import { createMcpServer } from './mcp.js';
import { DEFAULT_PORT } from './protocol.js';
import { version } from './version.js';

const log = (message: string): void => {
  process.stderr.write(`[brainbridge] ${message}\n`);
};

const port = Number(process.env.BRAINBRIDGE_PORT ?? DEFAULT_PORT);
const origins = (process.env.BRAINBRIDGE_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const bridge = new Bridge({ port, version, origins, log });
try {
  await bridge.start();
} catch (error) {
  log(`could not listen on port ${port}: ${String(error)}. Set BRAINBRIDGE_PORT to use another one.`);
  process.exit(1);
}
log(`v${version} listening on http://127.0.0.1:${bridge.port}, open ${appUrl('brainotes', bridge.port)} and ${appUrl('texbrain', bridge.port)} to connect the tabs`);

const server = createMcpServer(bridge);
await server.connect(new StdioServerTransport());

const shutdown = (): void => {
  bridge.stop().finally(() => process.exit(0));
};
process.stdin.on('end', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
