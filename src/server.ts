// the socket server on the loopback interface. the brainotes and the texbrain tab
// connect to it and run the commands this server sends them, one tab per app.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  APPS,
  CLOSE_REPLACED,
  CLOSE_UNKNOWN_APP,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  type AppName,
  type CallMessage,
  type HelloMessage,
  type ServerMessage,
  type TabMessage
} from './protocol.js';

export const CALL_TIMEOUT = 30_000;

const DEFAULT_ORIGINS = ['https://notes.swimmingbrain.dev', 'https://tex.swimmingbrain.dev'];
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export const APP_TITLE: Record<AppName, string> = {
  brainotes: 'braiNOTES',
  texbrain: 'TeXbrain'
};

// the address that switches the bridge on in each app
export function appUrl(app: AppName, port = DEFAULT_PORT): string {
  const flag = port === DEFAULT_PORT ? 'bridge' : `bridge=${port}`;
  return app === 'brainotes' ? `https://notes.swimmingbrain.dev/?${flag}` : `https://tex.swimmingbrain.dev/editor?${flag}`;
}

export function howToConnect(app: AppName, port = DEFAULT_PORT): string {
  const flag = port === DEFAULT_PORT ? 'bridge' : `bridge=${port}`;
  const local = app === 'brainotes' ? `http://localhost:5173/?${flag}` : `http://localhost:5173/editor?${flag}`;
  const switchOn =
    app === 'brainotes'
      ? 'or switch Bridge on under Preferences, General'
      : 'or run "Bridge: connect" from the command palette';
  return (
    `No ${APP_TITLE[app]} tab is connected. Open ${appUrl(app, port)} (or ${local} when running ${app} locally), ${switchOn}. ` +
    'The tab connects to this server on its own and its status bar shows "Bridge" in green once it has. Then try again.'
  );
}

export class NotConnectedError extends Error {
  constructor(app: AppName, port?: number) {
    super(howToConnect(app, port));
    this.name = 'NotConnectedError';
  }
}

export interface BridgeOptions {
  port: number;
  host?: string;
  version: string;
  origins?: string[];
  log?: (message: string) => void;
}

export interface TabInfo {
  app: AppName;
  version: string;
  url: string;
  connectedAt: number;
}

interface Tab {
  socket: WebSocket;
  info: TabInfo;
  // the last data of every event the tab sent, by name
  events: Record<string, unknown>;
}

