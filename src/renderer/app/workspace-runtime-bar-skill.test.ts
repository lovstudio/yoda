import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace Skill placement', () => {
  it('opens an integrated popover after Prompt before context usage', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');
    const skillSource = readFileSync(
      new URL('./workspace-skill-popover.tsx', import.meta.url),
      'utf8'
    );
    const promptTriggerIndex = source.indexOf('<WorkspacePromptPopover');
    const skillTriggerIndex = source.indexOf('<WorkspaceSkillPopover');
    const contextEntry = source.indexOf('{sessionContext && contextPercent != null ? (');
    const terminalTriggerIndex = source.indexOf("title={t('workspaceRuntime.terminal')}");

    expect(skillTriggerIndex).toBeGreaterThan(promptTriggerIndex);
    expect(skillTriggerIndex).toBeLessThan(contextEntry);
    expect(terminalTriggerIndex).toBeGreaterThan(skillTriggerIndex);
    expect(source).toContain('<WorkspaceSkillPopover');
    expect(source).toContain('onManageSkills={openSkillsManagement}');
    expect(skillSource).toContain('<Blocks className="size-3.5" />');
    expect(skillSource).toContain('onPointerEnter={prefetchSkillsCatalog}');
    expect(skillSource).toContain(
      'void queryClient.prefetchQuery(skillsQuickCatalogQueryOptions);'
    );
    expect(source).toContain("appState.navigation.navigate('skills');");
    expect(source).not.toContain("onClick={() => appState.navigation.navigate('skills')}");
  });

  it('reads Codex model details without requesting full session context', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('rpc.conversations.getCodexSessionRuntimeMetadata(');
    expect(source).not.toContain('rpc.conversations.getCodexSessionContext(');
  });

  it('renders the active model only from provider-reported session metadata', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const activeSessionModel = sessionModelDetails?.model ?? null;');
    expect(source).toContain('{activeSessionModel}');
    expect(source).not.toContain('sessionRuntimeOverride');
    expect(source).not.toContain('runtimeSnapshot?.model.defaultModel');
    expect(source).not.toContain('runtimeSnapshot?.model.nativeModel');
  });
});
