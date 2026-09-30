// the TeXbrain tools, and the katex check that both apps' work goes through

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Bridge } from '../server.js';
import { checkLatex } from '../latex.js';
import { forward } from './forward.js';
import { fail, text } from './result.js';

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
}
