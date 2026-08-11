import type { Conversation } from '@shared/conversations';

const operationTails = new Map<string, Promise<void>>();

function operationKey(conversation: Pick<Conversation, 'projectId' | 'id'>): string {
  return `${conversation.projectId}:${conversation.id}`;
}

/** Serialize lifecycle and delivery mutations for one stable conversation. */
export async function withConversationOperation<T>(
  conversation: Pick<Conversation, 'projectId' | 'id'>,
  operation: () => Promise<T>
): Promise<T> {
  const key = operationKey(conversation);
  const previous = operationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => completion);
  operationTails.set(key, tail);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (operationTails.get(key) === tail) operationTails.delete(key);
  }
}
