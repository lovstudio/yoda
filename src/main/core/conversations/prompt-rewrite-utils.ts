import type { TaskOutputLanguage } from '@shared/project-settings';

export type PromptRewriteTargetLanguage = 'en' | 'zh-CN';

export function resolvePromptRewriteTargetLanguage(
  language: TaskOutputLanguage,
  appLanguage?: PromptRewriteTargetLanguage | null
): PromptRewriteTargetLanguage | null {
  if (language === 'skip') return null;
  if (language === 'en' || language === 'zh-CN') return language;
  if (language === 'app') return appLanguage ?? null;
  return null;
}

export function buildPromptRewritePrompt(input: {
  prompt: string;
  targetLanguage: PromptRewriteTargetLanguage;
  systemPrompt?: string;
}): string {
  const target = input.targetLanguage === 'zh-CN' ? 'Simplified Chinese' : 'English';
  const basePrompt = [
    `Rewrite the user's prompt in ${target}.`,
    'Preserve the exact intent, constraints, ordering, and technical specificity.',
    'Preserve code blocks, inline code, commands, file paths, URLs, identifiers, @mentions, and {{placeholder}} tokens exactly.',
    'Do not add advice, explanations, markdown fences, quotes, or any preamble.',
    'Output only the rewritten prompt text.',
    '',
    'User prompt:',
    input.prompt,
  ].join('\n');
  const systemPrompt = input.systemPrompt?.trim();
  return systemPrompt ? `${systemPrompt}\n\n${basePrompt}` : basePrompt;
}

export function cleanRewrittenPrompt(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```$/);
  return (fenced?.[1] ?? trimmed).trim();
}
