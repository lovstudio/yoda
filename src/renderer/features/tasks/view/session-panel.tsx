import * as AccordionPrimitive from '@radix-ui/react-accordion';
import {
  ChevronRight,
  Info,
  ListChecks,
  MessageSquareText,
  ScrollText,
  Sparkles,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionSummaryScope } from '@shared/conversations';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { HarnessSections } from '../context-panel';
import {
  SessionInfoPanel,
  SessionPromptsContent,
  SessionPromptsCount,
  SessionPromptsViewAllButton,
  SessionSummaryContent,
  SessionSummaryCount,
  useSessionPrompts,
  useSessionSummary,
} from '../session-info-panel';
import { TaskPanel, TaskTodosCount, useTaskTodos } from '../task-panel';
import {
  TranscriptContent,
  TranscriptCount,
  TranscriptFileActions,
  useConversationTranscript,
} from '../transcript-panel';
import { isSessionFamilyTab, sessionSectionForTab, type SessionPanelSection } from '../types';

/**
 * Merged "Session" sidebar surface — the 百叶窗 (window-blind) accordion that
 * folds the session / conversation / task / naming tabs into one panel, plus
 * the agent-runtime (harness) blinds: memory, tools, MCP, skills, hooks. Each
 * blind hosts an existing panel rendered in `chromeless` mode so the blind
 * trigger is the only header.
 */
export const SessionPanel = observer(function SessionPanel() {
  const { t } = useTranslation();
  const { taskView } = useProvisionedTask();
  // Single-expand 百叶窗: only one blind is open at a time.
  const openSection = taskView.sessionPanelOpenSectionIds[0] ?? '';
  // Live sub-panels (e.g. hooks) pause their subscriptions while hidden.
  const panelActive = !taskView.isSidebarCollapsed && isSessionFamilyTab(taskView.sidebarTab);

  // Deep-link bridge: commands and the context panel still call
  // `setSidebarTab('context' | 'task' | 'hooks' | 'rename')`. Expand the
  // matching blind so those entry points land on the right section — but only
  // on a genuine tab *transition*. Firing on mount (e.g. switching tasks, which
  // remounts this panel with a new `taskView`) would clobber the user's
  // persisted blind choice with the active tab's default section.
  const activeTab = taskView.sidebarTab;
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = activeTab;
    if (prevTab === activeTab) return;
    const section = sessionSectionForTab(activeTab);
    if (section) taskView.setSessionPanelOpenSectionIds([section]);
  }, [activeTab, taskView]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <AccordionPrimitive.Root
        type="single"
        collapsible
        value={openSection}
        onValueChange={(sectionId) =>
          taskView.setSessionPanelOpenSectionIds(sectionId ? [sectionId] : [])
        }
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <Blind
          id="basic"
          icon={<Info className="size-3.5" />}
          title={t('tasks.sessionPanel.basic')}
          open={openSection === 'basic'}
        >
          {(active) => <SessionInfoPanel active={active} chromeless />}
        </Blind>

        <ConversationBlind
          open={openSection === 'conversation'}
          title={t('tasks.sessionPanel.conversation')}
        />

        <TranscriptBlind
          open={openSection === 'transcript'}
          title={t('tasks.sessionPanel.transcript')}
        />

        <TasksBlind open={openSection === 'tasks'} title={t('tasks.sessionPanel.tasks')} />

        <SummaryBlind
          id="summary-global"
          scope="global"
          open={openSection === 'summary-global'}
          title={t('tasks.sessionPanel.summaryGlobal')}
        />

        <HarnessSections active={panelActive} />
      </AccordionPrimitive.Root>
    </div>
  );
});

