import { ClipboardCopy, FileText, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipContextMenu } from '@renderer/lib/components/chip-context-menu';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { ContextMenuItem } from '@renderer/lib/ui/context-menu';
import type { TerminalStore } from './terminal-manager';

type TerminalLogCopyTarget = 'path' | 'content' | 'info';

export function TerminalLogContextMenu({
  terminal,
  children,
}: {
  terminal: TerminalStore | null | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!terminal) return <>{children}</>;

  return (
    <ChipContextMenu
      sections={[
        [
          <ContextMenuItem
            key="copy-log-path"
            onClick={() => void copyTerminalLogValue(terminal, 'path', t)}
          >
            <ClipboardCopy />
            {t('tasks.terminals.copyLogPath')}
          </ContextMenuItem>,
          <ContextMenuItem
            key="copy-log-content"
            onClick={() => void copyTerminalLogValue(terminal, 'content', t)}
          >
            <FileText />
            {t('tasks.terminals.copyLogContent')}
          </ContextMenuItem>,
          <ContextMenuItem
            key="copy-terminal-info"
            onClick={() => void copyTerminalLogValue(terminal, 'info', t)}
          >
            <Info />
            {t('tasks.terminals.copyInfo')}
          </ContextMenuItem>,
        ],
      ]}
    >
      {children}
    </ChipContextMenu>
  );
}

type Translate = (key: string) => string;
type ExportedTerminalLog = Extract<
  Awaited<ReturnType<typeof rpc.pty.exportTerminalLog>>,
  { success: true }
>['data'];

async function copyTerminalLogValue(
  terminal: TerminalStore,
  target: TerminalLogCopyTarget,
  t: Translate
): Promise<void> {
  try {
    const exported = await rpc.pty.exportTerminalLog(terminal.session.sessionId);
    if (!exported.success) throw new Error(resultErrorMessage(exported.error));

    if (target === 'content' && exported.data.content.length === 0) {
      toast({ title: t('tasks.terminals.logEmpty') });
      return;
    }

    const value =
      target === 'path'
        ? exported.data.path
        : target === 'content'
          ? exported.data.content
          : formatTerminalInfo(terminal, exported.data, t);
    const copied = await rpc.app.clipboardWriteText(value);
    if (!copied?.success) throw new Error(copied?.error || t('common.copyFailed'));

    toast({
      title: t(
        target === 'path'
          ? 'tasks.terminals.logPathCopied'
          : target === 'content'
            ? 'tasks.terminals.logContentCopied'
            : 'tasks.terminals.infoCopied'
      ),
    });
  } catch (error) {
    toast({
      title: t('tasks.terminals.logCopyFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  }
}

function formatTerminalInfo(
  terminal: TerminalStore,
  log: ExportedTerminalLog,
  t: Translate
): string {
  return [
    `${t('tasks.terminals.infoName')}: ${terminal.data.name}`,
    `${t('tasks.terminals.infoTerminalId')}: ${terminal.data.id}`,
    `${t('tasks.terminals.infoSessionId')}: ${terminal.session.sessionId}`,
    `${t('tasks.terminals.infoProjectId')}: ${terminal.data.projectId}`,
    `${t('tasks.terminals.infoTaskId')}: ${terminal.data.taskId}`,
    `${t('tasks.terminals.infoLogPath')}: ${log.path}`,
    `${t('tasks.terminals.infoCapturedAt')}: ${log.capturedAt}`,
    `${t('tasks.terminals.infoContentBytes')}: ${log.contentBytes}`,
    `${t('tasks.terminals.infoBufferBytes')}: ${log.ringBufferBytes}/${log.ringBufferCapBytes}`,
  ].join('\n');
}

function resultErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    const type = (error as { type?: unknown }).type;
    if (typeof type === 'string') return type;
  }
  return String(error);
}
