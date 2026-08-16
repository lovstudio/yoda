import type { RuntimeBarItem } from '@runtime-bar/contract';
import { RuntimeBarAccountUsageItem } from './items/account-usage-item';
import { RuntimeBarAgentSessionsItem } from './items/agent-sessions-item';
import { RuntimeBarConfigItem } from './items/config-item';
import { RuntimeBarContextItem } from './items/context-item';
import { RuntimeBarDoctorItem } from './items/doctor-item';
import { RuntimeBarMaasItem } from './items/maas-item';
import { RuntimeBarNotificationsItem } from './items/notifications-item';
import { RuntimeBarPromptItem } from './items/prompt-item';
import { RuntimeBarResourcesItem } from './items/resources-item';
import { RuntimeBarRuntimeItem } from './items/runtime-item';
import { RuntimeBarSkillItem } from './items/skill-item';
import { RuntimeBarSyncItem } from './items/sync-item';
import { RuntimeBarTerminalItem } from './items/terminal-item';
import { RuntimeBarTrajectoryItem } from './items/trajectory-item';

/**
 * The bar Yoda ships. Array order is render order — there is no priority field,
 * because "which entry sits left of which" is a decision with one right answer
 * per host and nothing to compute at runtime.
 *
 * Order within a slot is the reading order the bar was designed around: the
 * session group runs from what the agent *is* to what it has *spent*, and the
 * tray runs from what wants attention to what is merely available.
 */
export const RUNTIME_BAR_ITEMS: RuntimeBarItem[] = [
  { id: 'config', slot: 'lead', Component: RuntimeBarConfigItem },

  { id: 'runtime', slot: 'session', Component: RuntimeBarRuntimeItem },
  { id: 'prompt', slot: 'session', Component: RuntimeBarPromptItem },
  { id: 'skill', slot: 'session', Component: RuntimeBarSkillItem },
  { id: 'context', slot: 'session', Component: RuntimeBarContextItem },
  { id: 'account-usage', slot: 'session', Component: RuntimeBarAccountUsageItem },

  { id: 'notifications', slot: 'tray', Component: RuntimeBarNotificationsItem },
  { id: 'agent-sessions', slot: 'tray', Component: RuntimeBarAgentSessionsItem },
  { id: 'maas', slot: 'tray', Component: RuntimeBarMaasItem },
  { id: 'resources', slot: 'tray', Component: RuntimeBarResourcesItem },
  { id: 'trajectory', slot: 'tray', Component: RuntimeBarTrajectoryItem },
  { id: 'sync', slot: 'tray', Component: RuntimeBarSyncItem },
  { id: 'doctor', slot: 'tray', Component: RuntimeBarDoctorItem },
  { id: 'terminal', slot: 'tray', Component: RuntimeBarTerminalItem },
];
