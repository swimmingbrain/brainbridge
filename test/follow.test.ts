import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Bridge } from '../src/server.js';
import { followSwitches } from '../src/follow.js';
import { startFakeApps } from './fake-app.js';

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('the open in buttons of the apps', () => {
  let bridge: Bridge;
  let apps: Awaited<ReturnType<typeof startFakeApps>>;

  beforeAll(async () => {
    bridge = new Bridge({ port: 0, version: 'test' });
    followSwitches(bridge);
    await bridge.start();
    apps = await startFakeApps(bridge.port);
  });

  afterAll(async () => {
    await apps.close();
    await bridge.stop();
  });

  it('opens the project in the texbrain tab when braiNOTES switches to it', async () => {
    apps.notes.events('switch', { to: 'tex', project: 'analysis-script' });
    await wait(100);
    expect(apps.tex.calls.at(-1)).toMatchObject({ cmd: 'open', args: { name: 'analysis-script' } });
    expect((await bridge.call<{ project: { name: string } }>('texbrain', 'status')).project.name).toBe('analysis-script');
  });

  it('opens the notebook in the braiNOTES tab when TeXbrain switches to it', async () => {
    apps.tex.events('switch', { to: 'notes', notebook: 'nb-analysis' });
    await wait(100);
    expect(apps.notes.calls.at(-1)).toMatchObject({ cmd: 'open', args: { id: 'nb-analysis' } });
  });

  it('leaves other events alone', async () => {
    const before = apps.tex.calls.length;
    apps.notes.events('document', { notebook: null });
    apps.notes.events('switch', { to: 'notes', notebook: 'x' });
    await wait(100);
    expect(apps.tex.calls.length).toBe(before);
  });
});
