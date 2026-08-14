import type { SidebarTaskPriorityGroup } from '@shared/view-state';

export type ActivityBucket = 'today' | 'thisWeek' | 'thisMonth' | 'earlier';

export type SidebarGroupKey =
  | { kind: 'type'; type: 'local' | 'ssh' }
  | { kind: 'activity'; bucket: ActivityBucket }
  | {
      kind: 'priority';
      priority: SidebarTaskPriorityGroup;
      count: number;
    };

export function sidebarGroupId(group: SidebarGroupKey): string {
  if (group.kind === 'type') return `type:${group.type}`;
  if (group.kind === 'activity') return `activity:${group.bucket}`;
  return `priority:${group.priority}`;
}
