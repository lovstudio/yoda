import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Circle, CircleCheck, CircleDot } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionMetadata, ClaudeTodo } from '@shared/conversations';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';

const REFRESH_MS = 3_000;
const VISIBLE_TODOS = 5;

/**
 * Shared task-todo state — feeds both the blind header count and the panel
 * content so a single query drives both.
 */
export function useTaskTodos(): {
  todos: ClaudeTodo[];
  done: number;
  isClaude: boolean;
  hasConversation: boolean;
  loading: boolean;
} {
  const provisioned = useProvisionedTask();
  // Falls back to the task's most recent conversation when the active main-area
  // tab is a file/diff — the todo list must not vanish on tab switches.
  const conversation = getTaskMenuConversation(provisioned);
  const isClaude = conversation?.runtimeId === 'claude';
  const cwd = provisioned.path;
  const sessionId = conversation?.id ?? '';

  const { data, isPending } = useQuery<ClaudeSessionMetadata | null>({
    queryKey: ['claudeSessionMetadata', cwd, sessionId],
    queryFn: () => rpc.conversations.getClaudeSessionMetadata(cwd, sessionId),
    enabled: Boolean(isClaude && conversation),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const todos = data?.todos ?? [];
  return {
    todos,
    done: todos.filter((todo) => todo.status === 'completed').length,
    isClaude: Boolean(isClaude),
    hasConversation: Boolean(conversation),
    loading: isPending,
  };
}

/** Header action for the 任务 blind: a compact done/total progress counter. */
export const TaskTodosCount = observer(function TaskTodosCount({
  todos,
}: {
  todos: ReturnType<typeof useTaskTodos>;
}) {
  if (!todos.hasConversation) return null;
  return (
    <span className="px-1.5 text-[11px] text-foreground-passive font-mono">
      {todos.done}/{todos.todos.length}
    </span>
  );
});

/**
 * Task surface — shows only the task's todo list. Agent identity lives in the
 * basic-info panel and the conversation history in its own panel, so this
 * stays focused on task progress and nothing else.
 */
export const TaskPanel = observer(function TaskPanel({
  chromeless = false,
  todos,
}: {
  chromeless?: boolean;
  /** Lifted state shared with the blind header. Falls back to its own query. */
  todos?: ReturnType<typeof useTaskTodos>;
} = {}) {
  const { t } = useTranslation();
  const ownTodos = useTaskTodos();
  const state = todos ?? ownTodos;

  return (
    <div className={cn('flex w-full flex-col', chromeless ? 'min-w-0' : 'h-full overflow-y-auto')}>
      {chromeless ? null : (
        <div className="shrink-0 pl-4 pr-2 pt-2 pb-1">
          <MicroLabel>{t('tasks.task')}</MicroLabel>
        </div>
      )}

      <div className={cn('flex flex-col px-3 pb-4', chromeless ? 'pt-2' : 'pt-0')}>
        {state.hasConversation ? <TaskTodosContent todos={state} /> : <EmptySessionHint />}
      </div>
    </div>
  );
});

function EmptySessionHint() {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-passive">
      {t('tasks.panel.emptyHint')}
    </div>
  );
}

const TaskTodosContent = observer(function TaskTodosContent({
  todos,
}: {
  todos: ReturnType<typeof useTaskTodos>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (!todos.isClaude) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-passive">
        {t('tasks.panel.claudeOnly')}
      </div>
    );
  }

  if (todos.todos.length === 0) {
    return (
      <p className="px-2 text-xs text-foreground-passive">
        {todos.loading ? t('common.loading') : t('tasks.panel.noTodos')}
      </p>
    );
  }

  // Default to the latest few todos; older ones collapse behind a toggle.
  const hiddenCount = todos.todos.length - VISIBLE_TODOS;
  const collapsible = hiddenCount > 0;
  const collapsed = collapsible && !expanded;
  const visible = collapsed ? todos.todos.slice(-VISIBLE_TODOS) : todos.todos;

  return (
    <div className="flex flex-col gap-1 p-2">
      {collapsible ? (
        <button
          type="button"
          className="flex items-center gap-1 self-start rounded-sm px-1 py-0.5 text-[11px] text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
          {expanded
            ? t('tasks.panel.collapseTodos')
            : t('tasks.panel.showEarlierTodos', { count: hiddenCount })}
        </button>
      ) : null}
      <ul className="flex flex-col gap-1">
        {visible.map((todo, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <TodoStatusIcon status={todo.status} />
            <span
              className={cn(
                'min-w-0 flex-1',
                todo.status === 'completed' && 'text-foreground-passive line-through',
                todo.status === 'in_progress' && 'text-foreground'
              )}
            >
              {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
});

function TodoStatusIcon({ status }: { status: ClaudeTodo['status'] }) {
  if (status === 'completed') {
    return <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-status-done" />;
  }
  if (status === 'in_progress') {
    return <CircleDot className="mt-0.5 size-3.5 shrink-0 text-status-in-progress animate-pulse" />;
  }
  return <Circle className="mt-0.5 size-3.5 shrink-0 text-foreground-passive" />;
}
