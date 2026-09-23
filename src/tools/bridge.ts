// the tools that are about both apps at once: who is connected, links between a
// notebook and a project, and switching from one app to the other.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { APPS } from '../protocol.js';
import { appUrl, howToConnect, type Bridge } from '../server.js';
import { findNotebook, type NotebookRow, type NotesStatus, type TexStatus } from '../apps.js';
import { linksFile, readLinks, saveLink } from '../state.js';
import { fail, message, text } from './result.js';

export function registerBridgeTools(server: McpServer, bridge: Bridge): void {
  server.registerTool(
    'bridge_status',
    {
      title: 'Bridge status',
      description:
        'Call this first. Says which of the two apps are connected (braiNOTES for handwritten notebooks, TeXbrain for LaTeX) ' +
        'and what each one has open: the notebook, page, tool and zoom in braiNOTES; the project, file, cursor and last compile in TeXbrain. ' +
        'For an app that is not connected it says how to connect it. Also gives the server version and the two app addresses.'
    },
    async () => {
      const apps: Record<string, unknown> = {};
      for (const app of APPS) {
        if (!bridge.connected(app)) {
          apps[app] = { connected: false, howToConnect: howToConnect(app, bridge.port) };
          continue;
        }
        try {
          apps[app] = { connected: true, tab: bridge.info(app), status: await bridge.call(app, 'status') };
        } catch (error) {
          apps[app] = { connected: true, tab: bridge.info(app), error: message(error) };
        }
      }
      return text({
        server: 'brainbridge',
        version: bridge.version,
        port: bridge.port,
        apps,
        urls: { brainotes: appUrl('brainotes', bridge.port), texbrain: appUrl('texbrain', bridge.port) }
      });
    }
  );

  server.registerTool(
    'bridge_link',
    {
      title: 'Link notebook and project',
      description:
        'Tie a braiNOTES notebook to a TeXbrain project, for example the lecture notes to the script written from them. ' +
        'Sets the link in both apps when they are connected (each one opens the document to store it) and remembers it in this server, ' +
        'so bridge_switch and the buttons in the apps can jump between the two. A notebook has one project and a project one notebook.',
      inputSchema: {
        notebook: z.string().min(1).describe('notebook id or name, from notes_list'),
        project: z.string().min(1).describe('TeXbrain project name, from tex_projects')
      }
    },
    async ({ notebook, project }) => {
      let id = notebook;
      let name = notebook;
      let notes = 'not connected, only this server knows the link for now';
      let tex = 'not connected, only this server knows the link for now';
      if (bridge.connected('brainotes')) {
        try {
          const rows = await bridge.call<NotebookRow[]>('brainotes', 'notebooks');
          const row = findNotebook(rows, notebook);
          if (!row) {
            return fail(`There is no notebook "${notebook}" in braiNOTES. It has: ${rows.map((r) => `"${r.name}" (${r.id})`).join(', ')}`);
          }
          id = row.id;
          name = row.name;
          const status = await bridge.call<NotesStatus>('brainotes', 'status');
          if (status.notebook?.id !== id) await bridge.call('brainotes', 'open', { id });
          await bridge.call('brainotes', 'link', { tex: project });
          notes = `the notebook "${name}" links to the project "${project}"`;
        } catch (error) {
          notes = `could not set the link: ${message(error)}`;
        }
      }
      if (bridge.connected('texbrain')) {
        try {
          const status = await bridge.call<TexStatus>('texbrain', 'status');
          if (status.project?.name !== project) await bridge.call('texbrain', 'open', { name: project });
          await bridge.call('texbrain', 'link', { notes: id });
          tex = `the project "${project}" links to the notebook "${name}"`;
        } catch (error) {
          tex = `could not set the link: ${message(error)}`;
        }
      }
      await saveLink({ notebook: id, name, project, linkedAt: new Date().toISOString() });
      return text({ notebook: { id, name }, project, brainotes: notes, texbrain: tex, savedIn: linksFile() });
    }
  );

  server.registerTool(
    'bridge_links',
    {
      title: 'Links',
      description: 'Every notebook and project linked with bridge_link, the newest first, and the file they are kept in.'
    },
    async () => {
      const links = await readLinks();
      if (links.length === 0) return text(`No links yet. Make one with bridge_link. They are kept in ${linksFile()}.`);
      return text({ file: linksFile(), links });
    }
  );
}
