/** Base-URL overrides Yoda injects into a provider CLI's environment. */
const ENDPOINT_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'OPENROUTER_BASE_URL'] as const;

/**
 * The endpoint host Yoda pointed a run at, or undefined when Yoda injected no
 * override.
 *
 * Deliberately reports only what this process set. With no override the CLI
 * reads its own configuration (`~/.claude/settings.json`, `CODEX_HOME`), which
 * Yoda never parses — so labelling that case "official endpoint" would be a
 * guess, and a wrong badge is worse for trust than an absent one.
 */
export function describeInvocationEndpoint(
  env: NodeJS.ProcessEnv | Record<string, string> | undefined
): string | undefined {
  if (!env) return undefined;
  for (const key of ENDPOINT_ENV_KEYS) {
    const value = env[key]?.trim();
    if (!value) continue;
    try {
      return new URL(value).host;
    } catch {
      return value;
    }
  }
  return undefined;
}
