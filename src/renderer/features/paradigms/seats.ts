import type { Agent } from '@shared/agents';
import { paradigmSlotByStorageKey } from '@shared/paradigms/kinds';
import type { Paradigm } from '@shared/paradigms/paradigm';
import { paradigmParamsAgents } from '@shared/paradigms/params';

/**
 * Which Agent sits in a paradigm's seat.
 *
 * Three layers, most specific first:
 *
 * 1. the instance's own params — what makes duplicating a paradigm worth doing,
 *    since the copy's seats can diverge from the original's;
 * 2. the composer draft, keyed by the bare slot key — where a kind's single
 *    built-in instance keeps its seats, and the inherited default for an instance
 *    the user has not configured;
 * 3. the built-in Agent seeded for that slot, so every paradigm runs untouched.
 *
 * A built-in instance deliberately has no layer 1: there is exactly one per kind,
 * so the draft is already instance-scoped for it, and built-in rows are immutable
 * anyway — which is why the picker offers duplicate before edit.
 */
export function paradigmSeatAgentId({
  paradigm,
  slotStorageKey,
  draftAgents,
  agents,
}: {
  paradigm: Paradigm | undefined;
  slotStorageKey: string;
  draftAgents: Record<string, string[]>;
  agents: Agent[];
}): string | null {
  const fromInstance =
    paradigm && !paradigm.builtin
      ? paradigmParamsAgents(paradigm.params)[slotStorageKey]?.[0]
      : undefined;
  const explicit = fromInstance ?? draftAgents[slotStorageKey]?.[0];
  if (explicit) return explicit;
  const builtinKey = paradigmSlotByStorageKey(slotStorageKey)?.defaultBuiltinAgentKey;
  if (!builtinKey) return null;
  return agents.find((agent) => agent.slug === builtinKey)?.id ?? null;
}
