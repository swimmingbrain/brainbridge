// the brainbridge command. without arguments it is the mcp server on stdio, the way
// the agents start it; stdout belongs to the mcp transport then, so logs go to stderr.
//
//   brainbridge                   the server, on port 7332 or BRAINBRIDGE_PORT
//   brainbridge --port 7400       the server on another port

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_PORT } from './protocol.js';
import { appUrl, Bridge } from './server.js';
import { createMcpServer } from './mcp.js';
import { version } from './version.js';

const USAGE = `brainbridge ${version}, connects braiNOTES and TeXbrain to your agent

  brainbridge                 run the mcp server on stdio (your agent starts it like this)
  brainbridge --port 7400     use another port than ${DEFAULT_PORT}, open the apps with ?bridge=7400 then
  brainbridge --version       print the version

BRAINBRIDGE_PORT sets the port too, BRAINBRIDGE_ORIGINS adds page origins that may connect (comma separated).
`;

export interface Args {
  command: 'serve' | 'help' | 'version';
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
  else await serve(args.port);
}
