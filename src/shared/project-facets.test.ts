import { describe, expect, it } from 'vitest';
import { findProjectFacet, formatFacetInstructions, type ProjectFacet } from './project-facets';

function facet(overrides: Partial<ProjectFacet> = {}): ProjectFacet {
  return { id: 'facet-1', name: 'Mobile', paths: [], ...overrides };
}

describe('formatFacetInstructions', () => {
  it('returns undefined for a facet with no scope information', () => {
    expect(formatFacetInstructions(facet())).toBeUndefined();
  });

  it('lists covered paths', () => {
    expect(formatFacetInstructions(facet({ paths: ['apps/mobile/**', 'src/main/mobile/**'] })))
      .toBe(`Yoda facet context — this task belongs to the "Mobile" facet of this project.
- Scope: apps/mobile/**, src/main/mobile/**`);
  });

  it('points at the context file', () => {
    expect(formatFacetInstructions(facet({ contextFile: 'apps/mobile/AGENTS.md' })))
      .toBe(`Yoda facet context — this task belongs to the "Mobile" facet of this project.
- Read apps/mobile/AGENTS.md before changing anything in this facet.`);
  });

  it('combines paths and context file', () => {
    const text = formatFacetInstructions(
      facet({ paths: ['apps/mobile/**'], contextFile: 'apps/mobile/AGENTS.md' })
    );
    expect(text).toBe(`Yoda facet context — this task belongs to the "Mobile" facet of this project.
- Scope: apps/mobile/**
- Read apps/mobile/AGENTS.md before changing anything in this facet.`);
  });
});

describe('findProjectFacet', () => {
  it('reads a facet by id', () => {
    expect(findProjectFacet([facet()], 'facet-1')?.name).toBe('Mobile');
  });

  it('treats an unassigned task and a deleted definition alike', () => {
    expect(findProjectFacet([facet()], null)).toBeUndefined();
    expect(findProjectFacet([facet()], 'facet-gone')).toBeUndefined();
    expect(findProjectFacet(undefined, 'facet-1')).toBeUndefined();
  });
});
