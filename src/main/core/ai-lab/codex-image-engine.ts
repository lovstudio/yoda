import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runAgentCli } from '@main/core/agent-cli/run-agent-cli';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';

/** Image generation runs a full agent loop per image — give it real headroom. */
const CODEX_IMAGE_TIMEOUT_MS = 6 * 60_000;

/**
 * Generates logo images by spawning `codex exec` in a scratch directory and
 * asking it to use its built-in image generation tool (gpt-image-2). Codex
 * writes generated images to ~/.codex/generated_images first, so the prompt
 * instructs it to copy the finals into the working directory, which we read.
 */
export async function generateCodexImages(input: {
  prompt: string;
  count: number;
  workDir: string;
}): Promise<Buffer[]> {
  const instruction = [
    input.prompt,
    '',
    `Generate ${input.count} distinct candidate image(s) for the logo described above using your built-in image generation tool.`,
    `Save each final image into the current working directory as logo-1.png${
      input.count > 1 ? ` through logo-${input.count}.png` : ''
    } (PNG format).`,
    'Do not create any other files. Do not ask questions.',
  ].join('\n');

  await runAgentCli({
    command: 'codex',
    args: [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--color',
      'never',
      '-',
    ],
    stdin: instruction,
    cwd: input.workDir,
    env: buildExternalToolEnv(process.env),
    timeoutMs: CODEX_IMAGE_TIMEOUT_MS,
    runtimeName: 'Codex',
  });

  const fileNames = (await readdir(input.workDir)).filter((name) => /\.png$/i.test(name)).sort();
  if (fileNames.length === 0) {
    throw new Error('Codex finished without producing any PNG image.');
  }
  const buffers = await Promise.all(
    fileNames.slice(0, input.count).map((name) => readFile(join(input.workDir, name)))
  );
  return buffers;
}
