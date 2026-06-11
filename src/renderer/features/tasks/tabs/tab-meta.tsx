import { GitCompare, LayoutDashboard, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TaskWindowBounds, TaskWindowTarget } from '@shared/task-window';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { GitChangeStatusIcon } from '@renderer/features/tasks/diff-view/changes-panel/components/changes-list-item';
import type { ResolvedDiffTab, ResolvedTab } from '@renderer/features/tasks/tabs/tab-manager-store';
import { splitPath } from '@renderer/features/tasks/utils';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { rpc } from '@renderer/lib/ipc';
import { agentConfig } from '@renderer/utils/agentConfig';

export function getTabMeta(tab: ResolvedTab): {
  icon: ReactNode;
  label: string;
  detail?: string;
  title: string;
} {
  if (tab.kind === 'overview') {
    const label = i18n.t('tasks.tabs.overview');
    return { icon: <LayoutDashboard className="size-3.5" />, label, title: label };
  }

  if (tab.kind === 'conversation') {
    const runtimeId = tab.store.data.runtimeId;
    const config = agentConfig[runtimeId];
    const label =
      formatConversationTitleForDisplay(runtimeId, tab.store.data.title).trim() ||
      config?.name ||
      runtimeId;
    return {
      icon: config ? (
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-3.5"
        />
      ) : (
        <MessageSquare className="size-3.5" />
      ),
      label,
      title: label,
    };
  }

  const { filename, directory } = splitPath(tab.path);
  if (tab.kind === 'file') {
    return {
      icon: <FileIcon filename={filename} size={13} />,
      label: filename,
      detail: directory,
      title: tab.path,
    };
  }

  return {
    icon: tab.status ? (
      <GitChangeStatusIcon status={tab.status} className="size-3.5" />
    ) : (
      <GitCompare className="size-3.5 text-foreground-passive" />
    ),
    label: filename,
    detail: directory || diffGroupLabel(tab.diffGroup),
    title: tab.path,
  };
}

function diffGroupLabel(group: ResolvedDiffTab['diffGroup']): string {
  switch (group) {
    case 'disk':
      return 'Changed';
    case 'staged':
      return 'Staged';
    case 'pr':
      return 'PR';
    case 'git':
      return 'Git';
  }
}

export function buildTaskWindowTarget(
  projectId: string,
  taskId: string,
  tab: ResolvedTab
): TaskWindowTarget {
  const base = { projectId, taskId };
  switch (tab.kind) {
    case 'overview':
      return { ...base, tab: { kind: 'overview' } };
    case 'conversation':
      return { ...base, tab: { kind: 'conversation', conversationId: tab.conversationId } };
    case 'file':
      return { ...base, tab: { kind: 'file', path: tab.path } };
    case 'diff':
      return {
        ...base,
        tab: {
          kind: 'diff',
          path: tab.path,
          diffGroup: tab.diffGroup,
          originalRef: tab.originalRef,
          modifiedRef: tab.modifiedRef,
          prNumber: tab.prNumber,
          status: tab.status,
        },
      };
  }
}

export async function openTaskTabInWindow(
  target: TaskWindowTarget,
  origin?: { x: number; y: number }
): Promise<boolean> {
  try {
    const res = await rpc.app.openTaskWindow(withMeasuredTaskWindowBounds(target, origin));
    if (!res?.success) {
      showOpenTaskWindowFailure(res?.error);
      return false;
    }
    return true;
  } catch (error) {
    showOpenTaskWindowFailure(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function withMeasuredTaskWindowBounds(
  target: TaskWindowTarget,
  origin?: { x: number; y: number }
): TaskWindowTarget {
  const measured = measureTaskWindowBounds();
  const originPoint = origin ? { x: Math.round(origin.x), y: Math.round(origin.y) } : undefined;
  if (!measured && !originPoint) return target;
  // Spawn-at-cursor only needs `origin`; the main process reads the live cursor.
  // Fall back to default size when the active content can't be measured.
  const bounds: TaskWindowBounds = {
    width: measured?.width ?? 920,
    height: measured?.height ?? 640,
    ...(originPoint ? { origin: originPoint } : {}),
  };
  return { ...target, bounds };
}

function measureTaskWindowBounds(): TaskWindowBounds | undefined {
  const source = document.querySelector<HTMLElement>('[data-task-active-tab-content]');
  const rect = source?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height + 28),
  };
}

function showOpenTaskWindowFailure(description?: string): void {
  toast({
    title: i18n.t('tasks.tabs.openInWindowFailed'),
    description,
    variant: 'destructive',
  });
}
