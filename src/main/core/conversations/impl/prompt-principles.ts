import { appSettingsService } from '@main/core/settings/settings-service';

/**
 * Joins the user's enabled prompt principles (Settings → Prompts) into the
 * text appended after the runtime's system prompt at spawn. Returns undefined
 * when nothing is enabled so callers can skip the flag entirely.
 */
export async function getEnabledPromptPrinciplesText(): Promise<string | undefined> {
  const { items } = await appSettingsService.get('promptPrinciples');
  const enabled = items.filter((item) => item.enabled && item.text.trim().length > 0);
  if (enabled.length === 0) return undefined;
  return enabled.map((item) => item.text.trim()).join('\n\n');
}
