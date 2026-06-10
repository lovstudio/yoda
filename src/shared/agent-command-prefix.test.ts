import { describe, expect, it } from 'vitest';
import {
  applyAgentCommandPrefix,
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
  getAgentCommandSubmitSuffix,
} from './agent-command-prefix';

describe('applyAgentCommandPrefix', () => {
  it('rewrites Claude-style commands for Codex', () => {
    expect(applyAgentCommandPrefix('codex', '/release-via-cicd')).toBe('$release-via-cicd');
  });

  it('rewrites Codex-style commands for Claude', () => {
    expect(applyAgentCommandPrefix('claude', '$release-via-cicd')).toBe('/release-via-cicd');
  });

  it('adds the provider command prefix to bare command names', () => {
    expect(applyAgentCommandPrefix('codex', 'lovstudio-git-commit-with-context  ')).toBe(
      '$lovstudio-git-commit-with-context'
    );
    expect(applyAgentCommandPrefix('codex', 'lovstudio:git-commit-with-context')).toBe(
      '$lovstudio:git-commit-with-context'
    );
    expect(applyAgentCommandPrefix('claude', 'lovstudio-git-commit-with-context  ')).toBe(
      '/lovstudio-git-commit-with-context'
    );
  });

  it('adds the prefix to versioned skill ids containing dots', () => {
    expect(applyAgentCommandPrefix('claude', 'skill-creator-0.1.0')).toBe('/skill-creator-0.1.0');
    expect(applyAgentCommandPrefix('codex', 'skill-creator-0.1.0')).toBe('$skill-creator-0.1.0');
  });

  it('leaves arbitrary prompts unchanged', () => {
    expect(applyAgentCommandPrefix('codex', 'Review the release changes')).toBe(
      'Review the release changes'
    );
  });

  it('does not rewrite shell-like input with a space after the prefix', () => {
    expect(applyAgentCommandPrefix('codex', '$ echo hi')).toBe('$ echo hi');
  });

  it('leaves providers without a command prefix unchanged', () => {
    expect(applyAgentCommandPrefix('gemini', '/help')).toBe('/help');
  });
});

describe('getAgentCommandSubmitSuffix', () => {
  it('adds a space suffix for Codex compact commands', () => {
    expect(getAgentCommandSubmitSuffix('codex', '$release-via-cicd')).toBe(' ');
    expect(getAgentCommandSubmitSuffix('codex', '$lovstudio:git-commit-with-context')).toBe(' ');
  });

  it('does not add a suffix when the command already has arguments', () => {
    expect(getAgentCommandSubmitSuffix('codex', '$release-via-cicd --dry-run')).toBe('');
  });

  it('does not add a suffix for shell-like Codex input', () => {
    expect(getAgentCommandSubmitSuffix('codex', '$ echo hi')).toBe('');
  });

  it('does not add a suffix for providers that do not require one', () => {
    expect(getAgentCommandSubmitSuffix('claude', '/release-via-cicd')).toBe('');
  });
});

describe('getAgentCommandSubmitDelayMs', () => {
  it('delays Codex submission to avoid paste-burst newline handling', () => {
    expect(getAgentCommandSubmitDelayMs('codex')).toBeGreaterThan(0);
  });

  it('does not delay providers without paste-burst handling', () => {
    expect(getAgentCommandSubmitDelayMs('claude')).toBe(0);
  });
});

describe('getAgentCommandSubmitInput', () => {
  it('uses carriage return for Codex injected command submission', () => {
    expect(getAgentCommandSubmitInput('codex')).toBe('\r');
  });

  it('uses carriage return for providers without custom submission input', () => {
    expect(getAgentCommandSubmitInput('claude')).toBe('\r');
  });
});

describe('buildPromptInjectionPayload', () => {
  it('trims single-line prompt input', () => {
    expect(buildPromptInjectionPayload('  Review this  ')).toBe('Review this');
  });

  it('wraps multiline input in bracketed paste', () => {
    expect(buildPromptInjectionPayload('line one\nline two')).toBe(
      '\x1b[200~line one\nline two\x1b[201~'
    );
  });
});
