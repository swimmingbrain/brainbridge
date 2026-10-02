// the TeXbrain tools, and the katex check that both apps' work goes through

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Bridge } from '../server.js';
import type { CompileStatus } from '../apps.js';
import { checkLatex } from '../latex.js';
import { writeBase64 } from '../files.js';
import { pngSize } from '../png.js';
import { LONG_SIDE } from '../page.js';
import { forward } from './forward.js';
import { fail, image, text } from './result.js';

const COMPILE_WAIT = 45_000;

const projectPath = z.string().min(1).describe('path relative to the project root, like main.tex or chapters/one.tex');

// paths stay inside the project
function checkPath(path: string): void {
  if (/^([a-zA-Z]:)?[\\/]/.test(path) || path.split(/[\\/]/).includes('..')) {
    throw new Error(`"${path}" is not inside the project. Paths are relative to the project root, like main.tex.`);
  }
}

export function registerTexTools(server: McpServer, bridge: Bridge): void {
  server.registerTool(
    'latex_check',
    {
      title: 'Check LaTeX math',
      description:
        'Parse every math span of a LaTeX or markdown text with KaTeX: $...$, $$...$$, \\(...\\), \\[...\\] and the bodies of ' +
        'align, equation and gather. Returns "ok", or each span that fails with its line and the error. ' +
        'Use it on a transcription or before writing math into a project.',
      inputSchema: { text: z.string().describe('the LaTeX or markdown text') }
    },
    async ({ text: source }) => {
      const problems = checkLatex(source);
      return text(problems.length === 0 ? 'ok' : problems);
    }
  );

  forward(server, bridge, 'texbrain', 'status', {
    name: 'tex_status',
    title: 'TeXbrain status',
    description:
      'What the TeXbrain tab has open: the project (name, kind browser or folder, the linked notebook), the active file, ' +
      'the cursor line and column, whether it is compiling and how the last compile went.',
    shape: {}
  });

  forward(server, bridge, 'texbrain', 'projects', {
    name: 'tex_projects',
    title: 'List projects',
    description:
      'The projects stored in the browser: name, when it last changed and the linked braiNOTES notebook. ' +
      'Projects in a folder on disk are not listed, the browser only reaches them through its folder picker.',
    shape: {}
  });

  forward(server, bridge, 'texbrain', 'open', {
    name: 'tex_open',
    title: 'Open project',
    description:
      'Open a project stored in the browser by its name from tex_projects. Answers once it is open, with the status. ' +
      'A folder on disk cannot be opened from here; the user opens it with Open folder.',
    shape: { name: z.string().min(1).describe('project name from tex_projects') }
  });

  forward(server, bridge, 'texbrain', 'create', {
    name: 'tex_create',
    title: 'Create project',
    description: 'Create a project in the browser with a main.tex, from a template if one is named, and open it.',
    shape: {
      name: z.string().min(1).describe('name of the new project'),
      template: z.string().optional().describe('template name, as the new project dialog lists them; defaults to an empty article')
    }
  });

  forward(server, bridge, 'texbrain', 'files', {
    name: 'tex_files',
    title: 'Files',
    description: 'Every file of the open project: path relative to the project root and size in bytes.',
    shape: {}
  });

  server.registerTool(
    'tex_read',
    {
      title: 'Read file',
      description: 'The text of a file of the open project, with the edits that are not saved yet if it is open in the editor.',
      inputSchema: { path: projectPath }
    },
    async ({ path }) => {
      try {
        checkPath(path);
        const { text: content } = await bridge.call<{ text: string }>('texbrain', 'read', { path });
        return text(content);
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'tex_write',
    {
      title: 'Write file',
      description:
        'Create a file in the open project or replace all of its text. If it is open in the editor the user sees the new text ' +
        'right away and can undo it. Folders in the path are made as needed.',
      inputSchema: { path: projectPath, text: z.string().describe('the whole new text of the file') }
    },
    async ({ path, text: content }) => {
      try {
        checkPath(path);
        return text(await bridge.call('texbrain', 'write', { path, text: content }));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'tex_insert',
    {
      title: 'Insert text',
      description:
        'Insert text into a file through the editor, at the cursor, at the end, or at a line and column as tex_status gives the cursor. ' +
        'The file is opened in the editor if it is not the active one. One undo step. Returns the new cursor.',
      inputSchema: {
        text: z.string().min(1),
        at: z
          .union([z.enum(['cursor', 'end']), z.object({ line: z.number().int().min(0), col: z.number().int().min(0) })])
          .optional()
          .describe('"cursor" (default), "end", or { line, col }'),
        file: projectPath.optional().describe('the file to insert into; defaults to the active file')
      }
    },
    async ({ text: content, at, file }) => {
      try {
        if (file) checkPath(file);
        return text(await bridge.call('texbrain', 'insert', { text: content, at: at ?? 'cursor', file }));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'tex_compile',
    {
      title: 'Compile',
      description:
        'Compile the open project in the tab and wait for it, up to 45 seconds. Returns the state (ready or error), ' +
        'the problems with their files and lines, and the end of the log. A first compile downloads TeX Live packages and can take ' +
        'longer; then it answers "still compiling" and tex_compile_status tells when it is done.',
      inputSchema: {}
    },
    async () => {
      try {
        const start = await bridge.call<{ started: boolean; reason?: string }>('texbrain', 'compile');
        const deadline = Date.now() + COMPILE_WAIT;
        // right after the start the tab may still report the compile before
        let seen = !start.started;
        const begun = Date.now();
        while (Date.now() < deadline) {
          await sleep(700);
          const status = await bridge.call<CompileStatus>('texbrain', 'compile_status');
          if (status.state === 'compiling') {
            seen = true;
            continue;
          }
          if (seen || Date.now() - begun > 3000) return text({ ...status, log: tail(status.log, 60) });
        }
        return text({ state: 'compiling', note: 'still compiling after 45 s, ask tex_compile_status again in a moment' });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'tex_compile_status',
    {
      title: 'Compile status',
      description: 'The state of the last or running compile (idle, compiling, ready, error), its problems and the last 60 lines of the log.',
      inputSchema: {}
    },
    async () => {
      try {
        const status = await bridge.call<CompileStatus>('texbrain', 'compile_status');
        return text({ ...status, log: tail(status.log, 60) });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'tex_problems',
    {
      title: 'Problems',
      description: 'The errors and warnings of the last compile, each with its file, line and message, as the problems panel shows them.',
      inputSchema: {}
    },
    async () => {
      try {
        const status = await bridge.call<CompileStatus>('texbrain', 'compile_status');
        if (status.state === 'idle') return text('Nothing was compiled yet. Run tex_compile.');
        if (status.state === 'compiling') return text('A compile is running. Ask again when it is done.');
        return text(status.problems.trim() || 'No problems in the last compile.');
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'tex_pdf_page',
    {
      title: 'Look at PDF page',
      description:
        'A page of the last compiled PDF as a PNG image, to check what the LaTeX looks like. Pages count from 1 like the PDF viewer. ' +
        'The long side is kept at most 2000 px.',
      inputSchema: {
        page: z.number().int().min(1).describe('page number, the first page is 1'),
        scale: z.number().min(0.5).max(4).optional().describe('pixels per PDF point, default 2')
      }
    },
    async ({ page, scale }) => {
      try {
        let wanted = scale ?? 2;
        let result = await bridge.call<{ png: string; pages: number }>('texbrain', 'pdf_page', { page, scale: wanted });
        const size = pngSize(result.png);
        if (size && Math.max(size.width, size.height) > LONG_SIDE) {
          wanted = Math.floor(wanted * (LONG_SIDE / Math.max(size.width, size.height)) * 100) / 100;
          result = await bridge.call<{ png: string; pages: number }>('texbrain', 'pdf_page', { page, scale: wanted });
        }
        const now = pngSize(result.png);
        return image(result.png, `page ${page} of ${result.pages}${now ? `, ${now.width} x ${now.height} px` : ''} at scale ${wanted}`);
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    'tex_save_pdf',
    {
      title: 'Save PDF',
      description: 'Write the last compiled PDF to a file on this machine. Returns the path and the size.',
      inputSchema: { path: z.string().describe('absolute path of the .pdf file to write') }
    },
    async ({ path }) => {
      try {
        const { pdf } = await bridge.call<{ pdf: string }>('texbrain', 'pdf');
        return text(await writeBase64(path, pdf));
      } catch (error) {
        return fail(error);
      }
    }
  );
}

// the last lines of a log, whether the tab sends it as text or as lines
function tail(log: string | string[] | undefined, lines: number): string {
  const all = Array.isArray(log) ? log : String(log ?? '').split('\n');
  return all.slice(-lines).join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
