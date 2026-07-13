import type { RuntimeId } from '@shared/runtime-registry';
import { YODA_ACCOUNT_USAGE_DOC_URL } from '@shared/urls';

/**
 * Roadmap content — single source of truth for the runtime capability matrix.
 *
 * All display strings resolve through i18n:
 *   roadmap.categories.<categoryId>          — category label
 *   roadmap.features.<featureId>.name/.desc  — feature name + what it covers
 *   roadmap.notes.<noteKey>                  — the research insight behind a cell
 *
 * To update progress, edit the cells below; missing cells fall back to 'planned'.
 */

export type RoadmapStatus = 'shipped' | 'testing' | 'inProgress' | 'researching' | 'planned' | 'na';

export type RoadmapRuntimeColumn = {
  id: RuntimeId;
  /** Runtime not integrated yet — the whole column renders as upcoming. */
  upcoming?: boolean;
};

export const ROADMAP_RUNTIMES: readonly RoadmapRuntimeColumn[] = [
  { id: 'claude' },
  { id: 'codex' },
  { id: 'hermes', upcoming: true },
];

export type RoadmapCell = {
  status: RoadmapStatus;
  /** i18n key suffix under roadmap.notes.* */
  noteKey?: string;
};

/**
 * Each capability is researched like a book chapter: a standalone deep-dive
 * report comparing how mainstream agents design and implement it. All reports
 * together build toward《高质量 Agent 设计指南》.
 */
export type RoadmapReportStatus = 'published' | 'draft' | 'planned';

export type RoadmapReport = {
  status: RoadmapReportStatus;
  url?: string;
};

export type RoadmapFeature = {
  id: string;
  cells: Partial<Record<RuntimeId, RoadmapCell>>;
  /** Missing report means the chapter is still planned. */
  report?: RoadmapReport;
};

export type RoadmapCategory = {
  id: string;
  features: RoadmapFeature[];
};

export const ROADMAP_FALLBACK_STATUS: RoadmapStatus = 'planned';

