import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// the tabs send files as base64, this puts them on disk where the agent asked
export async function writeBase64(path: string, base64: string): Promise<{ path: string; bytes: number }> {
  const target = resolve(path);
  const bytes = Buffer.from(base64, 'base64');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { path: target, bytes: bytes.length };
}
