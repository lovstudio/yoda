export const TASK_TITLE_STYLES = ['regular', 'medium', 'italic'] as const;
export type TaskTitleStyle = (typeof TASK_TITLE_STYLES)[number];

export const TASK_IDLE_OPACITIES = [100, 85, 70, 55] as const;
export type TaskIdleOpacity = (typeof TASK_IDLE_OPACITIES)[number];

export const TASK_MARKERS = ['none', 'dot', 'bookmark'] as const;
export type TaskMarker = (typeof TASK_MARKERS)[number];

export const MULTI_AGENT_TASK_MARKERS = ['users', 'dot', 'none'] as const;
export type MultiAgentTaskMarker = (typeof MULTI_AGENT_TASK_MARKERS)[number];

export interface TaskAppearancePreset {
  titleStyle: TaskTitleStyle;
  /** Whole-row opacity after a task has stopped working and has been read. */
  idleOpacity: TaskIdleOpacity;
  marker: TaskMarker;
}

export interface TaskAppearanceSettings {
  standard: TaskAppearancePreset;
  longTerm: TaskAppearancePreset;
  /** Multi-agent tasks inherit their task-type preset and only override the marker. */
  multiAgent: {
    marker: MultiAgentTaskMarker;
  };
}

export const DEFAULT_TASK_APPEARANCE_SETTINGS = {
  standard: {
    titleStyle: 'regular',
    idleOpacity: 100,
    marker: 'none',
  },
  longTerm: {
    titleStyle: 'italic',
    idleOpacity: 70,
    marker: 'none',
  },
  multiAgent: {
    marker: 'users',
  },
} as const satisfies TaskAppearanceSettings;

export interface TaskAppearanceState {
  isLongTerm: boolean;
  needsReview: boolean;
  isIdle: boolean;
  isMultiAgent: boolean;
}

export interface ResolvedTaskAppearance {
  titleStyle: TaskTitleStyle;
  idleOpacity: TaskIdleOpacity;
  marker: TaskMarker | MultiAgentTaskMarker;
}

/**
 * Resolves composable task-appearance rules in a stable order:
 * standard baseline → long-term preset → multi-agent marker override.
 */
export function resolveTaskAppearance(
  settings: TaskAppearanceSettings,
  state: TaskAppearanceState
): ResolvedTaskAppearance {
  const preset = state.isLongTerm ? settings.longTerm : settings.standard;
  return {
    titleStyle: preset.titleStyle,
    idleOpacity: state.isIdle && !state.needsReview ? preset.idleOpacity : 100,
    marker: state.isMultiAgent ? settings.multiAgent.marker : preset.marker,
  };
}
