import { createRequire } from 'node:module';

// package.json sits one folder up from both src and dist
export const version: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
