import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace Skill placement', () => {
  it('opens an integrated popover after MaaS instead of navigating away', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');
    const maasTriggerIndex = source.indexOf("aria-label={t('workspaceRuntime.maas.title')}");
    const skillTriggerIndex = source.indexOf("aria-label={t('workspaceRuntime.skill')}");
    const terminalTriggerIndex = source.indexOf("title={t('workspaceRuntime.terminal')}");

    expect(skillTriggerIndex).toBeGreaterThan(maasTriggerIndex);
    expect(terminalTriggerIndex).toBeGreaterThan(skillTriggerIndex);
    expect(source).toContain('<Popover open={isSkillPopoverOpen}');
    expect(source).toContain('onManageSkills={openSkillsManagement}');
    expect(source).toContain("appState.navigation.navigate('skills');");
    expect(source).not.toContain("onClick={() => appState.navigation.navigate('skills')}");
  });
});
