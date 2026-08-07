import { buildPromptInjectionPayload } from '@shared/agent-command-prefix';
import type { RuntimeId } from '@shared/runtime-registry';

type MobileSessionInputTarget = {
  conversationId: string;
  projectId: string;
  runtime: RuntimeId;
  taskId: string;
};

export type SubmitMobileSessionInputParams = {
  imagePaths: string[];
  input: string;
  submit: boolean;
  target: MobileSessionInputTarget;
  injectPrompt: (
    params: MobileSessionInputTarget & {
      imagePaths: string[];
      prompt: string;
    }
  ) => Promise<boolean>;
  writeInput: (data: string) => Promise<boolean>;
};

/**
 * Submitted input uses the canonical conversation injector, which owns
 * provider command suffixes, the minimum paste/Enter delay, and the immediate
 * Working transition. `submit: false` remains a raw typing operation.
 */
export function submitMobileSessionInput({
  imagePaths,
  input,
  submit,
  target,
  injectPrompt,
  writeInput,
}: SubmitMobileSessionInputParams): Promise<boolean> {
  if (!submit) return writeInput(buildPromptInjectionPayload(input));
  return injectPrompt({ ...target, imagePaths, prompt: input });
}
