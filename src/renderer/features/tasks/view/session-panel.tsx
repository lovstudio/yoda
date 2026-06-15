import * as AccordionPrimitive from '@radix-ui/react-accordion';
import {
  ChevronRight,
  FileText,
  Info,
  ListChecks,
  MessageSquareText,
  ScrollText,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { HarnessSection } from '../context-panel';
import {
  SessionInfoPanel,
  SessionOverviewAIButton,
  SessionOverviewPanel,
  SessionPromptsContent,
  SessionPromptsCount,
  SessionPromptsViewAllButton,
  useSessionPrompts,
} from '../session-info-panel';
import { taskSidebarPreferenceStore } from '../stores/task-sidebar-preferences';
import { TaskPanel, TaskTodosCount, useTaskTodos } from '../task-panel';
import {
  TranscriptContent,
  TranscriptCount,
  TranscriptFileActions,
  useConversationTranscript,
} from '../transcript-panel';
import {
  isSessionFamilyTab,
  sessionSectionForTab,
  type SessionPanelSection,
  type SessionPanelUnit,
} from '../types';

/**
 * Merged "Session" sidebar surface — the 百叶窗 (window-blind) accordion that
 * folds the session / conversation / task / naming tabs into one panel, plus
 * the agent-runtime (harness) blinds: persona, memory, tools, MCP, skills,
 * agents, hooks. Each blind hosts an existing panel rendered in `chromeless` mode so
 * the blind trigger is the only header.
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
  // runtime blind choice with the active tab's default section.
  const activeTab = taskView.sidebarTab;
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = activeTab;
    if (prevTab === activeTab) return;
    const section = sessionSectionForTab(activeTab);
    if (section) taskView.setSessionPanelOpenSectionIds([section]);
  }, [activeTab, taskView]);

  // User-managed runtime composition (session chip context menu → 管理章节):
  // units render in the current order, hidden ones are skipped entirely.
  const visibleUnits = taskSidebarPreferenceStore.sessionPanelUnitOrder.filter(
    (unit) => !taskSidebarPreferenceStore.sessionPanelHiddenUnits.includes(unit)
  );

  const renderUnit = (unit: SessionPanelUnit): React.ReactNode => {
    switch (unit) {
      case 'basic':
        return (
          <Blind
            key={unit}
            id="basic"
            icon={<Info className="size-3.5" />}
            title={t('tasks.sessionPanel.basic')}
            open={openSection === 'basic'}
          >
            {(active) => <SessionInfoPanel active={active} chromeless />}
          </Blind>
        );
      case 'conversation':
        return (
          <ConversationBlind
            key={unit}
            open={openSection === 'conversation'}
            title={t('tasks.sessionPanel.conversation')}
          />
        );
      case 'transcript':
        return (
          <TranscriptBlind
            key={unit}
            open={openSection === 'transcript'}
            title={t('tasks.sessionPanel.transcript')}
          />
        );
      case 'tasks':
        return (
          <TasksBlind
            key={unit}
            open={openSection === 'tasks'}
            title={t('tasks.sessionPanel.tasks')}
          />
        );
      case 'persona':
      case 'memory':
      case 'tools':
      case 'mcp-servers':
      case 'skills':
      case 'agents-available':
      case 'statusline':
      case 'hooks':
        return <HarnessSection key={unit} id={unit} active={panelActive} />;
      case 'overview':
        // 概要 (title + summary) defaults LAST so it can stay open and hang at
        // the bottom edge while the user works through any conversation.
        return (
          <Blind
            key={unit}
            id="overview"
            icon={<FileText className="size-3.5" />}
            title={t('tasks.sessionPanel.overview')}
            open={openSection === 'overview'}
            actions={<SessionOverviewAIButton />}
          >
            {(active) => <SessionOverviewPanel active={active} />}
          </Blind>
        );
    }
  };

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
        {visibleUnits.map(renderUnit)}
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
 * (Claude session JSONL / Codex rollout). Subscribes regardless of open state
 * so the header's line count is always live.
 */
const TranscriptBlind = observer(function TranscriptBlind({
  open,
  title,
}: {
  open: boolean;
  title: string;
}) {
  const feed = useConversationTranscript(true);
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
