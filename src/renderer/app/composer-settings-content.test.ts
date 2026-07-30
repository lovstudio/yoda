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
    expect(content).toContain('<PromptInjectionControls');
    expect(content).toContain('<InstructionFilesSection');
  });

  it('places Config before the existing right-side workspace utilities', () => {
    const runtimeBar = readFileSync(
      new URL('./workspace-runtime-bar.tsx', import.meta.url),
      'utf8'
    );
    const configIndex = runtimeBar.indexOf("aria-label={t('workspaceRuntime.config.title')}");
    const resourcesIndex = runtimeBar.indexOf("aria-label={t('workspaceRuntime.resources.title')}");

    expect(configIndex).toBeGreaterThan(0);
    expect(resourcesIndex).toBeGreaterThan(configIndex);
  });
});
