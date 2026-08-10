import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Workspace runtime bar prompt group', () => {
  const runtimeBarSource = readFileSync(
    new URL('./workspace-runtime-bar.tsx', import.meta.url),
    'utf8'
  );
  const promptPopoverSource = readFileSync(
    new URL('./workspace-prompt-popover.tsx', import.meta.url),
    'utf8'
  );

  it('places the current Agent prompt and Skill entries before context usage', () => {
    const promptEntry = runtimeBarSource.indexOf('<WorkspacePromptPopover');
    const skillEntry = runtimeBarSource.indexOf("aria-label={t('workspaceRuntime.skill')}");
    const contextEntry = runtimeBarSource.indexOf('{sessionContext && contextPercent != null ? (');

    expect(promptEntry).toBeGreaterThan(-1);
    expect(promptEntry).toBeLessThan(skillEntry);
    expect(skillEntry).toBeLessThan(contextEntry);
    expect(runtimeBarSource).toContain('runtimeId={runtimeId}');
    expect(runtimeBarSource).toContain('projectId={activeProjectId}');
    expect(promptPopoverSource).toContain('<TextQuote className="size-3.5" />');
    expect(runtimeBarSource).toContain('<Blocks className="size-3.5" />');
  });

  it('keeps user, project, and enterprise tabs while reusing atomic injection controls', () => {
    expect(promptPopoverSource).toContain('value="user"');
    expect(promptPopoverSource).toContain('value="project"');
    expect(promptPopoverSource).toContain('value="enterprise"');
    expect(promptPopoverSource).not.toContain('<PromptScopeSummary');
    expect(promptPopoverSource).not.toContain('workspaceRuntime.prompt.description');
    expect(promptPopoverSource).toContain("t('promptLibrary.tabs.dynamic')");
    expect(promptPopoverSource).toContain('h-[min(54vh,26rem)]');
    expect(promptPopoverSource).toContain('w-[min(22rem,calc(100vw-1rem))]');
    expect(promptPopoverSource).toContain('h-full min-h-0 overflow-y-auto');
    expect(promptPopoverSource).toContain('<PromptInstructionFilesEditor');
    expect(promptPopoverSource).toContain('initiallyExpanded');
    expect(promptPopoverSource).toContain('compact');
    expect(promptPopoverSource).toContain('<PromptInjectionControls');
    expect(promptPopoverSource).toContain('setGlobalOverride');
    expect(promptPopoverSource).toContain('<DynamicPromptAddForm');
    expect(promptPopoverSource).toContain('useCreatePrompt');

    const fileSection = promptPopoverSource.indexOf(
      'data-slot={`workspace-prompt-${scope}-files`}'
    );
    const dynamicSection = promptPopoverSource.indexOf(
      'data-slot={`workspace-prompt-${scope}-injection`}'
    );
    expect(fileSection).toBeGreaterThan(-1);
    expect(dynamicSection).toBeGreaterThan(fileSection);
  });
});
