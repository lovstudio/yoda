export type ActiveTaskReference = {
  id: string;
  name: string;
};

export type ActiveTaskBranchRow = ActiveTaskReference & {
  projectId: string;
  taskBranch: string | null;
};

export function groupActiveTasksByBranch(
  rows: ActiveTaskBranchRow[]
): Map<string, Map<string, ActiveTaskReference>> {
  const byProject = new Map<string, Map<string, ActiveTaskReference>>();
  for (const row of rows) {
    if (!row.taskBranch) continue;
    const byBranch = byProject.get(row.projectId) ?? new Map<string, ActiveTaskReference>();
    if (!byBranch.has(row.taskBranch)) {
      byBranch.set(row.taskBranch, { id: row.id, name: row.name });
    }
    byProject.set(row.projectId, byBranch);
  }
  return byProject;
}
