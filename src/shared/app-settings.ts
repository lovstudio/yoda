import type z from 'zod';
import {
  appSettingsSchema,
  type automationEntrySchema,
  type automationsSettingsSchema,
  type homeDraftSchema,
  type interfaceSettingsSchema,
  type kanbanColumnHookSchema,
  type kanbanHookActionSchema,
  type kanbanSettingsSchema,
  type localProjectSettingsSchema,
  type maasSettingsSchema,
  type notificationSettingsSchema,
  type projectSettingsSchema,
  type promptPrinciplesSettingsSchema,
  type runtimeAutoApproveDefaultsSchema,
  type runtimeCustomConfigEntrySchema,
  type runtimeModelCandidatesSettingsSchema,
  type statuslineSettingsSchema,
  type statuslineTemplateSchema,
  type systemThemesSchema,
  type taskSettingsSchema,
  type terminalSettingsSchema,
} from '@main/core/settings/schema';
import type { CustomTheme, CustomThemesSettings, ThemeSelection } from './custom-theme';

export type LocalProjectSettings = z.infer<typeof localProjectSettingsSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type TaskSettings = z.infer<typeof taskSettingsSchema>;
export type RuntimeAutoApproveDefaults = z.infer<typeof runtimeAutoApproveDefaultsSchema>;
export type AutomationEntry = z.infer<typeof automationEntrySchema>;
export type AutomationsSettings = z.infer<typeof automationsSettingsSchema>;
export type KanbanHookAction = z.infer<typeof kanbanHookActionSchema>;
export type KanbanColumnHook = z.infer<typeof kanbanColumnHookSchema>;
export type KanbanSettings = z.infer<typeof kanbanSettingsSchema>;
export type MaasSettings = z.infer<typeof maasSettingsSchema>;
export type RuntimeModelCandidatesSettings = z.infer<typeof runtimeModelCandidatesSettingsSchema>;
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;
export type StatuslineTemplate = z.infer<typeof statuslineTemplateSchema>;
export type StatuslineSettings = z.infer<typeof statuslineSettingsSchema>;
export type PromptPrinciplesSettings = z.infer<typeof promptPrinciplesSettingsSchema>;
export type Theme = ThemeSelection;
export type SystemThemes = z.infer<typeof systemThemesSchema>;
export type { CustomTheme, CustomThemesSettings };

export type InterfaceSettings = z.infer<typeof interfaceSettingsSchema>;
export type HomeDraft = z.infer<typeof homeDraftSchema>;
export type RuntimeCustomConfig = z.infer<typeof runtimeCustomConfigEntrySchema>;
export type RuntimeCustomConfigs = Record<string, RuntimeCustomConfig>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsKey = keyof AppSettings;

export const AppSettingsKeys = Object.keys(appSettingsSchema.shape) as AppSettingsKey[];
