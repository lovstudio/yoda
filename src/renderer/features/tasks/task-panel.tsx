import { useQuery } from '@tanstack/react-query';
import { Bot, Circle, CircleCheck, CircleDot } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionMetadata, ClaudeTodo } from '@shared/conversations';
import type { TaskLifecycleStatus } from '@shared/tasks';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { rpc } from '@renderer/lib/ipc';
import { MicroLabel } from '@renderer/lib/ui/label';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { LifecycleStatusIndicator } from './components/lifecycleStatusIndicator';

const REFRESH_MS = 3_000;

export const TaskPanel = observer(function TaskPanel() {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const activeConversation = tabManager.activeConversation;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className="shrink-0 pl-4 pr-2 pt-2 pb-1">
        <MicroLabel>{t('tasks.task')}</MicroLabel>
      </div>

      <div className="flex flex-col gap-3 px-3 pb-4">
        <AgentInfoSection />
        {activeConversation ? <ClaudeSessionSections /> : <EmptySessionHint />}
      </div>
    </div>
  );
});

const AgentInfoSection = observer(function AgentInfoSection() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const activeConversation = tabManager.activeConversation;
  const config = activeConversation ? agentConfig[activeConversation.data.providerId] : null;
  const status = (taskStore?.data.status ?? 'in_progress') as TaskLifecycleStatus;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-2">
      <header className="flex items-center justify-between">
        <MicroLabel className="text-foreground-passive">{t('tasks.panel.agent')}</MicroLabel>
        <LifecycleStatusIndicator
          lifecycleStatus={status}
          onLifecycleStatusChange={(next) => {
            void taskStore?.updateStatus(next);
          }}
        />
      </header>
      <div className="flex items-center gap-2">
        {config ? (
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-5 shrink-0"
          />
        ) : (
          <Bot className="size-5 shrink-0 text-foreground-passive" />
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm">
            {config?.name ?? t('tasks.panel.noActiveConversation')}
          </span>
          {activeConversation ? (
            <span className="truncate text-xs text-foreground-passive font-mono">
              {activeConversation.data.title}
            </span>
          ) : null}
        </div>
      </div>
    </section>
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

const ClaudeSessionSections = observer(function ClaudeSessionSections() {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const activeConversation = tabManager.activeConversation!;
  const providerId = activeConversation.data.providerId;
  const cwd = provisioned.path;
  const sessionId = activeConversation.data.id;
  const isClaude = providerId === 'claude';

  const { data, isPending, error, dataUpdatedAt } = useQuery<ClaudeSessionMetadata | null>({
    queryKey: ['claudeSessionMetadata', cwd, sessionId],
    queryFn: () => rpc.conversations.getClaudeSessionMetadata(cwd, sessionId),
    enabled: isClaude,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  if (!isClaude) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-passive">
        {t('tasks.panel.claudeOnly')}
      </div>
    );
  }

  return (
    <>
      <TodosSection todos={data?.todos ?? []} loading={isPending} />
      <SummarySection summary={data?.summary ?? null} model={data?.model ?? null} />
      <DebugStrip
        cwd={cwd}
        sessionId={sessionId}
        hasData={data != null}
        todoCount={data?.todos.length ?? 0}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
      />
    </>
  );
});

function DebugStrip({
  cwd,
  sessionId,
  hasData,
  todoCount,
  error,
  updatedAt,
}: {
  cwd: string;
  sessionId: string;
  hasData: boolean;
  todoCount: number;
  error: string | null;
  updatedAt: number;
}) {
  const updated = updatedAt ? new Date(updatedAt).toLocaleTimeString() : 'never';
  return (
    <details className="rounded-md border border-dashed border-border p-2 text-[10px] text-foreground-passive font-mono">
      <summary className="cursor-pointer select-none">debug</summary>
      <div className="mt-1 flex flex-col gap-0.5 break-all">
        <div>cwd: {cwd}</div>
        <div>session: {sessionId}</div>
        <div>
          data: {hasData ? 'ok' : 'null'} · todos: {todoCount} · updated: {updated}
        </div>
        {error ? <div className="text-red-500">error: {error}</div> : null}
      </div>
    </details>
  );
}

function TodosSection({ todos, loading }: { todos: ClaudeTodo[]; loading: boolean }) {
  const { t } = useTranslation();
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-2">
      <header className="flex items-center justify-between">
        <MicroLabel className="text-foreground-passive">{t('tasks.panel.todos')}</MicroLabel>
        {todos.length > 0 ? (
          <span className="text-xs text-foreground-passive font-mono">
            {done}/{todos.length}
          </span>
        ) : null}
      </header>
      {todos.length === 0 ? (
        <p className="text-xs text-foreground-passive">
          {loading ? t('common.loading') : t('tasks.panel.noTodos')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {todos.map((todo, i) => (
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
      )}
    </section>
  );
}

function TodoStatusIcon({ status }: { status: ClaudeTodo['status'] }) {
  if (status === 'completed') {
    return <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-status-done" />;
  }
  if (status === 'in_progress') {
    return <CircleDot className="mt-0.5 size-3.5 shrink-0 text-status-in-progress animate-pulse" />;
  }
  return <Circle className="mt-0.5 size-3.5 shrink-0 text-foreground-passive" />;
}

function SummarySection({ summary, model }: { summary: string | null; model: string | null }) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-2">
      <header className="flex items-center justify-between">
        <MicroLabel className="text-foreground-passive">{t('tasks.panel.summary')}</MicroLabel>
        {model ? (
          <span className="truncate text-[11px] text-foreground-passive font-mono" title={model}>
            {model}
          </span>
        ) : null}
      </header>
      {summary ? (
        <p className="whitespace-pre-wrap text-sm text-foreground">{summary}</p>
      ) : (
        <p className="text-xs text-foreground-passive">{t('tasks.panel.noSummary')}</p>
      )}
    </section>
  );
}
