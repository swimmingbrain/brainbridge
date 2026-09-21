import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Bridge } from './server.js';

// what the agent reads before it touches any tool
const INSTRUCTIONS = `You are working with braiNOTES (handwritten notebooks) and TeXbrain (a LaTeX editor), both open in the user's browser. The user watches the tabs while you work.

Start with bridge_status. It says which apps are connected. If the one you need is not, tell the user what it says to open and stop.
braiNOTES: pages are counted from 0 as notes_pages lists them, positions are page units from the top left of the page (A4 paper is 595 x 842). Handwriting has no text layer: look at a page with notes_page before you describe or copy it, and use notes_transcribe to turn it into LaTeX or markdown.
TeXbrain: paths are relative to the project root. Write with tex_write and tex_insert so the editor shows it, compile with tex_compile, read tex_problems and look at the result with tex_pdf_page.
bridge_link ties a notebook to a project, bridge_switch opens the linked one in the other app.
Every edit is one undo step in the tab, so the user can step back through your work.`;

export function createMcpServer(bridge: Bridge): McpServer {
  const server = new McpServer({ name: 'brainbridge', version: bridge.version }, { instructions: INSTRUCTIONS });
  return server;
}
