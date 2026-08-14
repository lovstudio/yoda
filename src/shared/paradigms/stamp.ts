import type { ParadigmKindId } from './contract';
import { paradigmKind } from './kinds';
import { builtinParadigmId } from './paradigm';

/**
 * What gets recorded on a task to remember the paradigm driving it.
 *
 * Before this existed the paradigm was lost the instant a task was created, and
 * the canvas had to guess by looking for a team room or a review orchestration
 * row. Lives in shared because both the composer that writes it and the task
 * layer that stores it need the shape.
 *
 * `params` is a snapshot, not a pointer: renaming, re-parameterizing, or deleting
 * an instance must not rewrite the history of the tasks it already started.
 */
export interface ParadigmStamp {
  paradigmId: string;
  paradigmKind: ParadigmKindId;
  paradigmParams: unknown;
}

/**
 * The stamp for a kind running its own code-defined instance with default params
 * — what every kind gets unless its launcher says otherwise.
 */
export function defaultParadigmStamp(kindId: ParadigmKindId): ParadigmStamp {
  return {
    paradigmId: builtinParadigmId(kindId),
    paradigmKind: kindId,
    paradigmParams: paradigmKind(kindId).defaultParams,
  };
}
