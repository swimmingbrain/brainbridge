import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkOfNotebook, linkOfProject, readLinks, saveLink } from '../src/state.js';

describe('links', () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'brainbridge-'));
    file = join(dir, 'brainbridge', 'links.json');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts empty when there is no file', async () => {
    expect(await readLinks(file)).toEqual([]);
  });

  it('keeps links in the file, newest first', async () => {
    await saveLink({ notebook: 'n1', name: 'Analysis 2', project: 'analysis', linkedAt: 'a' }, file);
    await saveLink({ notebook: 'n2', name: 'Physics', project: 'physics', linkedAt: 'b' }, file);
    const links = await readLinks(file);
    expect(links.map((l) => l.project)).toEqual(['physics', 'analysis']);
    expect(JSON.parse(await readFile(file, 'utf8')).links).toHaveLength(2);
  });

  it('gives a notebook one project and a project one notebook', async () => {
    await saveLink({ notebook: 'n1', name: 'Analysis 2', project: 'analysis-script', linkedAt: 'c' }, file);
    await saveLink({ notebook: 'n3', name: 'Physics lab', project: 'physics', linkedAt: 'd' }, file);
    const links = await readLinks(file);
    expect(links.map((l) => `${l.notebook}:${l.project}`)).toEqual(['n3:physics', 'n1:analysis-script']);
  });

  it('finds a link by notebook id, notebook name or project', async () => {
    const links = await readLinks(file);
    expect(linkOfNotebook(links, 'n1')?.project).toBe('analysis-script');
    expect(linkOfNotebook(links, 'physics LAB')?.project).toBe('physics');
    expect(linkOfProject(links, 'physics')?.notebook).toBe('n3');
    expect(linkOfProject(links, 'nope')).toBeUndefined();
  });

  it('reads a broken file as no links', async () => {
    await writeFile(file, '{ not json');
    expect(await readLinks(file)).toEqual([]);
  });
});
