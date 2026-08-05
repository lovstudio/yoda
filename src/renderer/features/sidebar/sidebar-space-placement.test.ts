import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SidebarSpace button placement', () => {
  it('renders view options as the penultimate top navigation button', () => {
    const source = readFileSync(new URL('./sidebar-space.tsx', import.meta.url), 'utf8');
    const navButtonsStart = source.indexOf('<NavButtons>');
    const navButtonsEnd = source.indexOf('</NavButtons>', navButtonsStart);
    const navButtons = source.slice(navButtonsStart, navButtonsEnd);
    const viewOptionsIndex = navButtons.indexOf('<ProjectsSettingsMenu');
    const sidebarToggleIndex = navButtons.indexOf("{t('navigation.toggleLeftSidebar')}");

    expect(navButtonsStart).toBeGreaterThan(-1);
    expect(navButtonsEnd).toBeGreaterThan(navButtonsStart);
    expect(viewOptionsIndex).toBeGreaterThan(-1);
    expect(sidebarToggleIndex).toBeGreaterThan(viewOptionsIndex);
    expect(navButtons.match(/<ProjectsSettingsMenu/g)).toHaveLength(1);
  });
});
