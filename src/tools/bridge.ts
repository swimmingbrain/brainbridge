// the tools that are about both apps at once: who is connected, links between a
// notebook and a project, and switching from one app to the other.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { APPS } from '../protocol.js';
import { appUrl, howToConnect, type Bridge } from '../server.js';
import { message, text } from './result.js';

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
}
