import type { Agent } from '@shared/agents';
import { paradigmSlotByStorageKey } from '@shared/paradigms/kinds';
import type { Paradigm } from '@shared/paradigms/paradigm';
import { paradigmParamsAgents } from '@shared/paradigms/params';

/**
 * Which Agent sits in a paradigm's seat.
 *
 * Three layers, most specific first:
 *
 * 1. the instance's own params — where every seat assignment is written, and what
 *    makes duplicating a paradigm worth doing, since the copy's seats can diverge
 *    from the original's;
 * 2. the composer draft, keyed by the bare slot key — where seats lived before
 *    they belonged to an instance, kept as the inherited default so an existing
 *    setup carries over untouched;
 * 3. the built-in Agent seeded for that slot, so every paradigm runs unconfigured.
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
  const fromInstance = paradigm
    ? paradigmParamsAgents(paradigm.params)[slotStorageKey]?.[0]
    : undefined;
  const explicit = fromInstance ?? draftAgents[slotStorageKey]?.[0];
  if (explicit) return explicit;
  const builtinKey = paradigmSlotByStorageKey(slotStorageKey)?.defaultBuiltinAgentKey;
  if (!builtinKey) return null;
  return agents.find((agent) => agent.slug === builtinKey)?.id ?? null;
}
