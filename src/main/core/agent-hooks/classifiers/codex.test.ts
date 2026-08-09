import { describe, expect, it } from 'vitest';
import { createCodexClassifier } from './codex';

describe('createCodexClassifier', () => {
  it('recognizes the command approval prompt shown by the Codex TUI', () => {
    const classifier = createCodexClassifier();

    expect(
      classifier.classify('Would you like to run the following command?\n\n› 1. Yes, proceed (y)\n')
    ).toEqual({
      type: 'notification',
      notificationType: 'permission_prompt',
      message: 'Codex 正在等待你确认执行操作',
    });
  });

  it('recognizes file-change approval prompts across PTY chunks', () => {
    const classifier = createCodexClassifier();

    expect(classifier.classify('Would you like to make the following ')).toBeUndefined();
    expect(classifier.classify('edits?')).toEqual({
      type: 'notification',
      notificationType: 'permission_prompt',
      message: 'Codex 正在等待你确认执行操作',
    });
  });

  it('does not retain a confirmed prompt in the sliding buffer after reset', () => {
    const classifier = createCodexClassifier();

    expect(classifier.classify('Would you like to run the following command?')).toBeDefined();
    classifier.reset();

    expect(
      classifier.classify('The command completed and the session is working again.')
    ).toBeUndefined();
  });

  it('does not turn ordinary Codex output into an approval state', () => {
    const classifier = createCodexClassifier();

    expect(classifier.classify('Running tests...\nAll tests passed.')).toBeUndefined();
  });
});
