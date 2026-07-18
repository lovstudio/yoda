export const AI_LAB_WINDOW_TARGET_PARAM = 'aiLabWindowTarget';

/** A detached window that hosts one persisted AI Lab user app. */
export type AiLabWindowTarget = {
  appId: string;
};

export function encodeAiLabWindowTarget(target: AiLabWindowTarget): string {
  return JSON.stringify(target);
}

export function parseAiLabWindowTargetSearch(search: string): AiLabWindowTarget | null {
  return parseAiLabWindowTargetParam(new URLSearchParams(search).get(AI_LAB_WINDOW_TARGET_PARAM));
}

export function parseAiLabWindowTargetParam(
  raw: string | null | undefined
): AiLabWindowTarget | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAiLabWindowTarget(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isAiLabWindowTarget(value: unknown): value is AiLabWindowTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).appId === 'string' &&
    ((value as Record<string, unknown>).appId as string).trim().length > 0
  );
}