export const ROADMAP_CATEGORIES: readonly RoadmapCategory[] = [
  {
    id: 'lifecycle',
    features: [
      {
        id: 'version',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/lifecycle/version',
        },
      },
      {
        id: 'install',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/lifecycle/install',
        },
      },
      {
        id: 'launch',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/lifecycle/launch',
        },
      },
      {
        id: 'doctor',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/lifecycle/doctor',
        },
      },
    ],
  },
  {
    id: 'session',
    features: [
      {
        id: 'sessionNameSync',
        cells: {
          claude: { status: 'shipped', noteKey: 'sessionNameSync.claude' },
          codex: { status: 'shipped', noteKey: 'sessionNameSync.codex' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/session/session-name-sync',
        },
      },
      {
        id: 'sessionAutoRename',
        cells: {
          claude: { status: 'shipped', noteKey: 'sessionAutoRename.claude' },
          codex: { status: 'shipped', noteKey: 'sessionAutoRename.codex' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/session/session-auto-rename',
        },
      },
      {
        id: 'sessionStateSync',
        cells: {
          claude: { status: 'shipped', noteKey: 'sessionStateSync.claude' },
          codex: { status: 'testing', noteKey: 'sessionStateSync.codex' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/session/session-state-sync',
        },
      },
      {
        id: 'sessionResume',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/session/session-resume',
        },
      },
      {
        id: 'compaction',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/session/compaction',
        },
      },
      {
        id: 'checkpointing',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/session/checkpointing',
        },
      },
    ],
  },
  {
    id: 'context',
    features: [
      {
        id: 'projectPrompt',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/context/project-prompt',
        },
      },
      {
        id: 'systemPrompt',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/context/system-prompt',
        },
      },
      {
        id: 'memory',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/context/memory',
        },
      },
      {
        id: 'fileContext',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/context/file-context',
        },
      },
    ],
  },
  {
    id: 'extensibility',
    features: [
      {
        id: 'mcp',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/extensibility/mcp',
        },
      },
      {
        id: 'skills',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped', noteKey: 'skills.codex' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/extensibility/skills',
        },
      },
      {
        id: 'plugins',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/extensibility/plugins',
        },
      },
      {
        id: 'subagents',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/extensibility/subagents',
        },
      },
      {
        id: 'hooks',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'researching', noteKey: 'hooks.codex' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/extensibility/hooks',
        },
      },
      {
        id: 'slashCommands',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/extensibility/slash-commands',
        },
      },
      {
        id: 'outputStyles',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/extensibility/output-styles',
        },
      },
    ],
  },
  {
    id: 'control',
    features: [
      {
        id: 'permissions',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/control/permissions',
        },
      },
      {
        id: 'sandboxing',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/control/sandboxing',
        },
      },
      {
        id: 'managedSettings',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/control/managed-settings',
        },
      },
      {
        id: 'trustModel',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/control/trust-model',
        },
      },
    ],
  },
  {
    id: 'account',
    features: [
      {
        id: 'authSync',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/account/auth-sync',
        },
      },
      {
        id: 'usageSync',
        cells: {
          claude: { status: 'shipped', noteKey: 'usageSync.claude' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: YODA_ACCOUNT_USAGE_DOC_URL,
        },
      },
      {
        id: 'modelConfig',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/account/model-config',
        },
      },
      {
        id: 'providers',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/account/providers',
        },
      },
    ],
  },
  {
    id: 'workflow',
    features: [
      {
        id: 'worktrees',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/workflow/worktrees',
        },
      },
      {
        id: 'codeReview',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/workflow/code-review',
        },
      },
      {
        id: 'headlessCi',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/workflow/headless-ci',
        },
      },
      {
        id: 'sdk',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/workflow/sdk',
        },
      },
      {
        id: 'ideAcp',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/workflow/ide-acp',
        },
      },
    ],
  },
  {
    id: 'surface',
    features: [
      {
        id: 'statusline',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'researching', noteKey: 'statusline.codex' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/surface/statusline',
        },
      },
      {
        id: 'notifications',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/surface/notifications',
        },
      },
      {
        id: 'keybindings',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/surface/keybindings',
        },
      },
      {
        id: 'planMode',
        cells: {},
        report: { status: 'draft' },
      },
    ],
  },
  {
    id: 'orchestration',
    features: [
      {
        id: 'agentTeams',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/orchestration/agent-teams',
        },
      },
      {
        id: 'routines',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/orchestration/routines',
        },
      },
      {
        id: 'remoteExecution',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/orchestration/remote-execution',
        },
      },
    ],
  },
  {
    id: 'observability',
    features: [
      {
        id: 'telemetry',
        cells: {},
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/observability/telemetry',
        },
      },
      {
        id: 'costTracking',
        cells: {
          claude: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/observability/cost-tracking',
        },
      },
      {
        id: 'transcript',
        cells: {
          claude: { status: 'shipped' },
          codex: { status: 'shipped' },
        },
        report: {
          status: 'published',
          url: 'https://yoda.lovstudio.ai/docs/reference/learn-agent-design/observability/transcript',
        },
      },
    ],
  },
];

export function getRoadmapCell(feature: RoadmapFeature, runtimeId: RuntimeId): RoadmapCell {
  return feature.cells[runtimeId] ?? { status: ROADMAP_FALLBACK_STATUS };
}

export function getRoadmapReport(feature: RoadmapFeature): RoadmapReport {
  return feature.report ?? { status: 'planned' };
}

/** Chapter counts by report status, for the book progress line. */
export function getReportCounts(): Record<RoadmapReportStatus, number> {
  const counts: Record<RoadmapReportStatus, number> = { published: 0, draft: 0, planned: 0 };
  for (const category of ROADMAP_CATEGORIES) {
    for (const feature of category.features) {
      counts[getRoadmapReport(feature).status] += 1;
    }
  }
  return counts;
}

export type RuntimeProgress = {
  shipped: number;
  total: number;
};

/** Shipped count over applicable (non-`na`) features for one runtime column. */
export function getRuntimeProgress(runtimeId: RuntimeId): RuntimeProgress {
  let shipped = 0;
  let total = 0;
  for (const category of ROADMAP_CATEGORIES) {
    for (const feature of category.features) {
      const cell = getRoadmapCell(feature, runtimeId);
      if (cell.status === 'na') continue;
      total += 1;
      if (cell.status === 'shipped') shipped += 1;
    }
  }
  return { shipped, total };
}
