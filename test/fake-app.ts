// stand-ins for the braiNOTES and the TeXbrain tab. they speak the socket protocol and
// answer every command the real apps know, with made up but realistic data: notebooks
// with a page of handwriting, a LaTeX project with a main.tex that compiles.
//
// run it on its own against a running server to try the tools by hand:
//   node --import tsx test/fake-app.ts [port]

import WebSocket from 'ws';
import type { CallMessage, ServerMessage } from '../src/protocol.js';
import { fakePage, type FakeStroke } from './handwriting.js';
import { renderStrokes, type Region } from './png.js';

type Handler = (args: Record<string, any>) => unknown | Promise<unknown>;

export interface FakeTab {
  calls: CallMessage[];
  events: (name: string, data: unknown) => void;
  close: () => Promise<void>;
}

function connect(port: number, app: string, handlers: Record<string, Handler>): Promise<FakeTab> {
  const origin = app === 'brainotes' ? 'https://notes.swimmingbrain.dev' : 'https://tex.swimmingbrain.dev';
  return new Promise((done, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin } });
    const calls: CallMessage[] = [];
    const tab: FakeTab = {
      calls,
      events: (name, data) => ws.send(JSON.stringify({ type: 'event', name, data })),
      close: () =>
        new Promise((closed) => {
          if (ws.readyState === WebSocket.CLOSED) return closed();
          ws.once('close', () => closed());
          ws.close();
        })
    };
    ws.once('error', fail);
    ws.once('open', () => {
      const url = app === 'brainotes' ? `${origin}/?bridge=${port}` : `${origin}/editor?bridge=${port}`;
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, app, version: 'fake-1.0.0', url }));
    });
    ws.on('message', async (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.type === 'welcome') done(tab);
      if (message.type !== 'call') return;
      calls.push(message);
      const handler = handlers[message.cmd];
      try {
        if (!handler) throw new Error('unknown command');
        const result = await handler(message.args ?? {});
        ws.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result }));
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        ws.send(JSON.stringify({ type: 'result', id: message.id, ok: false, error: text }));
      }
    });
  });
}

// ---- braiNOTES ---------------------------------------------------------------

interface Page {
  id: string;
  w: number;
  h: number;
  pdf: boolean;
  strokes: FakeStroke[];
  texts: { id: string; x: number; y: number; w: number; text: string; size: number; color: string }[];
  images: { id: string; x: number; y: number; w: number; h: number }[];
}

interface Notebook {
  id: string;
  name: string;
  kind: 'paper' | 'board';
  updatedAt: number;
  tex: string | null;
  pages: Page[];
}

function emptyPage(id: string, kind: 'paper' | 'board' = 'paper'): Page {
  const size = kind === 'board' ? { w: 4000, h: 3000 } : { w: 595, h: 842 };
  return { id, ...size, pdf: false, strokes: [], texts: [], images: [] };
}

