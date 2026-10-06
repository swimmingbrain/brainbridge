import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli.js';

describe('cli', () => {
  it('runs the server on 7332 by default', () => {
    expect(parseArgs([], {})).toEqual({ command: 'serve', port: 7332 });
  });

  it('takes the port from the flag before the environment', () => {
    expect(parseArgs([], { BRAINBRIDGE_PORT: '7400' })).toEqual({ command: 'serve', port: 7400 });
    expect(parseArgs(['--port', '7401'], { BRAINBRIDGE_PORT: '7400' }).port).toBe(7401);
    expect(parseArgs(['--port=7402'], {}).port).toBe(7402);
  });

  it('knows status, help and version', () => {
    expect(parseArgs(['status', '-p', '7400'], {})).toEqual({ command: 'status', port: 7400 });
    expect(parseArgs(['--help'], {}).command).toBe('help');
    expect(parseArgs(['--version'], {}).command).toBe('version');
  });

  it('says what is wrong with a bad port or argument', () => {
    expect(() => parseArgs(['--port', 'x'], {})).toThrow(/port from 1 to 65535/);
    expect(() => parseArgs(['--port'], {})).toThrow(/port from 1 to 65535/);
    expect(() => parseArgs(['--colour'], {})).toThrow(/unknown argument/);
  });
});
