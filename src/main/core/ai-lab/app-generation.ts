import { runAgentCli } from '@main/core/agent-cli/run-agent-cli';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import {
  buildAppGenerationPrompt,
  parseGeneratedAiLabApp,
  type GeneratedAiLabApp,
} from './app-generation-contract';

const APP_GENERATION_TIMEOUT_MS = 3 * 60_000;

export async function generateAiLabApp(prompt: string): Promise<GeneratedAiLabApp> {
  const codexPath = await resolveCommandPath('codex', new LocalExecutionContext());
  if (!codexPath) throw new Error('Codex CLI is not installed or signed in.');

  const result = await runAgentCli({
    command: codexPath,
    args: [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '-',
    ],
    stdin: buildAppGenerationPrompt(prompt),
    cwd: process.cwd(),
    env: buildExternalToolEnv(process.env),
    timeoutMs: APP_GENERATION_TIMEOUT_MS,
    runtimeName: 'Codex',
    purpose: 'ai-lab-app-generation',
    metadata: { promptChars: String(prompt.length) },
  });
  return parseGeneratedAiLabApp(result.stdout);
}
