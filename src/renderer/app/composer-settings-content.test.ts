import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('shared composer settings surfaces', () => {
  it('keeps Home and the workspace runtime bar on one configuration component', () => {
    const content = readFileSync(
      new URL('./composer-settings-content.tsx', import.meta.url),
      'utf8'
    );
    const home = readFileSync(new URL('./home-view.tsx', import.meta.url), 'utf8');
    const runtimeBar = readFileSync(
      new URL('./workspace-runtime-bar.tsx', import.meta.url),
      'utf8'
    );

    expect(home).toContain('<ComposerSettingsContent');
    expect(runtimeBar).toContain('<ComposerSettingsContent');
    expect(content).toContain("t('home.attachImagesAsPathsLabel')");
    expect(content).toContain("t('settings.tasks.inputPromptLanguageLabel')");
    expect(content).toContain("t('settings.tasks.sessionTitleLanguageLabel')");
    expect(content).toContain("t('settings.tasks.summaryLanguageLabel')");
    expect(content).toContain('<PermissionModeSelect');
    expect(content).toContain("t('home.enabledPromptCount'");
    expect(content).toContain("t('home.openPromptLibrary')");
    expect(content).toContain("appState.navigation.navigate('library', { section: 'prompts' })");
    expect(content).not.toContain('<PromptInjectionControls');
    expect(content).not.toContain('<InstructionFilesSection');
  });

  it('places Config before the existing right-side workspace utilities', () => {
    const runtimeBar = readFileSync(
      new URL('./workspace-runtime-bar.tsx', import.meta.url),
      'utf8'
    );
    const configIndex = runtimeBar.indexOf("aria-label={t('workspaceRuntime.config.title')}");
    const agentsIndex = runtimeBar.indexOf("aria-label={t('workspaceRuntime.agents.triggerLabel'");

    expect(configIndex).toBeGreaterThan(0);
    expect(agentsIndex).toBeGreaterThan(configIndex);
  });

  it('applies the image-path setting to the active conversation TUI paste boundary', () => {
    const conversation = readFileSync(
      new URL('../features/tasks/conversations/conversation-session.tsx', import.meta.url),
      'utf8'
    );
    const pinnedConversation = readFileSync(
      new URL('../features/tasks/view/sidebar-pinned-content.tsx', import.meta.url),
      'utf8'
    );
    const pty = readFileSync(new URL('../lib/pty/use-pty.ts', import.meta.url), 'utf8');

    expect(conversation).toContain('useAttachImagesAsPaths(projectId)');
    expect(conversation).toContain('pasteImagesAsPaths={attachImagesAsPaths}');
    expect(pinnedConversation).toContain('pasteImagesAsPaths={attachImagesAsPaths}');
    expect(pty).toContain("terminalElement.addEventListener('paste', handleTerminalPaste, true)");
    expect(pty).toContain('transformTerminalPasteText(text, pasteImagesAsPathsRef.current)');
  });
});
