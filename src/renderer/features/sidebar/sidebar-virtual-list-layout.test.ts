import { describe, expect, it } from 'vitest';
import { getSidebarVirtualRowOffset } from './sidebar-virtual-list-layout';

describe('sidebar virtual list layout', () => {
  it('removes the list content margin from a virtual row position', () => {
    expect(getSidebarVirtualRowOffset(404, 400)).toBe(4);
    expect(getSidebarVirtualRowOffset(580, 400)).toBe(180);
  });
});