export function brainotesHandlers(): Record<string, Handler> {
  const written = fakePage();
  const notebooks: Notebook[] = [
    {
      id: 'nb-analysis',
      name: 'Analysis 2',
      kind: 'paper',
      updatedAt: Date.parse('2026-09-30T10:00:00Z'),
      tex: null,
      pages: [
        { ...emptyPage('p1'), pdf: true, texts: [{ id: 't1', x: 50, y: 40, w: 300, text: 'Lecture 4, chain rule', size: 14, color: '#1c1c1c' }] },
        { ...emptyPage('p2'), strokes: written.strokes, images: [{ id: 'i1', x: 60, y: 700, w: 120, h: 80 }] },
        emptyPage('p3')
      ]
    },
    { id: 'nb-ideas', name: 'Ideas', kind: 'board', updatedAt: Date.parse('2026-09-12T18:00:00Z'), tex: null, pages: [emptyPage('b1', 'board')] }
  ];
  let open: Notebook | null = null;
  let current = 0;
  let next = 1;

  const book = (): Notebook => {
    if (!open) throw new Error('No notebook is open. Open one with open or create one first.');
    return open;
  };
  const pageOf = (index: unknown): Page => {
    const pages = book().pages;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= pages.length) {
      throw new Error(`There is no page ${String(index)}, the notebook has ${pages.length} pages.`);
    }
    return pages[index];
  };
  const status = () => ({
    notebook: open ? { id: open.id, name: open.name, kind: open.kind, pages: open.pages.length } : null,
    page: current,
    tool: 'pen',
    zoom: 1,
    version: 'fake-1.0.0'
  });
  const touch = () => {
    book().updatedAt = Date.now();
  };

  return {
    status,
    notebooks: () =>
      notebooks.map((n) => ({ id: n.id, name: n.name, kind: n.kind, pages: n.pages.length, updatedAt: n.updatedAt, tex: n.tex })),
    open: ({ id, name }) => {
      const found = notebooks.find((n) => n.id === id) ?? notebooks.find((n) => n.name === name);
      if (!found) throw new Error(`There is no notebook ${JSON.stringify(id ?? name)}.`);
      open = found;
      current = 0;
      return status();
    },
    create: ({ name, kind }) => {
      if (!name) throw new Error('A notebook needs a name.');
      const created: Notebook = { id: `nb-${next++}`, name, kind: kind === 'board' ? 'board' : 'paper', updatedAt: Date.now(), tex: null, pages: [] };
      created.pages.push(emptyPage(`${created.id}-p1`, created.kind));
      notebooks.push(created);
      open = created;
      current = 0;
      return status();
    },
    pages: () =>
      book().pages.map((p, index) => ({ index, id: p.id, w: p.w, h: p.h, items: p.strokes.length + p.texts.length + p.images.length, pdf: p.pdf })),
    goto: ({ page }) => {
      pageOf(page);
      current = page;
      return { page, summary: `page ${page + 1}` };
    },
    page_image: ({ page, scale, region }) => {
      const p = pageOf(page);
      const s = Math.min(4, Math.max(0.5, Number(scale ?? 2)));
      const bars: Region[] = p.texts.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.size }));
      for (const image of p.images) bars.push(image);
      return renderStrokes(p, p.strokes, s, region, bars);
    },
    page_strokes: ({ page }) => {
      const p = pageOf(page);
      return { w: p.w, h: p.h, strokes: p.strokes, texts: p.texts, shapes: [], images: p.images };
    },
    add_text: ({ page, x, y, text, size, color }) => {
      const p = pageOf(page);
      const id = `t${next++}`;
      p.texts.push({ id, x, y, w: String(text).length * (size ?? 12) * 0.5, text, size: size ?? 12, color: color ?? '#1c1c1c' });
      touch();
      return { id, summary: 'text added' };
    },
    add_image: ({ page, x, y, w, png }) => {
      const p = pageOf(page);
      if (typeof png !== 'string' || !png) throw new Error('add_image needs a png.');
      const header = Buffer.from(png.slice(0, 48), 'base64');
      const ratio = header.readUInt32BE(20) / header.readUInt32BE(16);
      const width = w ?? header.readUInt32BE(16) / 2;
      const id = `i${next++}`;
      p.images.push({ id, x, y, w: width, h: width * ratio });
      touch();
      return { id, summary: 'image added' };
    },
    new_page: ({ after }) => {
      const pages = book().pages;
      const index = after === undefined ? pages.length : (pageOf(after), after + 1);
      pages.splice(index, 0, emptyPage(`p${next++}`, book().kind));
      touch();
      return { index };
    },
    link: ({ tex }) => {
      book().tex = tex ?? null;
      return { notebook: book().id, tex: book().tex };
    },
    export_pdf: ({ pages }) => {
      const count = Array.isArray(pages) ? pages.length : book().pages.length;
      if (Array.isArray(pages)) pages.forEach((p: unknown) => pageOf(p));
      return { pdf: Buffer.from(fakePdf(count)).toString('base64') };
    }
  };
}

// ---- TeXbrain ----------------------------------------------------------------

interface Project {
  name: string;
  updatedAt: number;
  notes: string | null;
  files: Map<string, string>;
}

const MAIN_TEX = `\\documentclass{article}
\\usepackage{amsmath}
\\title{Analysis 2}
\\begin{document}
\\maketitle
\\section{Introduction}
These are my notes from the lecture.
\\end{document}
`;

