// the braiNOTES tools. most go to the tab as they are; the page tools add the
// layout from the strokes, and transcription runs here in the server.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Bridge } from '../server.js';
import { findNotebook, type NotebookRow, type NotesStatus, type TexStatus } from '../apps.js';
import { isPng } from '../png.js';
import { writeBase64 } from '../files.js';
import { fitScale, pageImage, readPage, type PageContent } from '../page.js';
import { countPoints, POINT_CAP, thin } from '../strokes.js';
import { mathBoxes, type Box } from '../layout.js';
import { transcriptionPrompt } from '../prompt.js';
import { anthropicAsk, transcribe, type Picture } from '../transcribe.js';
import { forward } from './forward.js';
import { fail, image, text } from './result.js';

// at most this many crops of math go with a page, each costs image tokens
const MAX_CROPS = 6;

export const pageIndex = z.number().int().min(0).describe('page index from notes_pages, the first page is 0');
export const notebookKey = z.string().optional().describe('notebook id or name from notes_list; defaults to the open notebook');

export function registerNotesTools(server: McpServer, bridge: Bridge): void {
  forward(server, bridge, 'brainotes', 'notebooks', {
    name: 'notes_list',
    title: 'List notebooks',
    description:
      'Every notebook in braiNOTES: id, name, kind (paper has pages, board is one endless page), page count, ' +
      'when it last changed, and tex, the name of the linked TeXbrain project or null.',
    shape: {}
  });

  server.registerTool(
    'notes_open',
    {
      title: 'Open notebook',
      description:
        'Open a notebook in the braiNOTES tab, by id or by name. Answers once it is open, with the same status as bridge_status. ' +
        'A notebook that is open in another tab cannot be opened here; the error says so.',
      inputSchema: {
        id: z.string().optional().describe('notebook id from notes_list'),
        name: z.string().optional().describe('notebook name, used when no id is given')
      }
    },
    async ({ id, name }) => {
      if (!id && !name) return fail('Give the id or the name of a notebook, notes_list has both.');
      try {
        return text(await bridge.call('brainotes', 'open', id ? { id } : { name }));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'notes_create',
    {
      title: 'Create notebook',
      description: 'Create a notebook and open it. kind "paper" (the default) gives pages, "board" one endless whiteboard.',
      inputSchema: {
        name: z.string().min(1).describe('name of the new notebook'),
        kind: z.enum(['paper', 'board']).optional().describe('"paper" (default) or "board"')
      }
    },
    async ({ name, kind }) => {
      try {
        return text(await bridge.call('brainotes', 'create', { name, kind: kind ?? 'paper' }));
      } catch (error) {
        return fail(error);
      }
    }
  );

  forward(server, bridge, 'brainotes', 'pages', {
    name: 'notes_pages',
    title: 'Pages',
    description:
      'The pages of the open notebook: index (counted from 0), id, width and height in page units (A4 is 595 x 842), ' +
      'how many items are on it and whether it has a PDF page behind the ink.',
    shape: {}
  });

  forward(server, bridge, 'brainotes', 'goto', {
    name: 'notes_goto',
    title: 'Go to page',
    description: 'Scroll the braiNOTES tab to a page, so the user sees what you are looking at.',
    shape: { page: pageIndex }
  });

  forward(server, bridge, 'brainotes', 'new_page', {
    name: 'notes_new_page',
    title: 'New page',
    description: 'Add an empty page with the notebook\'s paper, after a page or at the end. Returns the index of the new page.',
    shape: { after: pageIndex.optional().describe('the new page goes after this one; defaults to the end') }
  });

  forward(server, bridge, 'brainotes', 'add_text', {
    name: 'notes_add_text',
    title: 'Add text',
    description:
      'Put typed text on a page, its top left corner at x, y in page units from the top left of the page. ' +
      'One undo step. Returns the id of the new text item.',
    shape: {
      page: pageIndex,
      x: z.number().describe('left edge, page units'),
      y: z.number().describe('top edge, page units'),
      text: z.string().min(1),
      size: z.number().positive().optional().describe('font size in page units; defaults to the text tool size'),
      color: z.string().optional().describe('css colour like #1e66f5; defaults to the text tool colour')
    }
  });

  server.registerTool(
    'notes_add_image',
    {
      title: 'Add image',
      description:
        'Put a PNG picture on a page, its top left corner at x, y in page units, w wide (the height follows the picture). ' +
        'Give an absolute path of a PNG file on this machine, or the PNG as base64. It is stored in the notebook like a pasted picture. ' +
        'One undo step. Returns the id of the new image item.',
      inputSchema: {
        page: pageIndex,
        x: z.number().describe('left edge, page units'),
        y: z.number().describe('top edge, page units'),
        w: z.number().positive().optional().describe('width in page units; defaults to the picture size, at most the page width'),
        path: z.string().optional().describe('absolute path of a .png file'),
        png: z.string().optional().describe('the PNG as base64, when there is no file')
      }
    },
    async ({ page, x, y, w, path, png }) => {
      try {
        let data = png?.replace(/^data:image\/png;base64,/, '');
        if (path) data = (await readFile(resolve(path))).toString('base64');
        if (!data) return fail('Give the path of a PNG file or the PNG itself as base64.');
        if (!isPng(Buffer.from(data.slice(0, 48), 'base64'))) {
          return fail('That is not a PNG. Only PNG pictures can go on a page this way, convert it first.');
        }
        return text(await bridge.call('brainotes', 'add_image', { page, x, y, w, png: data }));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'notes_export_pdf',
    {
      title: 'Export PDF',
      description:
        'Export the open notebook, or some of its pages, to a PDF file on this machine: the original PDF pages with the ink on top as vectors, ' +
        'like the export button in the app but without a save dialog. Returns the path and the size.',
      inputSchema: {
        path: z.string().describe('absolute path of the .pdf file to write'),
        pages: z.array(pageIndex).optional().describe('page indexes to export; defaults to every page')
      }
    },
    async ({ path, pages }) => {
      try {
        const { pdf } = await bridge.call<{ pdf: string }>('brainotes', 'export_pdf', pages ? { pages } : {});
        return text(await writeBase64(path, pdf));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'notes_page',
    {
      title: 'Look at page',
      description:
        'See a page: the page as a PNG image (paper, PDF background, pictures, highlighter and ink, the long side at most 2000 px) ' +
        'and a text with its layout found from the strokes: lines, blocks of lines and drawings with their boxes in page units, ' +
        'plus typed texts and pictures. Handwriting has no text layer, so look here before you describe or copy a page.',
      inputSchema: {
        notebook: notebookKey,
        page: pageIndex,
        scale: z.number().min(0.5).max(4).optional().describe('pixels per page unit, default 2; lowered to fit 2000 px')
      }
    },
    async ({ notebook, page, scale }) => {
      try {
        await ensureNotebook(bridge, notebook);
        const view = await readPage(bridge, page, scale ?? 2);
        return image(view.png, view.text);
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'notes_region',
    {
      title: 'Zoom into page',
      description:
        'A part of a page as a PNG image, rendered sharp at a higher scale, to read a formula or small writing. ' +
        'x, y, w, h are page units, the boxes from notes_page fit right in.',
      inputSchema: {
        page: pageIndex,
        x: z.number().describe('left edge, page units'),
        y: z.number().describe('top edge, page units'),
        w: z.number().positive().describe('width, page units'),
        h: z.number().positive().describe('height, page units'),
        scale: z.number().min(0.5).max(8).optional().describe('pixels per page unit, default 4; lowered to fit 2000 px')
      }
    },
    async ({ page, x, y, w, h, scale }) => {
      try {
        const fit = fitScale(w, h, scale ?? 4);
        const crop = await pageImage(bridge, page, fit, { x, y, w, h });
        return image(crop.png, `page ${page}, the part at ${x}, ${y}, ${w} x ${h} page units, ${crop.w} x ${crop.h} px at scale ${crop.scale ?? fit}`);
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'notes_strokes',
    {
      title: 'Raw strokes',
      description:
        'The raw ink of a page: every stroke with its id, pen, colour, size, box and points as [x, y, pressure] in page units, ' +
        'plus typed texts, shapes and pictures. This is a lot of text; notes_page is what you want to read a page. ' +
        `Above ${POINT_CAP} points the points are thinned out and the answer says so.`,
      inputSchema: { page: pageIndex }
    },
    async ({ page }) => {
      try {
        const content = await bridge.call<PageContent>('brainotes', 'page_strokes', { page });
        const before = countPoints(content.strokes);
        const { strokes, tolerance } = thin(content.strokes);
        const note =
          tolerance > 0
            ? `${before} points were thinned to ${countPoints(strokes)}: points closer than ${tolerance} page units to the line through their neighbours were left out`
            : undefined;
        // no indentation, the points alone are long enough
        return text(JSON.stringify({ page, points: countPoints(strokes), note, ...content, strokes }));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'notes_transcribe',
    {
      title: 'Transcribe page',
      description:
        'Turn a handwritten page into LaTeX or markdown, exactly as written: nothing corrected, unreadable parts as [?], ' +
        'drawings as \\includegraphics{drawing-n}. With ANTHROPIC_API_KEY set for this server, Haiku reads the page and zoomed crops ' +
        'of the math through the Anthropic API, KaTeX checks every formula, failing ones are read again and Sonnet takes a page that still fails. ' +
        'Without a key you get the page, its layout and the instructions, and you transcribe it yourself. ' +
        'With into, the result also goes into a file of a TeXbrain project.',
      inputSchema: {
        notebook: notebookKey,
        page: pageIndex,
        format: z.enum(['latex', 'markdown']).describe('latex gives a LaTeX body without preamble, markdown uses $ and $$ for math'),
        into: z
          .object({
            project: z.string().min(1).describe('TeXbrain project name'),
            file: z.string().min(1).describe('file in the project, like main.tex; made if it does not exist'),
            at: z.enum(['end', 'cursor']).optional().describe('"end" (default, before \\end{document} if there is one) or "cursor"')
          })
          .optional()
          .describe('also write the result into TeXbrain')
      }
    },
    async ({ notebook, page, format, into }) => {
      try {
        await ensureNotebook(bridge, notebook);
        const view = await readPage(bridge, page, 2);
        if (!process.env.ANTHROPIC_API_KEY) {
          const then = into
            ? `\n\nThen put the result into ${into.file} of the TeXbrain project "${into.project}" with tex_insert or tex_write.`
            : '';
          return {
            content: [
              { type: 'image', data: view.png, mimeType: 'image/png' },
              {
                type: 'text',
                text:
                  'No ANTHROPIC_API_KEY is set for brainbridge, so transcribe this page yourself with the instructions below, ' +
                  'and zoom in with notes_region where the writing is small.\n\n' +
                  `${view.text}\n\n${transcriptionPrompt(format)}${then}`
              }
            ]
          };
        }
        const label = `page ${page}, the whole page`;
        const boxes = mathBoxes(view.content.strokes).slice(0, MAX_CROPS);
        // no math found in the strokes: the second look goes over the lines and blocks
        const second = boxes.length > 0 ? boxes : view.items.filter((i) => i.kind !== 'drawing').map((i) => i.box).slice(0, MAX_CROPS);
        const crops = async (from: Box[], zoom: number, longSide: number): Promise<Picture[]> => {
          const pictures: Picture[] = [];
          for (const box of from) {
            const crop = await pageImage(bridge, page, fitScale(box.w, box.h, zoom, longSide), box);
            pictures.push({ label: `zoomed in at ${box.x}, ${box.y}, ${box.w} x ${box.h}`, png: crop.png });
          }
          return pictures;
        };
        const result = await transcribe(
          {
            format,
            page: { label, png: view.png },
            crops: await crops(boxes, 3, 1200),
            zoom: () => crops(second, 5, 1600),
            layout: view.text
          },
          anthropicAsk()
        );
        const report = [...result.steps];
        if (result.problems.length > 0) {
          report.push('these math spans still do not parse, check them on the page:');
          for (const p of result.problems) report.push(`  line ${p.line}: ${p.math} (${p.error})`);
        }
        if (into) report.push(await writeInto(bridge, into, result.text));
        return {
          content: [
            { type: 'text', text: result.text },
            { type: 'text', text: report.join('\n') }
          ]
        };
      } catch (error) {
        return fail(error);
      }
    }
  );
}

export interface Into {
  project: string;
  file: string;
  at?: 'end' | 'cursor';
}

// puts a transcription into a texbrain file: a new file gets it as its text, an existing one
// at the cursor or at the end, before \end{document} when the file has one
export async function writeInto(bridge: Bridge, into: Into, body: string): Promise<string> {
  const status = await bridge.call<TexStatus>('texbrain', 'status');
  if (status.project?.name !== into.project) await bridge.call('texbrain', 'open', { name: into.project });
  const files = await bridge.call<{ path: string }[]>('texbrain', 'files');
  if (!files.some((f) => f.path === into.file)) {
    await bridge.call('texbrain', 'write', { path: into.file, text: `${body}\n` });
    return `written to ${into.file}, a new file in "${into.project}"`;
  }
  if (into.at === 'cursor') {
    await bridge.call('texbrain', 'insert', { text: body, at: 'cursor', file: into.file });
    return `inserted at the cursor in ${into.file} of "${into.project}"`;
  }
  const { text: current } = await bridge.call<{ text: string }>('texbrain', 'read', { path: into.file });
  const end = current.lastIndexOf('\\end{document}');
  const next =
    end >= 0
      ? `${current.slice(0, end).replace(/\s*$/, '\n\n')}${body}\n\n${current.slice(end)}`
      : `${current.replace(/\s*$/, '\n\n')}${body}\n`;
  await bridge.call('texbrain', 'write', { path: into.file, text: next });
  return `added to ${into.file} of "${into.project}"${end >= 0 ? ', before \\end{document}' : ', at the end'}`;
}

// opens the notebook a tool was asked about, unless it is the open one already
export async function ensureNotebook(bridge: Bridge, key: string | undefined): Promise<void> {
  if (!key) return;
  const status = await bridge.call<NotesStatus>('brainotes', 'status');
  const open = status.notebook;
  if (open && (open.id === key || open.name.toLowerCase() === key.trim().toLowerCase())) return;
  const rows = await bridge.call<NotebookRow[]>('brainotes', 'notebooks');
  const row = findNotebook(rows, key);
  if (!row) throw new Error(`There is no notebook "${key}" in braiNOTES. It has: ${rows.map((r) => `"${r.name}"`).join(', ')}`);
  await bridge.call('brainotes', 'open', { id: row.id });
}
