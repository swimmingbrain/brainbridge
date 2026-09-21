// the only thing this server remembers: which notebook belongs to which project.
// a small json file in the user's config folder, read again on every use.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Link {
  // the braiNOTES notebook id, or what the user called it when braiNOTES was not connected
  notebook: string;
  name: string;
  // the TeXbrain project name
  project: string;
  linkedAt: string;
}

export function configDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'brainbridge');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'brainbridge');
}

export function linksFile(): string {
  return join(configDir(), 'links.json');
}

export async function readLinks(file = linksFile()): Promise<Link[]> {
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as { links?: unknown };
    return Array.isArray(data.links) ? (data.links as Link[]) : [];
  } catch {
    return [];
  }
}

// a notebook has one project and a project one notebook, so a new link
// replaces the older ones of both. the newest link comes first.
export async function saveLink(link: Link, file = linksFile()): Promise<Link[]> {
  const links = (await readLinks(file)).filter((l) => l.notebook !== link.notebook && l.project !== link.project);
  links.unshift(link);
  await mkdir(dirname(file), { recursive: true });
  // write next to it and rename, so a crash never leaves half a file
  await writeFile(`${file}.tmp`, JSON.stringify({ links }, null, 2) + '\n', 'utf8');
  await rename(`${file}.tmp`, file);
  return links;
}

export function linkOfNotebook(links: Link[], notebook: string): Link | undefined {
  return links.find((l) => l.notebook === notebook) ?? links.find((l) => l.name.toLowerCase() === notebook.toLowerCase());
}

export function linkOfProject(links: Link[], project: string): Link | undefined {
  return links.find((l) => l.project === project);
}
