import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, installBrokenConsolePipeHandler } from './logger';

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores broken pipe errors from console writes', () => {
    const stderrError = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      throw stderrError;
    });

    const log = createLogger({ envLevel: 'error' });

    expect(() => log.error('failed to do work')).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('failed to do work');
  });

  it('keeps unexpected console failures visible', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console failed');
    });

    const log = createLogger({ envLevel: 'error' });

    expect(() => log.error('failed to do work')).toThrow('console failed');
  });

  it('ignores broken pipe errors emitted by console streams', () => {
    const stderr = new EventEmitter();
    const stderrError = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

    installBrokenConsolePipeHandler(stderr);

    expect(() => stderr.emit('error', stderrError)).not.toThrow();
  });

  it('keeps unexpected console stream errors visible', () => {
    const stderr = new EventEmitter();

    installBrokenConsolePipeHandler(stderr);

    expect(() => stderr.emit('error', new Error('stream failed'))).toThrow('stream failed');
  });
});
