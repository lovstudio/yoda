import {
  clampStatusBarPromptEdge,
  DEFAULT_SESSION_STATUS_BAR_SOURCE,
  DEFAULT_STATUS_BAR_PROMPT_HEAD,
  DEFAULT_STATUS_BAR_PROMPT_TAIL,
  type SessionStatusBarSource,
} from '@shared/session-status-bar';
import {
  DEFAULT_SUMMARY_CONTEXT_GLOBAL,
  DEFAULT_SUMMARY_CONTEXT_RECENT,
  type SummaryContext,
} from '@shared/session-summary';
import { normalizeTaskNamingTimeoutMs } from '@shared/task-naming';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  namingAgentId: string;
  summaryAgentId: string;
  summaryLanguage: 'app' | 'prompt' | 'en' | 'zh-CN';
  statusBarSource: SessionStatusBarSource;
  statusBarPromptsExpanded: boolean;
  statusBarPromptHead: number;
  statusBarPromptTail: number;
  summaryContextRecent: SummaryContext;
  summaryContextGlobal: SummaryContext;
  namingModel: string;
  namingLanguage: 'app' | 'prompt' | 'en' | 'zh-CN';
  namingContext: {
    prompt: boolean;
    project: boolean;
    readme: boolean;
    recentTasks: boolean;
  };
  namingRecentTaskLimit: number;
  namingRequestTimeoutMs: number;
  autoTrustWorktrees: boolean;
  loading: boolean;
  saving: boolean;
  isFieldOverridden: (
    field:
      | 'autoGenerateName'
      | 'namingAgentId'
      | 'namingModel'
      | 'namingLanguage'
      | 'namingContext'
      | 'namingRecentTaskLimit'
      | 'namingRequestTimeoutMs'
      | 'autoTrustWorktrees'
  ) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateNamingAgentId: (next: string) => void;
  updateSummaryAgentId: (next: string) => void;
  updateSummaryLanguage: (next: 'app' | 'prompt' | 'en' | 'zh-CN') => void;
  updateStatusBarSource: (next: SessionStatusBarSource) => void;
  updateStatusBarPromptsExpanded: (next: boolean) => void;
  updateStatusBarPromptEdges: (next: { head?: number; tail?: number }) => void;
  updateSummaryContext: (scope: 'recent' | 'global', next: Partial<SummaryContext>) => void;
  updateNamingLanguage: (next: 'app' | 'prompt' | 'en' | 'zh-CN') => void;
  updateNamingContext: (next: Partial<TaskSettingsModel['namingContext']>) => void;
  updateNamingRecentTaskLimit: (next: number) => void;
  updateNamingRequestTimeoutMs: (next: number) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  resetAutoGenerateName: () => void;
  resetAutoTrustWorktrees: () => void;
}

export function useTaskSettings(): TaskSettingsModel {
  const {
    value: tasks,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    update,
    resetField,
  } = useAppSettingsKey('tasks');

  return {
    autoGenerateName: tasks?.autoGenerateName ?? false,
    namingAgentId: tasks?.namingAgentId ?? '',
    summaryAgentId: tasks?.summaryAgentId ?? '',
    summaryLanguage: tasks?.summaryLanguage ?? 'app',
    statusBarSource: tasks?.statusBarSource ?? DEFAULT_SESSION_STATUS_BAR_SOURCE,
    statusBarPromptsExpanded: tasks?.statusBarPromptsExpanded ?? false,
    statusBarPromptHead: tasks?.statusBarPromptHead ?? DEFAULT_STATUS_BAR_PROMPT_HEAD,
    statusBarPromptTail: tasks?.statusBarPromptTail ?? DEFAULT_STATUS_BAR_PROMPT_TAIL,
    summaryContextRecent: tasks?.summaryContextRecent ?? DEFAULT_SUMMARY_CONTEXT_RECENT,
    summaryContextGlobal: tasks?.summaryContextGlobal ?? DEFAULT_SUMMARY_CONTEXT_GLOBAL,
    namingModel: tasks?.namingModel ?? '',
    namingLanguage: tasks?.namingLanguage ?? 'app',
    namingContext: tasks?.namingContext ?? {
      prompt: true,
      project: true,
      readme: true,
      recentTasks: true,
    },
    namingRecentTaskLimit: tasks?.namingRecentTaskLimit ?? 8,
    namingRequestTimeoutMs: normalizeTaskNamingTimeoutMs(tasks?.namingRequestTimeoutMs),
    autoTrustWorktrees: tasks?.autoTrustWorktrees ?? false,
    loading,
    saving,
    isFieldOverridden,
    updateAutoGenerateName: (next) => update({ autoGenerateName: next }),
    updateNamingAgentId: (next) => update({ namingAgentId: next }),
    updateSummaryAgentId: (next) => update({ summaryAgentId: next }),
    updateSummaryLanguage: (next) => update({ summaryLanguage: next }),
    updateStatusBarSource: (next) => update({ statusBarSource: next }),
    updateStatusBarPromptsExpanded: (next) => update({ statusBarPromptsExpanded: next }),
    updateStatusBarPromptEdges: (next) =>
      update({
        ...(next.head === undefined
          ? {}
          : {
              statusBarPromptHead: clampStatusBarPromptEdge(
                next.head,
                DEFAULT_STATUS_BAR_PROMPT_HEAD
              ),
            }),
        ...(next.tail === undefined
          ? {}
          : {
              statusBarPromptTail: clampStatusBarPromptEdge(
                next.tail,
                DEFAULT_STATUS_BAR_PROMPT_TAIL
              ),
            }),
      }),
    updateSummaryContext: (scope, next) => {
      const key = scope === 'recent' ? 'summaryContextRecent' : 'summaryContextGlobal';
      const base =
        scope === 'recent' ? DEFAULT_SUMMARY_CONTEXT_RECENT : DEFAULT_SUMMARY_CONTEXT_GLOBAL;
      update({ [key]: { ...base, ...(tasks?.[key] ?? {}), ...next } });
    },
    updateNamingLanguage: (next) => update({ namingLanguage: next }),
    updateNamingContext: (next) =>
      update({
        namingContext: {
          prompt: true,
          project: true,
          readme: true,
          recentTasks: true,
          ...(tasks?.namingContext ?? {}),
          ...next,
        },
      }),
    updateNamingRecentTaskLimit: (next) => update({ namingRecentTaskLimit: next }),
    updateNamingRequestTimeoutMs: (next) =>
      update({ namingRequestTimeoutMs: normalizeTaskNamingTimeoutMs(next) }),
    updateAutoTrustWorktrees: (next) => update({ autoTrustWorktrees: next }),
    resetAutoGenerateName: () => resetField('autoGenerateName'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
  };
}
