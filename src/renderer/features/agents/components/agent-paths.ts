import type { RuntimeId } from '@shared/runtime-registry';

export type AgentPaths = {
  config?: string;
  memory?: string;
  hooks?: string;
  skills?: string;
  settings?: string;
};

/**
 * Best-effort mapping from a provider id to the canonical local config locations.
 * Paths are returned with the literal `~` prefix — call `expandHome` before passing
 * them to `rpc.app.openIn` so the shell can resolve them.
 */
export function resolveAgentPaths(id: RuntimeId): AgentPaths {
  switch (id) {
    case 'claude':
      return {
        config: '~/.claude',
        memory: '~/.claude/CLAUDE.md',
        hooks: '~/.claude/settings.json',
        skills: '~/.claude/skills',
        settings: '~/.claude/settings.json',
      };
    case 'codex':
      return {
        config: '~/.codex',
        memory: '~/.codex/AGENTS.md',
        skills: '~/.codex/skills',
        settings: '~/.codex/config.toml',
      };
    case 'gemini':
      return {
        config: '~/.gemini',
        memory: '~/.gemini/GEMINI.md',
        skills: '~/.gemini/skills',
        settings: '~/.gemini/settings.json',
      };
    case 'cursor':
      return {
        config: '~/.cursor',
        memory: '~/.cursor/rules',
        skills: '~/.cursor/skills',
        settings: '~/.cursor/config.json',
      };
    case 'opencode':
      return {
        config: '~/.config/opencode',
        skills: '~/.config/opencode/skills',
        settings: '~/.config/opencode/config.json',
      };
    case 'qwen':
      return {
        config: '~/.qwen',
        memory: '~/.qwen/QWEN.md',
        settings: '~/.qwen/settings.json',
      };
    case 'mistral':
      return {
        config: '~/.vibe',
        skills: '~/.vibe/skills',
        settings: '~/.vibe/config.json',
      };
    case 'devin':
      return { config: '~/.devin', settings: '~/.devin/config.json' };
    case 'droid':
      return { config: '~/.factory', settings: '~/.factory/config.json' };
    case 'amp':
      return { config: '~/.amp', settings: '~/.amp/config.json' };
    case 'copilot':
      return {
        config: '~/.config/github-copilot',
        settings: '~/.config/github-copilot/config.json',
      };
    case 'charm':
      return { config: '~/.config/crush' };
    case 'auggie':
      return { config: '~/.augment' };
    case 'goose':
      return { config: '~/.config/goose', settings: '~/.config/goose/config.yaml' };
    case 'kimi':
      return { config: '~/.kimi', settings: '~/.kimi/config.json' };
    case 'kilocode':
      return { config: '~/.kilocode' };
    case 'kiro':
      return { config: '~/.kiro' };
    case 'rovo':
      return { config: '~/.rovodev' };
    case 'cline':
      return { config: '~/.cline' };
    case 'continue':
      return { config: '~/.continue', settings: '~/.continue/config.yaml' };
    case 'codebuff':
      return { config: '~/.codebuff' };
    case 'jules':
      return { config: '~/.jules' };
    case 'junie':
      return { config: '~/.junie' };
    case 'pi':
      return { config: '~/.config/pi' };
    case 'letta':
      return { config: '~/.letta', memory: '~/.letta/memory' };
    case 'autohand':
      return { config: '~/.autohand' };
    case 'hermes':
      return { config: '~/.hermes' };
    case 'antigravity':
      return { config: '~/.antigravity' };
    case 'grok':
      return { config: '~/.grok' };
  }
}

export function expandHome(path: string, home: string): string {
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`;
  if (path === '~') return home;
  return path;
}
