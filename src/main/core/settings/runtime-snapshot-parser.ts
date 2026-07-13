import { parse as parseToml } from 'smol-toml';

export type ParsedRuntimeConfig = {
  model: string | null;
  provider: string | null;
};

export type CodexVersionInfo = {
  latestVersion: string | null;
  lastCheckedAt: string | null;
};

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseRuntimeConfigText(filePath: string, input: string): ParsedRuntimeConfig {
  try {
    const config = filePath.endsWith('.toml')
      ? (parseToml(input) as Record<string, unknown>)
      : filePath.endsWith('.json') || filePath.endsWith('.jsonc')
        ? (JSON.parse(input.replace(/^\s*\/\/.*$/gm, '')) as Record<string, unknown>)
        : null;
    if (config) {
      const model =
        stringValue(config.model) ??
        stringValue(config.defaultModel) ??
        stringValue(config.default_model) ??
        stringValue(recordValue(config.models)?.default);
      const provider =
        stringValue(config.model_provider) ??
        stringValue(config.modelProvider) ??
        stringValue(config.provider);
      return { model, provider };
    }
  } catch {
    return { model: null, provider: null };
  }

  // YAML and unknown text configs: only accept simple scalar keys. Never send
  // full config content to the renderer.
  const model = /^\s*(?:model|default_model)\s*:\s*["']?([^\s#"']+)/im.exec(input)?.[1] ?? null;
  const provider =
    /^\s*(?:model_provider|provider)\s*:\s*["']?([^\s#"']+)/im.exec(input)?.[1] ?? null;
  return { model, provider };
}

export function parseCodexVersionInfo(input: string): CodexVersionInfo {
  try {
    const value = JSON.parse(input) as Record<string, unknown>;
    return {
      latestVersion: stringValue(value.latest_version),
      lastCheckedAt: stringValue(value.last_checked_at),
    };
  } catch {
    return { latestVersion: null, lastCheckedAt: null };
  }
}

function numericVersion(version: string): number[] | null {
  const match = version.match(/\d+(?:\.\d+)+/);
  return match ? match[0].split('.').map(Number) : null;
}

export function isNewerVersion(latest: string, current: string): boolean {
  const left = numericVersion(latest);
  const right = numericVersion(current);
  if (!left || !right) return false;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