export function texbrainHandlers(onEvent: (name: string, data: unknown) => void = () => {}): Record<string, Handler> {
  const projects: Project[] = [
    { name: 'analysis-script', updatedAt: Date.parse('2026-09-29T20:00:00Z'), notes: null, files: new Map([['main.tex', MAIN_TEX], ['refs.bib', '']]) },
    { name: 'thesis', updatedAt: Date.parse('2026-09-01T09:00:00Z'), notes: null, files: new Map([['main.tex', MAIN_TEX.replace('Analysis 2', 'Thesis')]]) }
  ];
  let open: Project | null = projects[1];
  let file = 'main.tex';
  let cursor = { line: 7, col: 1 };
  let state: 'idle' | 'compiling' | 'ready' | 'error' = 'idle';
  let problems = '';
  let log: string[] = [];
  let pages = 0;

  const project = (): Project => {
    if (!open) throw new Error('No project is open. Open one with open or create one first.');
    return open;
  };
  const fileText = (path: string): string => {
    const text = project().files.get(path);
    if (text === undefined) throw new Error(`There is no file ${path} in ${project().name}.`);
    return text;
  };
  const status = () => ({
    project: open ? { name: open.name, kind: 'browser', notes: open.notes } : null,
    file: open ? file : null,
    cursor,
    compiling: state === 'compiling',
    last: state === 'ready' || state === 'error' ? { ok: state === 'ready', errors: state === 'error' ? 1 : 0, warnings: 0 } : null,
    version: 'fake-1.0.0'
  });
  const offsetOf = (text: string, at: { line: number; col: number }): number => {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(at.line - 1, lines.length - 1); i++) offset += lines[i].length + 1;
    return offset + Math.min(Math.max(0, at.col - 1), lines[Math.min(at.line - 1, lines.length - 1)].length);
  };
  const positionOf = (text: string, offset: number) => {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length, col: before[before.length - 1].length + 1 };
  };

  return {
    status,
    projects: () => projects.map((p) => ({ name: p.name, updatedAt: p.updatedAt, notes: p.notes })),
    open: ({ name }) => {
      const found = projects.find((p) => p.name === name);
      if (!found) throw new Error(`There is no project "${name}" in this browser. Folder projects need Open folder in the app.`);
      open = found;
      file = 'main.tex';
      state = 'idle';
      onEvent('document', { project: name });
      return status();
    },
    create: ({ name, template }) => {
      if (projects.some((p) => p.name === name)) throw new Error(`A project "${name}" exists already.`);
      const created: Project = { name, updatedAt: Date.now(), notes: null, files: new Map([['main.tex', template === 'empty' ? '' : MAIN_TEX]]) };
      projects.push(created);
      open = created;
      file = 'main.tex';
      return status();
    },
    files: () => [...project().files].map(([path, text]) => ({ path, size: Buffer.byteLength(text) })),
    read: ({ path }) => ({ text: fileText(path) }),
    write: ({ path, text }) => {
      const created = !project().files.has(path);
      project().files.set(path, text);
      project().updatedAt = Date.now();
      return { path, created, size: Buffer.byteLength(text) };
    },
    insert: ({ text, at, file: target }) => {
      if (target) file = target;
      const current = fileText(file);
      const offset = at === 'end' ? current.length : at && typeof at === 'object' ? offsetOf(current, at) : offsetOf(current, cursor);
      const next = current.slice(0, offset) + text + current.slice(offset);
      project().files.set(file, next);
      cursor = positionOf(next, offset + text.length);
      return { file, cursor };
    },
    compile: () => {
      if (state === 'compiling') return { started: false, reason: 'a compile is running' };
      state = 'compiling';
      onEvent('compile', { state });
      const main = fileText('main.tex');
      setTimeout(() => {
        const bad = main.split('\n').findIndex((line) => line.includes('\\oops'));
        state = bad >= 0 ? 'error' : 'ready';
        problems = bad >= 0 ? `main.tex:${bad + 1}: error: Undefined control sequence \\oops` : '';
        pages = bad >= 0 ? pages : 1 + Math.floor(main.length / 3000);
        log = ['This is pdfTeX, Version 3.141592653', '(./main.tex', 'LaTeX2e <2025-06-01>', ...(bad >= 0 ? [problems] : []), `Output written on main.pdf (${pages} pages).`];
        onEvent('compile', { state });
      }, 1200);
      return { started: true };
    },
    compile_status: () => ({ state, problems, log: log.slice(-60).join('\n') }),
    pdf_page: ({ page, scale }) => {
      if (pages === 0) throw new Error('There is no PDF yet, compile first.');
      if (page < 1 || page > pages) throw new Error(`The PDF has ${pages} pages.`);
      const bars = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 90, y: 110 + i * 30, w: 300 + (i % 3) * 60, h: 9 }));
      const rendered = renderStrokes({ w: 612, h: 792 }, [], Number(scale ?? 2), undefined, bars);
      return { png: rendered.png, pages };
    },
    pdf: () => {
      if (pages === 0) throw new Error('There is no PDF yet, compile first.');
      return { pdf: Buffer.from(fakePdf(pages)).toString('base64') };
    },
    link: ({ notes }) => {
      project().notes = notes ?? null;
      return { project: project().name, notes: project().notes };
    }
  };
}

// a small pdf with empty pages that pdf readers accept
function fakePdf(pages: number): string {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>')
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

export async function startFakeApps(port: number): Promise<{ notes: FakeTab; tex: FakeTab; close: () => Promise<void> }> {
  const notes = await connect(port, 'brainotes', brainotesHandlers());
  let tex: FakeTab | null = null;
  tex = await connect(
    port,
    'texbrain',
    texbrainHandlers((name, data) => tex?.events(name, data))
  );
  return {
    notes,
    tex,
    close: async () => {
      await notes.close();
      await tex?.close();
    }
  };
}

// started on its own: connect both fake tabs and stay until ctrl+c
if (process.argv[1]?.endsWith('fake-app.ts')) {
  const port = Number(process.argv[2] ?? 7332);
  const apps = await startFakeApps(port);
  console.log(`fake braiNOTES and TeXbrain tabs connected to port ${port}, ctrl+c to stop`);
  process.on('SIGINT', () => apps.close().then(() => process.exit(0)));
}
