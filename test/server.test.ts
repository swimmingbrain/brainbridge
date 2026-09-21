import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Bridge, NotConnectedError } from '../src/server.js';
import type { CallMessage, ServerMessage } from '../src/protocol.js';

interface FakeTab {
  ws: WebSocket;
  messages: ServerMessage[];
  closed: Promise<number>;
}

// a stand-in for an app tab: answers calls with an echo, fails on "boom" and never answers "slow"
function fakeTab(port: number, app: string, origin = 'http://localhost:5173'): Promise<FakeTab> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin } });
    const messages: ServerMessage[] = [];
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.once('error', fail);
    ws.once('unexpected-response', (_req, res) => fail(new Error(`status ${res.statusCode}`)));
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, app, version: 'test', url: `${origin}/` }));
    });
    ws.on('close', (code) => fail(new Error(`closed with ${code}`)));
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      messages.push(message);
      if (message.type === 'welcome') done({ ws, messages, closed });
      if (message.type !== 'call') return;
      const call = message as CallMessage;
      if (call.cmd === 'boom') {
        ws.send(JSON.stringify({ type: 'result', id: call.id, ok: false, error: 'it broke' }));
      } else if (call.cmd !== 'slow') {
        ws.send(JSON.stringify({ type: 'result', id: call.id, ok: true, result: { app, cmd: call.cmd, args: call.args } }));
      }
    });
  });
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('bridge', () => {
  let bridge: Bridge;

  beforeAll(async () => {
    bridge = new Bridge({ port: 0, version: 'test' });
    await bridge.start();
  });

  afterAll(async () => {
    await bridge.stop();
  });

  it('rejects calls while an app is not connected and says how to connect', async () => {
    expect(bridge.connected('brainotes')).toBe(false);
    await expect(bridge.call('brainotes', 'status')).rejects.toBeInstanceOf(NotConnectedError);
    await expect(bridge.call('texbrain', 'status')).rejects.toThrow(/tex\.swimmingbrain\.dev\/editor\?bridge/);
  });

  it('refuses a websocket from a foreign origin', async () => {
    await expect(fakeTab(bridge.port, 'brainotes', 'https://evil.example')).rejects.toThrow(/403/);
  });

  it('closes a tab that is not one of the two apps', async () => {
    await expect(fakeTab(bridge.port, 'braincut')).rejects.toThrow(/4001/);
  });

  it('routes calls to the right app and answers errors and timeouts', async () => {
    const notes = await fakeTab(bridge.port, 'brainotes', 'https://notes.swimmingbrain.dev');
    const tex = await fakeTab(bridge.port, 'texbrain');
    expect(notes.messages[0]).toMatchObject({ type: 'welcome', protocol: 1, server: 'brainbridge', version: 'test' });
    expect(bridge.info('brainotes')?.url).toBe('https://notes.swimmingbrain.dev/');
    expect(await bridge.call('brainotes', 'pages', { a: 1 })).toEqual({ app: 'brainotes', cmd: 'pages', args: { a: 1 } });
    expect(await bridge.call('texbrain', 'files')).toEqual({ app: 'texbrain', cmd: 'files', args: {} });
    await expect(bridge.call('texbrain', 'boom')).rejects.toThrow('it broke');
    await expect(bridge.call('brainotes', 'slow', {}, 50)).rejects.toThrow(/did not answer "slow"/);
    notes.ws.close();
    tex.ws.close();
    await wait(50);
    expect(bridge.connected('brainotes')).toBe(false);
    expect(bridge.connected('texbrain')).toBe(false);
  });

  it('lets a second tab of the same app take over, the other app stays', async () => {
    const first = await fakeTab(bridge.port, 'brainotes');
    const tex = await fakeTab(bridge.port, 'texbrain');
    const pending = bridge.call('brainotes', 'slow', {}, 5000).then(() => 'answered', (error: Error) => error.message);
    const second = await fakeTab(bridge.port, 'brainotes');
    expect(await first.closed).toBe(4000);
    expect(first.messages.some((m) => m.type === 'replaced')).toBe(true);
    expect(await pending).toMatch(/disconnected while running "slow"/);
    expect(bridge.connected('brainotes')).toBe(true);
    expect(bridge.connected('texbrain')).toBe(true);
    expect(await bridge.call('brainotes', 'status')).toMatchObject({ app: 'brainotes' });
    second.ws.close();
    tex.ws.close();
    await wait(50);
  });

  it('keeps the last event of each kind', async () => {
    const tex = await fakeTab(bridge.port, 'texbrain');
    tex.ws.send(JSON.stringify({ type: 'event', name: 'compile', data: { state: 'compiling' } }));
    tex.ws.send(JSON.stringify({ type: 'event', name: 'compile', data: { state: 'ready' } }));
    await wait(50);
    expect(bridge.lastEvent('texbrain', 'compile')).toEqual({ state: 'ready' });
    tex.ws.close();
    await wait(50);
  });

  it('answers preflights and the health check, 403 for a foreign origin', async () => {
    const preflight = await fetch(`http://127.0.0.1:${bridge.port}/health`, {
      method: 'OPTIONS',
      headers: { origin: 'https://tex.swimmingbrain.dev' }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
    const health = await (await fetch(`http://127.0.0.1:${bridge.port}/health`)).json();
    expect(health).toMatchObject({ ok: true, server: 'brainbridge', apps: { brainotes: null, texbrain: null } });
    const page = await fetch(`http://127.0.0.1:${bridge.port}/`);
    expect(await page.text()).toContain('notes.swimmingbrain.dev/?bridge');
    const foreign = await fetch(`http://127.0.0.1:${bridge.port}/health`, { headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
  });
});
