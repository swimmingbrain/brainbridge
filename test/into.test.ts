import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Bridge } from '../src/server.js';
import { writeInto } from '../src/tools/notes.js';
import { startFakeApps } from './fake-app.js';

describe('a transcription into texbrain', () => {
  let bridge: Bridge;
  let apps: Awaited<ReturnType<typeof startFakeApps>>;
  const read = async (path: string) => (await bridge.call<{ text: string }>('texbrain', 'read', { path })).text;

  beforeAll(async () => {
    bridge = new Bridge({ port: 0, version: 'test' });
    await bridge.start();
    apps = await startFakeApps(bridge.port);
  });

  afterAll(async () => {
    await apps.close();
    await bridge.stop();
  });

  it('opens the project and goes before \\end{document}', async () => {
    const said = await writeInto(bridge, { project: 'analysis-script', file: 'main.tex' }, '\\section*{Page 2}');
    expect(said).toBe('added to main.tex of "analysis-script", before \\end{document}');
    expect((await bridge.call<{ project: { name: string } }>('texbrain', 'status')).project.name).toBe('analysis-script');
    expect(await read('main.tex')).toContain('from the lecture.\n\n\\section*{Page 2}\n\n\\end{document}\n');
  });

  it('makes a file that is not there yet', async () => {
    expect(await writeInto(bridge, { project: 'analysis-script', file: 'pages/two.tex' }, '$x$')).toMatch(/a new file/);
    expect(await read('pages/two.tex')).toBe('$x$\n');
  });

  it('adds at the end of a file without \\end{document}', async () => {
    await writeInto(bridge, { project: 'analysis-script', file: 'pages/two.tex' }, '$y$');
    expect(await read('pages/two.tex')).toBe('$x$\n\n$y$\n');
  });

  it('inserts at the cursor through the editor', async () => {
    const said = await writeInto(bridge, { project: 'analysis-script', file: 'pages/two.tex', at: 'cursor' }, '% here ');
    expect(said).toMatch(/at the cursor/);
    expect(apps.tex.calls.at(-1)).toMatchObject({ cmd: 'insert', args: { at: 'cursor', file: 'pages/two.tex' } });
  });
});
