import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@renderer/lib/ui/info-tooltip', async () => {
  const React = await import('react');
  return {
    InfoTooltip: ({ label }: { label: string }) =>
      React.createElement('button', { type: 'button', 'aria-label': label }),
  };
});

describe('ComposerSettingsContent', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    host.style.width = '384px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the popover focused on composer settings', async () => {
    const { ComposerSettingsContent } = await import('@renderer/app/composer-settings-content');
    await act(async () => {
      root.render(
        createElement(ComposerSettingsContent, {
          attachImagesAsPaths: true,
          promptRewriteEnabled: false,
          inputPromptLanguage: 'app',
          autoGenerateName: true,
          namingLanguage: 'app',
          autoGenerateSummary: true,
          summaryLanguage: 'app',
          onAttachImagesAsPathsChange: vi.fn(),
          onPromptRewriteEnabledChange: vi.fn(),
          onInputPromptLanguageChange: vi.fn(),
          onAutoGenerateNameChange: vi.fn(),
          onNamingLanguageChange: vi.fn(),
          onAutoGenerateSummaryChange: vi.fn(),
          onSummaryLanguageChange: vi.fn(),
        })
      );
    });

    const settingsSections = host.querySelectorAll<HTMLElement>(
      '[data-slot="composer-settings-section"]'
    );
    expect(settingsSections).toHaveLength(1);
    expect(host.textContent).not.toContain('home.agentCliConfigLabel');
    expect(host.textContent).not.toContain('home.permissionModeLabel');
    expect(host.querySelector('[data-slot="compact-prompt-list"]')).toBeNull();
    expect(host.querySelector('[data-slot="prompt-injection-controls"]')).toBeNull();
    expect(host.textContent).not.toContain('home.promptConfigurationLabel');
  });
});
