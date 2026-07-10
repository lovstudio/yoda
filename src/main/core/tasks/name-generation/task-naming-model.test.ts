import { describe, expect, it } from 'vitest';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import {
  normalizeTaskNamingModelForProvider,
  resolveCurrentAgentModel,
  resolvePreferredTaskNamingModel,
} from './task-naming-model';

describe('resolveCurrentAgentModel', () => {
  it('uses the persisted runtime default when no launch arg overrides it', () => {
    expect(resolveCurrentAgentModel(config({ defaultModel: 'gpt-5.6-codex' }))).toBe(
      'gpt-5.6-codex'
    );
  });

  it('reads --model from extra args', () => {
    expect(resolveCurrentAgentModel(config({ extraArgs: '--model claude-sonnet-4-6' }))).toBe(
      'claude-sonnet-4-6'
    );
  });

  it('reads inline and short model flags', () => {
    expect(resolveCurrentAgentModel(config({ extraArgs: '--model=gpt-5-mini' }))).toBe(
      'gpt-5-mini'
    );
    expect(resolveCurrentAgentModel(config({ extraArgs: '-m o4-mini' }))).toBe('o4-mini');
  });

  it('prefers the last launch model flag', () => {
    expect(
      resolveCurrentAgentModel(
        config({
          defaultArgs: ['--model', 'default-model'],
          extraArgs: '--model override-model',
        })
      )
    ).toBe('override-model');
  });

  it('reads model from custom cli prefixes', () => {
    expect(resolveCurrentAgentModel(config({ cli: 'codex --model gpt-5' }))).toBe('gpt-5');
  });

  it('reads model key-value args', () => {
    expect(resolveCurrentAgentModel(config({ extraArgs: 'model=sonnet' }))).toBe('sonnet');
    expect(resolveCurrentAgentModel(config({ extraArgs: 'model-id=claude-haiku-4-5' }))).toBe(
      'claude-haiku-4-5'
    );
  });
});

describe('resolvePreferredTaskNamingModel', () => {
  it('prefers agent naming override over current agent model', () => {
    expect(
      resolvePreferredTaskNamingModel({
        agentNamingModel: 'rename-model',
        currentAgentModel: 'current-model',
        fallbackNamingModel: 'fallback-model',
        inferredNamingModel: 'inferred-model',
      })
    ).toBe('rename-model');
  });

  it('uses current agent model before global fallback', () => {
    expect(
      resolvePreferredTaskNamingModel({
        currentAgentModel: 'current-model',
        fallbackNamingModel: 'fallback-model',
        inferredNamingModel: 'inferred-model',
      })
    ).toBe('current-model');
  });

  it('falls back after current agent model is unavailable', () => {
    expect(
      resolvePreferredTaskNamingModel({
        fallbackNamingModel: 'fallback-model',
        inferredNamingModel: 'inferred-model',
      })
    ).toBe('fallback-model');
  });
});

describe('normalizeTaskNamingModelForProvider', () => {
  it('drops Codex chat-latest because codex exec rejects it for ChatGPT accounts', () => {
    expect(normalizeTaskNamingModelForProvider('codex', 'chat-latest')).toBe('');
  });

  it('keeps supported Codex model ids', () => {
    expect(normalizeTaskNamingModelForProvider('codex', 'gpt-5.5')).toBe('gpt-5.5');
  });

  it('does not apply Codex aliases to other providers', () => {
    expect(normalizeTaskNamingModelForProvider('claude', 'chat-latest')).toBe('chat-latest');
  });
});

function config(overrides: Partial<RuntimeCustomConfig>): RuntimeCustomConfig {
  return {
    cli: 'agent',
    ...overrides,
  };
}
