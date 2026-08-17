/**
 * Reply-phase repair shared by every Claude transcript reader.
 *
 * Runtimes only mark a reply "final" when the model itself ended the turn, but
 * turns get cut short constantly — an interrupt, a wake-up notification the
 * agent answers with protocol noise, or a turn still in flight. Those turns end
 * up with prose that nothing marks as final, so a concise view renders the turn
 * as if the agent never spoke. Promoting the last reply of an unconcluded turn
 * keeps "one turn, at least one visible reply" true.
 */
export type ReplyTurnKind = 'turn-start' | 'final-reply' | 'reply' | 'other';

/** Indexes of replies that must be promoted to `final`. */
export function unconcludedTurnReplyIndexes(kinds: ReplyTurnKind[]): Set<number> {
  const promoted = new Set<number>();
  let lastReplyIndex = -1;
  let concluded = false;

  const closeTurn = () => {
    if (!concluded && lastReplyIndex >= 0) promoted.add(lastReplyIndex);
    lastReplyIndex = -1;
    concluded = false;
  };

  kinds.forEach((kind, index) => {
    if (kind === 'turn-start') {
      closeTurn();
      return;
    }
    if (kind === 'final-reply') {
      concluded = true;
      return;
    }
    if (kind === 'reply') lastReplyIndex = index;
  });
  closeTurn();

  return promoted;
}
