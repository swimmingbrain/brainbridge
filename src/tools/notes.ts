// the braiNOTES tools. most go to the tab as they are; the page tools add the
// layout from the strokes, and transcription runs here in the server.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Bridge } from '../server.js';
import { forward } from './forward.js';
import { fail, text } from './result.js';

export const pageIndex = z.number().int().min(0).describe('page index from notes_pages, the first page is 0');

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
}
