import { describe, expect, it } from 'vitest';
import {
  loadRecentCommandPaletteQueries,
  rememberCommandPaletteQuery,
  rememberRecentCommandPaletteQuery,
  removeRecentCommandPaletteQuery,
  resolveInitialCommandPaletteQuery,
} from './query-memory';

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

  it('keeps recent searches in most-recent-first order without duplicates', () => {
    const storage = createMemoryStorage();

    rememberRecentCommandPaletteQuery(' release notes ', storage);
    rememberRecentCommandPaletteQuery('in:tasks onboarding', storage);
    rememberRecentCommandPaletteQuery('release notes', storage);

    expect(loadRecentCommandPaletteQueries(storage)).toEqual([
      'release notes',
      'in:tasks onboarding',
    ]);
  });

  it('limits recent searches and ignores blank entries', () => {
    const storage = createMemoryStorage();

    rememberRecentCommandPaletteQuery('   ', storage);
    for (let index = 0; index < 10; index += 1) {
      rememberRecentCommandPaletteQuery(`query ${index}`, storage);
    }

    expect(loadRecentCommandPaletteQueries(storage)).toEqual([
      'query 9',
      'query 8',
      'query 7',
      'query 6',
      'query 5',
      'query 4',
      'query 3',
      'query 2',
    ]);
  });

  it('removes one recent search without affecting the others', () => {
    const storage = createMemoryStorage();

    rememberRecentCommandPaletteQuery('first', storage);
    rememberRecentCommandPaletteQuery('second', storage);

    expect(removeRecentCommandPaletteQuery('second', storage)).toEqual(['first']);
    expect(loadRecentCommandPaletteQueries(storage)).toEqual(['first']);
  });
});
