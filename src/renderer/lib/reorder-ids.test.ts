import { describe, expect, it } from 'vitest';
import { reorderIds, reorderIdsInVisibleList } from './reorder-ids';

describe('reorder ids', () => {
  it('reorders a flat list by drag target', () => {
    expect(reorderIds(['first', 'second', 'third'], 'first', 'third')).toEqual([
      'second',
      'third',
      'first',
    ]);
  });

  it('keeps the list identity when the drag target does not move anything', () => {
    const ids = ['first', 'second'];
    expect(reorderIds(ids, 'first', 'first')).toBe(ids);
    expect(reorderIds(ids, 'first', 'missing')).toBe(ids);
  });

  it('reorders a filtered subset without changing hidden slots', () => {
    expect(
      reorderIdsInVisibleList(
        ['first', 'hidden', 'second', 'third'],
        ['first', 'second', 'third'],
        'first',
        'third'
      )
    ).toEqual(['second', 'hidden', 'third', 'first']);
  });
});
