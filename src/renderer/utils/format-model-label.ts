/**
 * Humanize a model id for display, e.g. `claude-opus-4-8` → `Opus 4.8`.
 *
 * Falls back to the raw id when the shape is unfamiliar. `null` (meaning "the
 * runtime's own default") is the caller's to label, not this function's.
 */
export function formatModelLabel(model: string): string {
  const known = ['opus', 'sonnet', 'haiku', 'gpt', 'gemini', 'qwen', 'kimi', 'mistral'];
  const segments = model.split(/[-_]/).filter(Boolean);
  const tierIndex = segments.findIndex((segment) => known.includes(segment.toLowerCase()));
  if (tierIndex === -1) return model;
  const tier = segments[tierIndex];
  const version = segments
    .slice(tierIndex + 1)
    .filter((segment) => /\d/.test(segment))
    .join('.');
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  return version ? `${tierLabel} ${version}` : tierLabel;
}
