import type z from 'zod';
import {
  appSettingsSchema,
  type agentAutoApproveDefaultsSchema,
  type automationEntrySchema,
  type automationsSettingsSchema,
  type homeDraftSchema,
  type interfaceSettingsSchema,
  type localProjectSettingsSchema,
  type maasSettingsSchema,
  type notificationSettingsSchema,
  type projectSettingsSchema,
  type providerCustomConfigEntrySchema,
  type taskSettingsSchema,
  type terminalSettingsSchema,
  type themeSchema,
} from '@main/core/settings/schema';

export type LocalProjectSettings = z.infer<typeof localProjectSettingsSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type TaskSettings = z.infer<typeof taskSettingsSchema>;
export type AgentAutoApproveDefaults = z.infer<typeof agentAutoApproveDefaultsSchema>;
export type AutomationEntry = z.infer<typeof automationEntrySchema>;
export type AutomationsSettings = z.infer<typeof automationsSettingsSchema>;
export type MaasSettings = z.infer<typeof maasSettingsSchema>;
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;
export type Theme = z.infer<typeof themeSchema>;

export type InterfaceSettings = z.infer<typeof interfaceSettingsSchema>;
export type HomeDraft = z.infer<typeof homeDraftSchema>;
export type ProviderCustomConfig = z.infer<typeof providerCustomConfigEntrySchema>;
export type ProviderCustomConfigs = Record<string, ProviderCustomConfig>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsKey = keyof AppSettings;

export const AppSettingsKeys = Object.keys(appSettingsSchema.shape) as AppSettingsKey[];
