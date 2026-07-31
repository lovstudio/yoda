import { describe, expect, it } from 'vitest';
import { rememberCommandPaletteQuery, resolveInitialCommandPaletteQuery } from './query-memory';

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('command palette query memory', () => {
  it('defaults a first task search to the tasks scope', () => {
    expect(resolveInitialCommandPaletteQuery(undefined, 'task-search', createMemoryStorage())).toBe(
      'in:tasks '
    );
  });

  it('restores the most recent task search exactly', () => {
    const storage = createMemoryStorage();

    rememberCommandPaletteQuery('in:tasks release notes', 'task-search', storage);

    expect(resolveInitialCommandPaletteQuery(undefined, 'task-search', storage)).toBe(
      'in:tasks release notes'
    );
  });

  it('preserves an intentionally cleared task search', () => {
    const storage = createMemoryStorage();

    rememberCommandPaletteQuery('', 'task-search', storage);

    expect(resolveInitialCommandPaletteQuery(undefined, 'task-search', storage)).toBe('');
  });

  it('keeps explicit and regular palette queries independent from task search memory', () => {
    const storage = createMemoryStorage();
    rememberCommandPaletteQuery('in:tasks remembered', 'task-search', storage);

    expect(resolveInitialCommandPaletteQuery('current list filter', 'task-search', storage)).toBe(
      'current list filter'
    );
    expect(resolveInitialCommandPaletteQuery(undefined, undefined, storage)).toBe('');
    rememberCommandPaletteQuery('global query', undefined, storage);
    expect(resolveInitialCommandPaletteQuery(undefined, 'task-search', storage)).toBe(
      'in:tasks remembered'
    );
  });
});
