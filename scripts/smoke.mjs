#!/usr/bin/env node
// drives a connected braiNOTES and TeXbrain tab through the built server, the way an
// agent would: a notebook page looked at, zoomed into and transcribed, the result
// written into a project and compiled, the pdf page looked at, the two linked and
// switched. open notes.swimmingbrain.dev/?bridge and tex.swimmingbrain.dev/editor?bridge first.
//
//   pnpm build && pnpm smoke [folder for the pictures and pdfs]
//
// BRAINBRIDGE_PORT picks the port, SMOKE_NOTEBOOK the notebook (the first one otherwise).

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? resolve(tmpdir(), 'brainbridge-smoke'));
await mkdir(outDir, { recursive: true });

const client = new Client({ name: 'brainbridge-smoke', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [resolve(here, '..', 'dist', 'index.js')],
    // the sdk passes only a few safe variables on, the port and the api key have to go along
    env: { ...process.env },
    stderr: 'inherit'
  })
);

let problems = 0;

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const texts = result.content.filter((c) => c.type === 'text').map((c) => c.text);
  if (result.isError) throw new Error(`${name} failed: ${texts.join(' ')}`);
  return { text: texts[0] ?? '', texts, json: safeJson(texts[0] ?? ''), image: result.content.find((c) => c.type === 'image') };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function show(name, result) {
  console.log(`\n== ${name}\n${result.texts.join('\n').slice(0, 1500)}`);
}

async function picture(name, result) {
  if (!result.image) return;
  const path = resolve(outDir, name);
  await writeFile(path, Buffer.from(result.image.data, 'base64'));
  console.log(`   picture written to ${path}`);
}

// a step that may fail without stopping the rest
async function step(name, run) {
  try {
    await run();
  } catch (error) {
    problems += 1;
    console.error(`\n!! ${name}: ${error.message}`);
  }
}

const { tools } = await client.listTools();
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);

let status = null;
for (let i = 0; i < 120; i++) {
  status = (await call('bridge_status')).json;
  if (status.apps.brainotes.connected && status.apps.texbrain.connected) break;
  if (i === 0) console.log(`\nwaiting for both tabs, open ${status.urls.brainotes} and ${status.urls.texbrain}`);
  await new Promise((done) => setTimeout(done, 1000));
}
if (!status.apps.brainotes.connected || !status.apps.texbrain.connected) {
  console.error('the tabs did not connect within two minutes, giving up');
  await client.close();
  process.exit(1);
}
show('bridge_status', { texts: [JSON.stringify(status, null, 2)] });

// ---- braiNOTES ---------------------------------------------------------------

const notebooks = (await call('notes_list')).json;
const notebook = notebooks.find((n) => n.name === process.env.SMOKE_NOTEBOOK) ?? notebooks.find((n) => n.kind === 'paper') ?? notebooks[0];
if (!notebook) {
  console.error('braiNOTES has no notebook, write a page first');
  await client.close();
  process.exit(1);
}
show('notes_open', await call('notes_open', { id: notebook.id }));
const pages = (await call('notes_pages')).json;
const page = pages.reduce((best, p) => (p.items > best.items ? p : best), pages[0]).index;
await call('notes_goto', { page });

const look = await call('notes_page', { page });
show('notes_page', look);
await picture('page.png', look);

const first = /(line|block)\s+([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)/.exec(look.text);
if (first) {
  await step('notes_region', async () => {
    const [x, y, w, h] = first.slice(2).map(Number);
    const zoom = await call('notes_region', { page, x, y, w, h });
    show('notes_region', zoom);
    await picture('region.png', zoom);
  });
}
await step('notes_strokes', async () => {
  const strokes = (await call('notes_strokes', { page })).json;
  console.log(`\n== notes_strokes\n${strokes.strokes.length} strokes, ${strokes.points} points${strokes.note ? `, ${strokes.note}` : ''}`);
});

let body = null;
await step('notes_transcribe', async () => {
  const read = await call('notes_transcribe', { page, format: 'latex' });
  show('notes_transcribe', read);
  if (!read.image) body = read.text;
});
// without a key this script stands in for the agent and writes what the layout says
body ??= [
  `\\section*{Page ${page} of ${notebook.name}}`,
  'The layout of this page:',
  '\\begin{verbatim}',
  ...look.text.split('\n').slice(1, 12),
  '\\end{verbatim}',
  '\\begin{align*}',
  'f(x) &= x^2 \\\\',
  "f'(x) &= 2x",
  '\\end{align*}'
].join('\n');
show('latex_check', await call('latex_check', { text: body }));

// ---- TeXbrain ----------------------------------------------------------------

const projects = (await call('tex_projects')).json;
const project = 'brainbridge-smoke';
if (projects.some((p) => p.name === project)) show('tex_open', await call('tex_open', { name: project }));
else show('tex_create', await call('tex_create', { name: project }));
show('tex_files', await call('tex_files'));
await call('tex_write', { path: 'page.tex', text: `${body}\n` });
const main = (await call('tex_read', { path: 'main.tex' })).text;
const lineOf = (text) => main.split('\n').findIndex((l) => l.includes(text)) + 1;
if (!main.includes('\\input{page}')) {
  const line = lineOf('\\end{document}');
  const at = line > 0 ? { line, col: 1 } : 'end';
  show('tex_insert', await call('tex_insert', { text: '\\input{page}\n', at, file: 'main.tex' }));
}
// align* needs amsmath, a new project may not have it
if (!main.includes('amsmath') && lineOf('\\begin{document}') > 0) {
  await call('tex_insert', { text: '\\usepackage{amsmath}\n', at: { line: lineOf('\\begin{document}'), col: 1 }, file: 'main.tex' });
}
show('tex_status', await call('tex_status'));

await step('tex_compile', async () => {
  let compiled = await call('tex_compile');
  show('tex_compile', compiled);
  // the first compile fetches packages and may outlast one call
  for (let i = 0; i < 20 && compiled.json?.state === 'compiling'; i++) {
    await new Promise((done) => setTimeout(done, 5000));
    compiled = await call('tex_compile_status');
  }
  show('tex_problems', await call('tex_problems'));
  if (compiled.json?.state !== 'ready') throw new Error(`the compile ended as ${compiled.json?.state}`);
  const pdfPage = await call('tex_pdf_page', { page: 1 });
  show('tex_pdf_page', pdfPage);
  await picture('pdf-page.png', pdfPage);
  show('tex_save_pdf', await call('tex_save_pdf', { path: resolve(outDir, 'smoke.pdf') }));
});

// ---- both ----------------------------------------------------------------------

await step('notes edits', async () => {
  const added = (await call('notes_new_page', { after: page })).json;
  show('notes_add_text', await call('notes_add_text', { page: added.index, x: 60, y: 80, text: 'written up in TeXbrain' }));
  show('notes_export_pdf', await call('notes_export_pdf', { path: resolve(outDir, 'notes.pdf'), pages: [page] }));
});
show('bridge_link', await call('bridge_link', { notebook: notebook.id, project }));
show('bridge_links', await call('bridge_links'));
show('bridge_switch to tex', await call('bridge_switch', { to: 'tex' }));
show('bridge_switch to notes', await call('bridge_switch', { to: 'notes' }));

await client.close();
console.log(problems ? `\nsmoke test finished with ${problems} problem${problems === 1 ? '' : 's'}` : '\nsmoke test passed');
process.exitCode = problems ? 1 : 0;
