import type { SkillSelectionInput } from './types';

/**
 * Legacy empty Agent skill profiles mean "use the runtime defaults". A user
 * choosing an explicit allowlist keeps that restriction even when it is empty.
 */
export function normalizeSkillSelection(
  selection: SkillSelectionInput | null | undefined
): SkillSelectionInput | undefined {
  if (!selection) return undefined;
  if (selection.restriction === 'allowlist') return selection;
  if (selection.autoSkillKeys.length === 0 && selection.manualSkillKeys.length === 0) {
    return undefined;
  }
  return selection;
}
