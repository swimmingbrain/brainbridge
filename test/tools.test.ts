// the whole server through the mcp sdk's stdio client, the way an agent starts it,
// with the fake braiNOTES and TeXbrain tabs on the other side. every tool is called.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { pngSize } from '../src/png.js';
import { startFakeApps } from './fake-app.js';
import { encodePng } from './png.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const TOOLS = [
  'bridge_status', 'bridge_link', 'bridge_links', 'bridge_switch',
  'notes_list', 'notes_open', 'notes_create', 'notes_pages', 'notes_goto', 'notes_new_page', 'notes_add_text',
  'notes_add_image', 'notes_export_pdf', 'notes_page', 'notes_region', 'notes_strokes', 'notes_transcribe',
  'latex_check',
  'tex_status', 'tex_projects', 'tex_open', 'tex_create', 'tex_files', 'tex_read', 'tex_write', 'tex_insert',
  'tex_compile', 'tex_compile_status', 'tex_problems', 'tex_pdf_page', 'tex_save_pdf'
];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

interface Answer {
  isError: boolean;
  text: string;
  texts: string[];
  json: any;
  image?: { data: string; mimeType: string };
}

describe('brainbridge over stdio', () => {
  let client: Client;
  let dir: string;
  let port: number;
  let apps: Awaited<ReturnType<typeof startFakeApps>> | null = null;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<Answer> {
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: any[] };
    const texts = result.content.filter((c) => c.type === 'text').map((c) => c.text as string);
    let json: any = null;
    try {
      json = JSON.parse(texts[0]);
    } catch {
      json = null;
    }
    return { isError: result.isError === true, text: texts[0] ?? '', texts, json, image: result.content.find((c) => c.type === 'image') };
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'brainbridge-e2e-'));
    port = await freePort();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    delete env.ANTHROPIC_API_KEY;
    // the links file goes to the temp folder, not the real config folder
    env.APPDATA = dir;
    env.XDG_CONFIG_HOME = dir;
    client = new Client({ name: 'brainbridge-test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', join(root, 'src', 'index.ts'), '--port', String(port)],
        cwd: root,
        env,
        stderr: 'pipe'
      })
    );
  }, 30_000);

  afterAll(async () => {
    await apps?.close();
    await client?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('lists every tool and the transcribe prompt', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const tool of tools) expect(tool.description!.length).toBeLessThan(2048);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['transcribe']);
    const prompt = await client.getPrompt({ name: 'transcribe', arguments: { format: 'markdown' } });
    const message = prompt.messages[0].content as { type: string; text: string };
    expect(message.text).toContain('exactly as it is written');
    expect(message.text).toContain('$$...$$');
  });

  it('says how to connect while no tab is there', async () => {
    const status = await call('bridge_status');
    expect(status.json.apps.brainotes.connected).toBe(false);
    expect(status.json.apps.texbrain.howToConnect).toContain(`tex.swimmingbrain.dev/editor?bridge=${port}`);
    expect(status.json.urls.brainotes).toBe(`https://notes.swimmingbrain.dev/?bridge=${port}`);
    const list = await call('notes_list');
    expect(list.isError).toBe(true);
    expect(list.text).toMatch(/No braiNOTES tab is connected/);
    const files = await call('tex_files');
    expect(files.isError).toBe(true);
    expect(files.text).toMatch(/run "Bridge: connect" from the command palette/);
    expect((await call('latex_check', { text: '$x^2$' })).text).toBe('ok');
  });

  it('sees both fake tabs once they connect', async () => {
    apps = await startFakeApps(port);
    const status = await call('bridge_status');
    expect(status.json.apps.brainotes).toMatchObject({ connected: true, status: { notebook: null } });
    expect(status.json.apps.texbrain).toMatchObject({ connected: true, status: { project: { name: 'thesis' } } });
  });

  it('lists, opens and creates notebooks', async () => {
    const list = await call('notes_list');
    expect(list.json.map((n: any) => n.name)).toEqual(['Analysis 2', 'Ideas']);
    expect((await call('notes_open')).text).toMatch(/Give the id or the name/);
    expect((await call('notes_create', { name: 'Physics' })).json.notebook).toMatchObject({ name: 'Physics', kind: 'paper', pages: 1 });
    const open = await call('notes_open', { name: 'Analysis 2' });
    expect(open.json.notebook).toMatchObject({ id: 'nb-analysis', pages: 3 });
    expect((await call('notes_open', { id: 'nope' })).isError).toBe(true);
  });

  it('walks the pages', async () => {
    const pages = await call('notes_pages');
    expect(pages.json).toHaveLength(3);
    expect(pages.json[0]).toMatchObject({ index: 0, w: 595, h: 842, pdf: true });
    expect((await call('notes_goto', { page: 1 })).isError).toBe(false);
    expect((await call('notes_goto', { page: -1 })).isError).toBe(true);
    expect((await call('notes_new_page', { after: 0 })).json).toEqual({ index: 1 });
    expect((await call('notes_pages')).json).toHaveLength(4);
  });

  it('shows a page with its layout, small enough for the client', async () => {
    const page = await call('notes_page', { page: 2 });
    expect(page.isError).toBe(false);
    expect(page.image?.mimeType).toBe('image/png');
    const size = pngSize(page.image!.data)!;
    expect(size).toEqual({ width: 1190, height: 1684 });
    expect(page.text).toContain('page 2 of "Analysis 2", 595 x 842 page units');
    expect(page.text).toContain('block    69.9, 189.9, 259, 114.4  3 lines, 82 strokes');
    expect(page.text).toMatch(/drawing\s+329\.8, 43\d/);
    expect(page.text).toContain('a picture, id i1');
    const big = await call('notes_page', { page: 2, scale: 4 });
    expect(Math.max(...Object.values(pngSize(big.image!.data)!))).toBeLessThanOrEqual(2000);
    const first = await call('notes_page', { notebook: 'nb-analysis', page: 0 });
    expect(first.text).toContain('on a PDF page');
    expect(first.text).toContain('typed: "Lecture 4, chain rule"');
    expect(first.text).toContain('no handwriting on this page');
    expect((await call('notes_page', { page: 9 })).text).toMatch(/There is no page 9\. The notebook has 4 pages/);
  });

  it('zooms into a region and gives the raw strokes', async () => {
    const region = await call('notes_region', { page: 2, x: 60, y: 180, w: 280, h: 130 });
    expect(pngSize(region.image!.data)).toEqual({ width: 1120, height: 520 });
    expect(region.text).toContain('at scale 4');
    const strokes = await call('notes_strokes', { page: 2 });
    expect(strokes.json.strokes.length).toBeGreaterThan(300);
    expect(strokes.json.points).toBeGreaterThan(3000);
    expect(strokes.json.note).toBeUndefined();
    expect(strokes.json.strokes[0]).toHaveProperty('points');
  });

  it('hands the page and the instructions over when there is no key', async () => {
    const result = await call('notes_transcribe', { page: 2, format: 'latex', into: { project: 'analysis-script', file: 'main.tex' } });
    expect(result.isError).toBe(false);
    expect(result.image?.mimeType).toBe('image/png');
    expect(result.text).toMatch(/^No ANTHROPIC_API_KEY is set for brainbridge, so transcribe this page yourself/);
    expect(result.text).toContain('layout from');
    expect(result.text).toContain('\\includegraphics{drawing-1}');
    expect(result.text).toContain('main.tex of the TeXbrain project "analysis-script"');
  });

  it('checks latex', async () => {
    expect((await call('latex_check', { text: 'so $\\frac{a}{b}$ and \\[ x \\]' })).text).toBe('ok');
    const bad = await call('latex_check', { text: 'line one\n$\\frac{1}{$' });
    expect(bad.json[0]).toMatchObject({ line: 2, math: '\\frac{1}{' });
  });

  it('adds text, pictures and exports a pdf', async () => {
    expect((await call('notes_add_text', { page: 3, x: 50, y: 60, text: 'Summary', size: 16 })).json.id).toMatch(/^t/);
    const png = encodePng(4, 2, new Uint8Array(8).fill(0));
    const file = join(dir, 'dot.png');
    await writeFile(file, png);
    expect((await call('notes_add_image', { page: 3, x: 50, y: 100, w: 40, path: file })).json.id).toMatch(/^i/);
    expect((await call('notes_add_image', { page: 3, x: 50, y: 200, png: png.toString('base64') })).isError).toBe(false);
    await writeFile(join(dir, 'notes.txt'), 'not a picture at all, just some text');
    expect((await call('notes_add_image', { page: 3, x: 0, y: 0, path: join(dir, 'notes.txt') })).text).toMatch(/not a PNG/);
    expect((await call('notes_add_image', { page: 3, x: 0, y: 0 })).isError).toBe(true);
    const target = join(dir, 'out', 'analysis.pdf');
    const exported = await call('notes_export_pdf', { path: target, pages: [0, 2] });
    expect(exported.json.path).toBe(target);
    expect((await readFile(target, 'latin1')).startsWith('%PDF-1.4')).toBe(true);
  });

  it('opens a project, reads and writes its files', async () => {
    expect((await call('tex_status')).json.project.name).toBe('thesis');
    expect((await call('tex_projects')).json.map((p: any) => p.name)).toEqual(['analysis-script', 'thesis']);
    expect((await call('tex_open', { name: 'nope' })).isError).toBe(true);
    expect((await call('tex_create', { name: 'scratch' })).json.project.name).toBe('scratch');
    expect((await call('tex_open', { name: 'analysis-script' })).json.project.name).toBe('analysis-script');
    expect((await call('tex_files')).json.map((f: any) => f.path)).toEqual(['main.tex', 'refs.bib']);
    expect((await call('tex_read', { path: 'main.tex' })).text).toMatch(/^\\documentclass\{article\}/);
    expect((await call('tex_read', { path: '../secret.txt' })).text).toMatch(/not inside the project/);
    expect((await call('tex_read', { path: 'C:\\Windows\\win.ini' })).isError).toBe(true);
    expect((await call('tex_write', { path: 'chapters/one.tex', text: '\\section{One}\n' })).json.created).toBe(true);
    const inserted = await call('tex_insert', { text: '% the end\n', at: 'end', file: 'chapters/one.tex' });
    expect(inserted.json.file).toBe('chapters/one.tex');
    expect((await call('tex_read', { path: 'chapters/one.tex' })).text).toBe('\\section{One}\n% the end\n');
    const body = '\\begin{align*}\nf(x) &= x^2 \\\\\n&= x \\cdot x\n\\end{align*}\n';
    expect((await call('latex_check', { text: body })).text).toBe('ok');
    await call('tex_insert', { text: body, at: { line: 8, col: 1 }, file: 'main.tex' });
    expect((await call('tex_read', { path: 'main.tex' })).text).toContain(`lecture.\n${body}\\end{document}`);
  });

  it('compiles, waits for it and shows the pdf', async () => {
    expect((await call('tex_problems')).text).toMatch(/Nothing was compiled yet/);
    const compiled = await call('tex_compile');
    expect(compiled.json.state).toBe('ready');
    expect(compiled.json.log).toContain('Output written on main.pdf');
    expect((await call('tex_compile_status')).json.state).toBe('ready');
    expect((await call('tex_problems')).text).toBe('No problems in the last compile.');
    const page = await call('tex_pdf_page', { page: 1 });
    expect(pngSize(page.image!.data)).toEqual({ width: 1224, height: 1584 });
    expect(page.texts[0]).toContain('page 1 of 1');
    const sharp = await call('tex_pdf_page', { page: 1, scale: 4 });
    expect(Math.max(...Object.values(pngSize(sharp.image!.data)!))).toBeLessThanOrEqual(2000);
    expect((await call('tex_pdf_page', { page: 2 })).isError).toBe(true);
    const target = join(dir, 'out', 'script.pdf');
    expect((await call('tex_save_pdf', { path: target })).json.bytes).toBeGreaterThan(100);
    expect((await readFile(target, 'latin1')).startsWith('%PDF')).toBe(true);
  });

  it('reports the problems of a broken compile', async () => {
    const main = (await call('tex_read', { path: 'main.tex' })).text;
    await call('tex_write', { path: 'main.tex', text: main.replace('\\maketitle', '\\maketitle\n\\oops') });
    const compiled = await call('tex_compile');
    expect(compiled.json.state).toBe('error');
    expect((await call('tex_problems')).text).toBe('main.tex:6: error: Undefined control sequence \\oops');
    await call('tex_write', { path: 'main.tex', text: main });
  });

  it('links the notebook and the project and switches between them', async () => {
    const linked = await call('bridge_link', { notebook: 'analysis 2', project: 'analysis-script' });
    expect(linked.json).toMatchObject({ notebook: { id: 'nb-analysis', name: 'Analysis 2' }, project: 'analysis-script' });
    expect(linked.json.brainotes).toMatch(/links to the project/);
    expect(linked.json.texbrain).toMatch(/links to the notebook/);
    expect(linked.json.savedIn.startsWith(dir)).toBe(true);
    const saved = JSON.parse(await readFile(linked.json.savedIn, 'utf8'));
    expect(saved.links[0]).toMatchObject({ notebook: 'nb-analysis', project: 'analysis-script' });
    expect((await call('notes_list')).json[0].tex).toBe('analysis-script');
    expect((await call('bridge_links')).json.links).toHaveLength(1);

    await call('tex_open', { name: 'thesis' });
    const toTex = await call('bridge_switch', { to: 'tex' });
    expect(toTex.json).toMatchObject({ opened: true, project: 'analysis-script' });
    expect(toTex.json.url).toBe(`https://tex.swimmingbrain.dev/editor?project=analysis-script&bridge=${port}`);
    expect((await call('tex_status')).json.project.name).toBe('analysis-script');
    await call('notes_open', { name: 'Ideas' });
    const toNotes = await call('bridge_switch', { to: 'notes' });
    expect(toNotes.json).toMatchObject({ opened: true, notebook: { id: 'nb-analysis' } });
    expect(toNotes.json.url).toBe(`https://notes.swimmingbrain.dev/?notebook=nb-analysis&bridge=${port}`);
    await call('notes_open', { name: 'Ideas' });
    expect((await call('bridge_switch', { to: 'tex' })).text).toMatch(/"Ideas" is not linked/);
  });

  it('gives the address to open when the other app is gone', async () => {
    await apps!.notes.close();
    await new Promise((done) => setTimeout(done, 100));
    const switched = await call('bridge_switch', { to: 'notes' });
    expect(switched.json).toMatchObject({ opened: false, url: `https://notes.swimmingbrain.dev/?notebook=nb-analysis&bridge=${port}` });
    expect((await call('notes_pages')).text).toMatch(/No braiNOTES tab is connected/);
    expect((await call('bridge_status')).json.apps.brainotes.connected).toBe(false);
  });
}, 60_000);