interface Pending {
  app: AppName;
  cmd: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class Bridge extends EventEmitter {
  readonly host: string;
  readonly version: string;
  private _port: number;
  private readonly origins: string[];
  private readonly log: (message: string) => void;
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly tabs = new Map<AppName, Tab>();
  private readonly pending = new Map<string, Pending>();

  constructor(options: BridgeOptions) {
    super();
    this._port = options.port;
    this.host = options.host ?? '127.0.0.1';
    this.version = options.version;
    this.origins = [...DEFAULT_ORIGINS, ...(options.origins ?? [])];
    this.log = options.log ?? (() => {});
    this.http = createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      if (!this.originAllowed(req.headers.origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws));
    });
  }

  get port(): number {
    return this._port;
  }

  connected(app: AppName): boolean {
    const tab = this.tabs.get(app);
    return tab !== undefined && tab.socket.readyState === WebSocket.OPEN;
  }

  info(app: AppName): TabInfo | null {
    return this.tabs.get(app)?.info ?? null;
  }

  lastEvent(app: AppName, name: string): unknown {
    return this.tabs.get(app)?.events[name];
  }

  async start(): Promise<void> {
    await new Promise<void>((done, fail) => {
      this.http.once('error', fail);
      this.http.listen(this._port, this.host, () => {
        this.http.off('error', fail);
        this._port = (this.http.address() as AddressInfo).port;
        done();
      });
    });
  }

  async stop(): Promise<void> {
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
    await new Promise<void>((done) => this.http.close(() => done()));
  }

  // ---- calls into a tab ----------------------------------------------------

  call<T = unknown>(app: AppName, cmd: string, args: Record<string, unknown> = {}, timeoutMs = CALL_TIMEOUT): Promise<T> {
    const tab = this.tabs.get(app);
    if (!tab || !this.connected(app)) return Promise.reject(new NotConnectedError(app, this._port));
    const id = randomUUID();
    const message: CallMessage = { type: 'call', id, cmd, args };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the ${app} tab did not answer "${cmd}" within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { app, cmd, resolve: resolve as (value: unknown) => void, reject, timer });
      this.send(tab.socket, message);
    });
  }

  // ---- websocket -----------------------------------------------------------

  private attach(ws: WebSocket): void {
    ws.on('message', (raw) => this.onMessage(ws, raw));
    ws.on('close', () => this.onClose(ws));
    ws.on('error', (error) => this.log(`socket error: ${String(error)}`));
  }

  private onClose(ws: WebSocket): void {
    for (const [app, tab] of this.tabs) {
      if (tab.socket !== ws) continue;
      this.tabs.delete(app);
      this.log(`${app} tab disconnected`);
      this.emit('disconnected', app);
      this.dropPending(app);
    }
  }

  private dropPending(app: AppName): void {
    for (const [id, p] of this.pending) {
      if (p.app !== app) continue;
      clearTimeout(p.timer);
      p.reject(new Error(`the ${app} tab disconnected while running "${p.cmd}"`));
      this.pending.delete(id);
    }
  }

  private onHello(ws: WebSocket, message: HelloMessage): void {
    if (!APPS.includes(message.app)) {
      this.log(`refused a tab that says it is "${String(message.app)}"`);
      ws.close(CLOSE_UNKNOWN_APP, 'unknown app');
      return;
    }
    const app = message.app;
    const old = this.tabs.get(app);
    if (old && old.socket !== ws) {
      // one tab per app: the new one takes over, the old one stops retrying
      this.tabs.delete(app);
      this.dropPending(app);
      this.send(old.socket, { type: 'replaced' });
      old.socket.close(CLOSE_REPLACED, 'another tab connected');
      this.log(`a new ${app} tab took over from the old one`);
    }
    const info: TabInfo = { app, version: String(message.version), url: String(message.url), connectedAt: Date.now() };
    this.tabs.set(app, { socket: ws, info, events: {} });
    this.send(ws, { type: 'welcome', protocol: PROTOCOL_VERSION, server: 'brainbridge', version: this.version });
    if (message.protocol !== PROTOCOL_VERSION) {
      this.log(`the ${app} tab speaks protocol ${message.protocol}, this server ${PROTOCOL_VERSION}, update the older one`);
    }
    this.log(`${app} tab connected: ${info.version} at ${info.url}`);
    this.emit('connected', info);
  }

  private onMessage(ws: WebSocket, raw: RawData): void {
    let message: TabMessage;
    try {
      message = JSON.parse(raw.toString()) as TabMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'hello':
        this.onHello(ws, message);
        break;
      case 'result': {
        const p = this.pending.get(message.id);
        if (!p) return;
        this.pending.delete(message.id);
        clearTimeout(p.timer);
        if (message.ok) p.resolve(message.result);
        else p.reject(new Error(message.error ?? `"${p.cmd}" failed in the ${p.app} tab`));
        break;
      }
      case 'event': {
        const tab = [...this.tabs.values()].find((t) => t.socket === ws);
        if (!tab) return;
        tab.events[message.name] = message.data;
        this.emit('event', tab.info.app, message.name, message.data);
        break;
      }
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  // ---- http ----------------------------------------------------------------

  private originAllowed(origin: string | undefined): boolean {
    // node clients and curl send no origin, pages always do
    if (!origin) return true;
    return this.origins.includes(origin) || LOCAL_ORIGIN.test(origin);
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (!this.originAllowed(req.headers.origin)) {
      json(res, 403, { error: 'origin not allowed' });
      return;
    }
    json(res, 404, { error: 'not found' });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
