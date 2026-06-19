import { describe, expect, it } from 'vitest';
import {
  COMPARISON_WINDOW_TARGET_PARAM,
  encodeComparisonWindowTarget,
  parseComparisonWindowTargetParam,
  parseComparisonWindowTargetSearch,
  type ComparisonWindowTarget,
} from './comparison-window';

describe('comparison window targets', () => {
  it('round-trips a multi-pane target through a search param', () => {
    const target: ComparisonWindowTarget = {
      panes: [
        { projectId: 'project-1', taskId: 'task-1' },
        { projectId: 'project-2', taskId: 'task-2' },
      ],
      layout: { kind: 'columns', count: 2 },
    };

    const params = new URLSearchParams();
    params.set(COMPARISON_WINDOW_TARGET_PARAM, encodeComparisonWindowTarget(target));

    expect(parseComparisonWindowTargetSearch(`?${params.toString()}`)).toEqual(target);
  });

  it('accepts a rows layout', () => {
    const target: ComparisonWindowTarget = {
      panes: [{ projectId: 'p', taskId: 't' }],
      layout: { kind: 'rows', count: 1 },
    };
    expect(parseComparisonWindowTargetParam(encodeComparisonWindowTarget(target))).toEqual(target);
  });

  it('rejects empty panes', () => {
    expect(
      parseComparisonWindowTargetParam(
        JSON.stringify({ panes: [], layout: { kind: 'columns', count: 0 } })
      )
    ).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseComparisonWindowTargetParam(null)).toBeNull();
    expect(parseComparisonWindowTargetParam('not json')).toBeNull();
    expect(
      parseComparisonWindowTargetParam(
        JSON.stringify({
          panes: [{ projectId: 'p', taskId: 't' }],
          layout: { kind: 'grid', count: 1 },
        })
      )
    ).toBeNull();
  });
});
