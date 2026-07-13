export async function resolveSubmitRequirement(input: {
  rawRequirement: string;
  rewriteRequirement: (value: string) => Promise<string>;
  onRewriteFailure: (error: unknown) => void;
}): Promise<string> {
  try {
    return await input.rewriteRequirement(input.rawRequirement);
  } catch (error) {
    input.onRewriteFailure(error);
    return input.rawRequirement;
  }
}

export function promptRewriteFailureDescription(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
