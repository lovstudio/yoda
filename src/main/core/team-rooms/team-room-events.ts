import type { RoomMessage } from '@shared/team-room';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';

/**
 * Main-only hooks (not bridged to the renderer). The RoomConductor (Phase 2)
 * subscribes to `room:message-posted` to drive @-mention routing, so the
 * message store stays decoupled from the routing engine.
 */
export type TeamRoomHooks = {
  'room:message-posted': (roomId: string, message: RoomMessage) => void | Promise<void>;
};

class TeamRoomEvents implements Hookable<TeamRoomHooks> {
  private readonly _core = new HookCore<TeamRoomHooks>((name, e) =>
    log.error(`TeamRoomEvents: ${String(name)} hook error`, e)
  );

  on<K extends keyof TeamRoomHooks>(name: K, handler: TeamRoomHooks[K]) {
    return this._core.on(name, handler);
  }

  _emit<K extends keyof TeamRoomHooks>(name: K, ...args: Parameters<TeamRoomHooks[K]>): void {
    this._core.callHookBackground(name, ...args);
  }
}

export const teamRoomEvents = new TeamRoomEvents();
