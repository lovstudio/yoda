import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('new task modal responsive contract', () => {
  it('keeps the compact modal and shared Home composer wiring explicit', () => {
    const registry = readFileSync(new URL('./modal-registry.ts', import.meta.url), 'utf8');
    const renderer = readFileSync(
      new URL('../lib/modal/modal-renderer.tsx', import.meta.url),
      'utf8'
    );
    const modal = readFileSync(new URL('./new-task-modal.tsx', import.meta.url), 'utf8');
    const conversationModal = readFileSync(
      new URL('./new-conversation-modal.tsx', import.meta.url),
      'utf8'
    );
    const home = readFileSync(new URL('./home-view.tsx', import.meta.url), 'utf8');

    expect(registry).toContain(
      "newTaskModal: createModal(NewTaskModal, { size: 'lg', className: 'sm:max-w-3xl' })"
    );
    expect(renderer).toContain('entry?.className');
    expect(modal).toContain('data-yoda-surface="new-task-modal"');
    expect(modal).toContain('data-yoda-composer-modal');
    expect(conversationModal).toContain('data-yoda-surface="new-conversation-modal"');
    expect(conversationModal).toContain('data-yoda-composer-modal');
    expect(modal).toContain('<HomeComposer onSubmitted={onClose} />');
    expect(modal).not.toContain('onProjectRevealed');
    expect(home).toContain('data-yoda-surface="home-composer-session-settings"');
    expect(home).toContain('data-yoda-surface="home-composer-compare-action"');
    expect(home).toContain('data-yoda-surface="home-composer-environment"');
    expect(home).toContain('branchConfiguration={environmentBranchConfiguration}');
    expect(home).toContain('branchConfiguration={branchConfiguration}');
    expect(home).not.toContain('function RunHostSelector(');
    expect(home).not.toContain('function BaseBranchChip(');
    expect(home).not.toContain('function ForkSwitchChip(');
    expect(home).toContain('<ProjectBranchMenuItems');
    expect(home).toContain('<DropdownMenuSub');
    expect(home).toContain('<Switch');
    expect(home).not.toContain('<DropdownMenuCheckboxItem');
    // Gated on the selected paradigm's kind, not the persisted run mode: editing a
    // roster can move a paradigm between kinds, and the mode only seeds the pick.
    expect(home).toContain(
      "{!taskScopedTarget && activeKind.kindId === 'single' && renderAddCompareButton()}"
    );
    expect(home).not.toContain('data-yoda-surface="home-composer-actions"');
  });
});
