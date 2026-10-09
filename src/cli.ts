// the brainbridge command. without arguments it is the mcp server on stdio, the way
// the agents start it; stdout belongs to the mcp transport then, so logs go to stderr.
//
//   brainbridge                   the server, on port 7332 or BRAINBRIDGE_PORT
//   brainbridge --port 7400       the server on another port
//   brainbridge status            which apps are connected to the running server, then exit

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_PORT, type AppName } from './protocol.js';
import { APPS, appUrl, Bridge, type TabInfo } from './server.js';
import { createMcpServer } from './mcp.js';
import { followSwitches } from './follow.js';
import { version } from './version.js';

const USAGE = `brainbridge ${version}, connects braiNOTES and TeXbrain to your agent

  brainbridge                 run the mcp server on stdio (your agent starts it like this)
  brainbridge --port 7400     use another port than ${DEFAULT_PORT}, open the apps with ?bridge=7400 then
  brainbridge status          say which apps are connected to the running server
  brainbridge --version       print the version

BRAINBRIDGE_PORT sets the port too, BRAINBRIDGE_ORIGINS adds page origins that may connect (comma separated).
`;

export interface Args {
  command: 'serve' | 'status' | 'help' | 'version';
  port: number;
}

function toPort(value: string | undefined, from: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${from} needs a port from 1 to 65535, not "${value ?? ''}"`);
  return port;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Args {
  let command: Args['command'] = 'serve';
  let port = env.BRAINBRIDGE_PORT ? toPort(env.BRAINBRIDGE_PORT, 'BRAINBRIDGE_PORT') : DEFAULT_PORT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') port = toPort(argv[++i], arg);
    else if (arg.startsWith('--port=')) port = toPort(arg.slice(7), '--port');
    else if (arg === 'status') command = 'status';
    else if (arg === '--help' || arg === '-h' || arg === 'help') command = 'help';
    else if (arg === '--version' || arg === '-v') command = 'version';
    else throw new Error(`unknown argument "${arg}", see brainbridge --help`);
  }
  return { command, port };
}

const log = (message: string): void => {
  process.stderr.write(`[brainbridge] ${message}\n`);
};

async function serve(port: number): Promise<void> {
  const origins = (process.env.BRAINBRIDGE_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bridge = new Bridge({ port, version, origins, log });
  followSwitches(bridge, log);
  try {
    await bridge.start();
  } catch (error) {
    log(`could not listen on port ${port}: ${String(error)}. Is brainbridge running already? Pass --port or set BRAINBRIDGE_PORT to use another one.`);
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
}

async function status(port: number): Promise<number> {
  let health: { version: string; apps: Record<AppName, TabInfo | null> };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    health = (await response.json()) as typeof health;
  } catch {
    console.log(`Nothing answers on port ${port}, so brainbridge is not running there. Your agent starts it when it starts.`);
    return 1;
  }
  console.log(`brainbridge ${health.version} runs on port ${port}`);
  for (const app of APPS) {
    const tab = health.apps[app];
    console.log(`  ${app.padEnd(10)} ${tab ? `connected, ${tab.url}` : `not connected, open ${appUrl(app, port)}`}`);
  }
  return 0;
}

export async function main(argv: string[]): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  if (args.command === 'help') process.stdout.write(USAGE);
  else if (args.command === 'version') console.log(version);
  else if (args.command === 'status') process.exitCode = await status(args.port);
  else await serve(args.port);
}
