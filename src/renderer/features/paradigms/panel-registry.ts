import type { ComponentType } from 'react';
import type { ParadigmKindId } from '@shared/paradigms/contract';
import { TeamParadigmPanel } from './kinds/team/panel';
import type { ParadigmPanelProps } from './panel-context';

/**
 * What each kind adds to its configuration panel beyond its Agent seats. Seats
 * are rendered generically from the descriptor, so a kind only appears here when
 * it has something else to say — a roster, a round limit, a destination note.
 *
 * Indexed directly rather than through a getter: the panel is a component, and a
 * lookup that reads as a function call would be constructing one per render.
 */
export const PARADIGM_PANELS: Partial<Record<ParadigmKindId, ComponentType<ParadigmPanelProps>>> = {
  team: TeamParadigmPanel,
};
