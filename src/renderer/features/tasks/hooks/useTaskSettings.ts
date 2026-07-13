import type { TaskOutputLanguage } from '@shared/project-settings';
import {
  DEFAULT_SUMMARY_CONTEXT_GLOBAL,
  DEFAULT_SUMMARY_CONTEXT_RECENT,
  type SummaryContext,
} from '@shared/session-summary';
import { normalizeTaskNamingTimeoutMs } from '@shared/task-naming';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export interface TaskSettingsModel {
  autoGenerateName: boolean;
  initTaskNameFromSession: boolean;
  branchNaming: 'hash' | 'ai';
  namingAgentId: string;
  summaryAgentId: string;
  inputPromptLanguage: TaskOutputLanguage;
  summaryLanguage: TaskOutputLanguage;
  summaryContextRecent: SummaryContext;
  summaryContextGlobal: SummaryContext;
  namingModel: string;
  namingLanguage: TaskOutputLanguage;
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
      | 'initTaskNameFromSession'
      | 'branchNaming'
      | 'inputPromptLanguage'
      | 'namingAgentId'
      | 'namingModel'
      | 'namingLanguage'
      | 'namingContext'
      | 'namingRecentTaskLimit'
      | 'namingRequestTimeoutMs'
      | 'autoTrustWorktrees'
  ) => boolean;
  updateAutoGenerateName: (next: boolean) => void;
  updateInitTaskNameFromSession: (next: boolean) => void;
  updateBranchNaming: (next: 'hash' | 'ai') => void;
  updateNamingAgentId: (next: string) => void;
  updateSummaryAgentId: (next: string) => void;
  updateInputPromptLanguage: (next: TaskOutputLanguage) => void;
  updateSummaryLanguage: (next: TaskOutputLanguage) => void;
  updateSummaryContext: (scope: 'recent' | 'global', next: Partial<SummaryContext>) => void;
  updateNamingLanguage: (next: TaskOutputLanguage) => void;
  updateNamingContext: (next: Partial<TaskSettingsModel['namingContext']>) => void;
  updateNamingRecentTaskLimit: (next: number) => void;
  updateNamingRequestTimeoutMs: (next: number) => void;
  updateAutoTrustWorktrees: (next: boolean) => void;
  resetAutoGenerateName: () => void;
  resetInitTaskNameFromSession: () => void;
  resetBranchNaming: () => void;
  resetInputPromptLanguage: () => void;
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
    initTaskNameFromSession: tasks?.initTaskNameFromSession ?? true,
    branchNaming: tasks?.branchNaming ?? 'hash',
    namingAgentId: tasks?.namingAgentId ?? '',
    summaryAgentId: tasks?.summaryAgentId ?? '',
    inputPromptLanguage: tasks?.inputPromptLanguage ?? 'skip',
    summaryLanguage: tasks?.summaryLanguage ?? 'app',
    summaryContextRecent: tasks?.summaryContextRecent ?? DEFAULT_SUMMARY_CONTEXT_RECENT,
    summaryContextGlobal: tasks?.summaryContextGlobal ?? DEFAULT_SUMMARY_CONTEXT_GLOBAL,
    namingModel: tasks?.namingModel ?? '',
    namingLanguage: tasks?.namingLanguage ?? 'skip',
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
    updateInitTaskNameFromSession: (next) => update({ initTaskNameFromSession: next }),
    updateBranchNaming: (next) => update({ branchNaming: next }),
    updateNamingAgentId: (next) => update({ namingAgentId: next }),
    updateSummaryAgentId: (next) => update({ summaryAgentId: next }),
    updateInputPromptLanguage: (next) => update({ inputPromptLanguage: next }),
    updateSummaryLanguage: (next) => update({ summaryLanguage: next }),
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
    resetInitTaskNameFromSession: () => resetField('initTaskNameFromSession'),
    resetBranchNaming: () => resetField('branchNaming'),
    resetInputPromptLanguage: () => resetField('inputPromptLanguage'),
    resetAutoTrustWorktrees: () => resetField('autoTrustWorktrees'),
  };
}
