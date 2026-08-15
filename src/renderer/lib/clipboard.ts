import type { TFunction } from 'i18next';
import { toast } from '@renderer/lib/hooks/use-toast';

/** Copy `value` to the clipboard, toasting the given success/failure messages. */
export async function copyText(
  value: string,
  t: TFunction,
  messages: { success: string; failure: string }
): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: messages.success });
  } catch {
    toast({
      title: t('auth.copyFailed'),
      description: messages.failure,
      variant: 'destructive',
    });
  }
}

/**
 * Copy a `yoda://` deep link. Shared by every entity that can be linked (task,
 * conversation, project) so the confirmation toast reads the same everywhere.
 */
export async function copyYodaLink(link: string, t: TFunction): Promise<void> {
  await copyText(link, t, {
    success: t('tasks.context.yodaLinkCopied'),
    failure: t('tasks.context.copyFailed'),
  });
}