function Blind({
  id,
  icon,
  title,
  open,
  count,
  actions,
  children,
}: {
  id: SessionPanelSection;
  icon: React.ReactNode;
  title: string;
  open: boolean;
  /** Item-count badge rendered on the right of the header at all times (open or not). */
  count?: React.ReactNode;
  /** Toolbar actions rendered on the right of the header while the blind is open. */
  actions?: React.ReactNode;
  children: (active: boolean) => React.ReactNode;
}) {
  return (
    <AccordionPrimitive.Item value={id} className="min-w-0 border-b border-border/70">
      <AccordionPrimitive.Header className="m-0 flex h-8 min-w-0 items-center pr-1.5 hover:bg-background-2">
        <AccordionPrimitive.Trigger className="group flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border">
          <ChevronRight className="size-3 shrink-0 text-foreground-passive transition-transform group-data-[state=open]:rotate-90" />
          <span className="shrink-0 text-foreground-passive">{icon}</span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={title}>
            {title}
          </span>
        </AccordionPrimitive.Trigger>
        <div className="flex shrink-0 items-center">
          {count}
          {open ? actions : null}
        </div>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="overflow-hidden border-t border-border/50 bg-background-1/20">
        {/* Only mount panel work (queries, live refresh) while the blind is open. */}
        {open ? children(true) : null}
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}

/**
 * The 对话 blind: loads prompt history once and feeds both the header's
 * view-all action and the content preview.
 */
const ConversationBlind = observer(function ConversationBlind({
  open,
  title,
}: {
  open: boolean;
  title: string;
}) {
  // Load prompts regardless of open state so the header count is always live.
  const prompts = useSessionPrompts(true);
  return (
    <Blind
      id="conversation"
      icon={<MessageSquareText className="size-3.5" />}
      title={title}
      open={open}
      count={<SessionPromptsCount prompts={prompts} />}
      actions={<SessionPromptsViewAllButton prompts={prompts} />}
    >
      {() => <SessionPromptsContent prompts={prompts} />}
    </Blind>
  );
});

/**
 * The Transcript blind: a live mirror of the conversation's on-disk transcript
 * (Claude session JSONL / Codex rollout). Only subscribes to the main-process
 * file watch while open.
 */
const TranscriptBlind = observer(function TranscriptBlind({
  open,
  title,
}: {
  open: boolean;
  title: string;
}) {
  const feed = useConversationTranscript(open);
  return (
    <Blind
      id="transcript"
      icon={<ScrollText className="size-3.5" />}
      title={title}
      open={open}
      count={<TranscriptCount feed={feed} />}
      actions={<TranscriptFileActions feed={feed} />}
    >
      {() => <TranscriptContent feed={feed} />}
    </Blind>
  );
});

/**
 * The 任务 blind: loads todo state once and feeds both the header's progress
 * count and the panel content.
 */
const TasksBlind = observer(function TasksBlind({ open, title }: { open: boolean; title: string }) {
  const todos = useTaskTodos();
  return (
    <Blind
      id="tasks"
      icon={<ListChecks className="size-3.5" />}
      title={title}
      open={open}
      count={<TaskTodosCount todos={todos} />}
    >
      {() => <TaskPanel chromeless todos={todos} />}
    </Blind>
  );
});

/**
 * The whole-session summary blind. It prefers the runtime's zero-cost
 * compaction summary, so it can keep its header count live without spawning a
 * summarization CLI in the background.
 */
const SummaryBlind = observer(function SummaryBlind({
  id,
  scope,
  open,
  title,
}: {
  id: SessionPanelSection;
  scope: SessionSummaryScope;
  open: boolean;
  title: string;
}) {
  // recent: auto-refresh every idle turn while open. global: trigger-only —
  // opening it must not spawn a summarization CLI; it generates only when the
  // user clicks regenerate.
  const summary = useSessionSummary(open, scope, { autoGenerate: scope === 'recent' });
  return (
    <Blind
      id={id}
      icon={<Sparkles className="size-3.5" />}
      title={title}
      open={open}
      count={<SessionSummaryCount summary={summary} />}
    >
      {() => <SessionSummaryContent summary={summary} />}
    </Blind>
  );
});
