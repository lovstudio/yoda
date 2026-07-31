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
    const home = readFileSync(new URL('./home-view.tsx', import.meta.url), 'utf8');

    expect(registry).toContain(
      "newTaskModal: createModal(NewTaskModal, { size: 'lg', className: 'sm:max-w-3xl' })"
    );
    expect(renderer).toContain('displayEntry?.className');
    expect(modal).toContain('data-yoda-surface="new-task-modal"');
    expect(modal).toContain('<HomeComposer onProjectRevealed={onClose} onSubmitted={onClose} />');
    expect(home).toContain('data-yoda-surface="home-composer-session-settings"');
    expect(home).toContain('data-yoda-surface="home-composer-compare-action"');
    expect(home).not.toContain('data-yoda-surface="home-composer-actions"');
  });
});
