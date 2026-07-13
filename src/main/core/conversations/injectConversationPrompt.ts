import { eq } from 'drizzle-orm';
import { makePtySessionId } from '@shared/ptySessionId';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { injectClipboardImagesAndPrompt, substituteImageMentions } from './impl/image-attachments';
import { injectPrompt } from './inject-prompt';

const PTY_WAIT_TIMEOUT_MS = 10_000;
const PTY_WAIT_INTERVAL_MS = 100;

export type InjectConversationPromptParams = {
  projectId: string;
  taskId: string;
  conversationId: string;
  runtime: RuntimeId;
  prompt?: string;
  imagePaths?: string[];
};

export async function injectConversationPrompt(
  params: InjectConversationPromptParams
): Promise<boolean> {
  const session = {
    projectId: params.projectId,
    taskId: params.taskId,
    conversationId: params.conversationId,
  };
  const sessionId = makePtySessionId(params.projectId, params.taskId, params.conversationId);
  const pty = await waitForPtySession(sessionId);
  if (!pty) return false;

  const prompt = params.prompt ?? '';
  const imagePaths = params.imagePaths?.filter((path) => path.trim().length > 0) ?? [];
  if (imagePaths.length === 0) {
    return injectPrompt(sessionId, session, params.runtime, prompt);
  }

  const localClipboardPaste = await canUseLocalClipboardImagePaste(
    params.projectId,
    params.runtime
  );
  if (localClipboardPaste) {
    agentSessionRuntimeStore.setStatus(session, 'working');
    await injectClipboardImagesAndPrompt({
      pty,
      runtimeId: params.runtime,
      imagePaths,
      prompt,
    });
    return true;
  }

  return injectPrompt(
    sessionId,
    session,
    params.runtime,
    substituteImageMentions(prompt, imagePaths) ?? ''
  );
}

async function canUseLocalClipboardImagePaste(
  projectId: string,
  runtime: RuntimeId
): Promise<boolean> {
  if (!getRuntime(runtime)?.clipboardImagePaste) return false;
  const [project] = await db
    .select({ workspaceProvider: projects.workspaceProvider })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project?.workspaceProvider === 'local';
}

async function waitForPtySession(
  sessionId: string
): Promise<ReturnType<typeof ptySessionRegistry.get>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PTY_WAIT_TIMEOUT_MS) {
    const pty = ptySessionRegistry.get(sessionId);
    if (pty) return pty;
    await sleep(PTY_WAIT_INTERVAL_MS);
  }
  return ptySessionRegistry.get(sessionId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
