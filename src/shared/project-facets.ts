import z from 'zod';

/**
 * A named long-lived sub-scope of a project — the mobile app, the plugin
 * surface, the docs site. A facet is the *membership* a task carries, distinct
 * from `parentTaskId`, which records *lineage* (which branch it forked from).
 *
 * `contextFile` is a repo-relative path, not inlined content: the agent CLIs
 * already resolve `AGENTS.md` / `CLAUDE.md` by directory hierarchy, so pointing
 * at a real file lets the agent read as deep as it needs instead of us
 * reimplementing inheritance.
 */
export const projectFacetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Globs this facet covers. Advisory today — used to orient the agent. */
  paths: z.array(z.string().trim().min(1)).default([]),
  contextFile: z.string().trim().optional(),
});

export type ProjectFacet = z.infer<typeof projectFacetSchema>;

/**
 * The value a facet picker uses for "belongs to no facet". Radio groups and
 * selects need a non-empty string, and facet ids are opaque, so pickers share
 * this sentinel rather than each inventing one.
 */
export const UNASSIGNED_FACET_VALUE = '__unassigned__';

export function findProjectFacet(
  facets: ProjectFacet[] | undefined,
  facetId: string | undefined | null
): ProjectFacet | undefined {
  if (!facetId) return undefined;
  return facets?.find((facet) => facet.id === facetId);
}

/**
 * The agent-facing system-prompt block for a facet. Hardcoded English, matching
 * `AUTOMATION_SESSION_INSTRUCTIONS` — this text is read by the agent CLI, not
 * by the user, so it does not go through i18n.
 *
 * Returns undefined when the facet carries no scope information, so an empty
 * facet never injects a content-free block.
 */
export function formatFacetInstructions(facet: ProjectFacet): string | undefined {
  const paths = facet.paths.map((path) => path.trim()).filter(Boolean);
  const contextFile = facet.contextFile?.trim();
  if (paths.length === 0 && !contextFile) return undefined;

  const lines = [
    `Yoda facet context — this task belongs to the "${facet.name}" facet of this project.`,
  ];
  if (paths.length > 0) lines.push(`- Scope: ${paths.join(', ')}`);
  if (contextFile) {
    lines.push(`- Read ${contextFile} before changing anything in this facet.`);
  }
  return lines.join('\n');
}
