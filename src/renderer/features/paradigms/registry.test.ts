import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_FEATURE_TEAM_ID,
  BUILTIN_REVIEW_TEAM_ID,
  BUILTIN_TEAMS,
  type AgentTeam,
} from '@shared/agent-team';
import { BUILTIN_PARADIGMS } from '@shared/paradigms/builtins';
import { PARADIGM_KIND_IDS, type ParadigmKindId } from '@shared/paradigms/contract';
import { PARADIGM_KINDS } from '@shared/paradigms/kinds';
import { builtinParadigmId, isBuiltinParadigmId } from '@shared/paradigms/paradigm';
import { DEFAULT_TEAM_COMMUNICATION_CONFIG } from '@shared/team-communication';
import { DEFAULT_ROUTING_HOP_LIMIT } from '@shared/team-routing-limit';
import en from '@renderer/lib/i18n/locales/en.json';
import zh from '@renderer/lib/i18n/locales/zh-CN.json';
import { paradigmEntries, paradigmEntryGroups, paradigmEntryId } from './entries';
import { PARADIGM_ICONS } from './icons';
import { PARADIGM_LAUNCHERS } from './registry';

// The launchers reach the main process and the renderer's global store, both of
// which resolve off `window` at import time. The registry's shape is what is
// under test here, so neither is stood up.
vi.mock('@renderer/lib/ipc', () => ({ rpc: {}, events: { on: vi.fn(), emit: vi.fn() } }));
vi.mock('@renderer/lib/stores/app-state', () => ({ appState: {} }));

function translation(locale: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, segment) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Record<string, unknown>)[segment];
  }, locale);
}

function team(id: string, name: string): AgentTeam {
  return {
    id,
    name,
    icon: '',
    routing: 'sequential',
    communication: DEFAULT_TEAM_COMMUNICATION_CONFIG,
    builtin: true,
    routingHopLimit: DEFAULT_ROUTING_HOP_LIMIT,
    members: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('paradigm registry', () => {
  it('has a launcher, icon, and localized copy for every kind', () => {
    for (const kindId of PARADIGM_KIND_IDS) {
      const kind = PARADIGM_KINDS[kindId];
      expect(kind.kindId, `${kindId} descriptor is keyed by its own id`).toBe(kindId);
      expect(PARADIGM_LAUNCHERS[kindId], `${kindId} has no launcher`).toBeDefined();
      expect(PARADIGM_LAUNCHERS[kindId].descriptor.kindId).toBe(kindId);
      expect(PARADIGM_ICONS[kind.iconId], `${kindId} icon is unmapped`).toBeDefined();
      for (const locale of [en, zh]) {
        for (const key of [kind.labelKey, kind.descriptionKey]) {
          expect(typeof translation(locale, key), `${key} is missing`).toBe('string');
        }
      }
      for (const slot of kind.slots) {
        expect(PARADIGM_ICONS[slot.iconId], `${kindId}.${slot.key} icon is unmapped`).toBeDefined();
        for (const locale of [en, zh]) {
          expect(typeof translation(locale, slot.labelKey), `${slot.labelKey} is missing`).toBe(
            'string'
          );
        }
      }
    }
  });

  it('parses its own default params', () => {
    for (const kindId of PARADIGM_KIND_IDS) {
      const kind = PARADIGM_KINDS[kindId];
      expect(() => kind.paramsSchema.parse(kind.defaultParams), `${kindId} defaults`).not.toThrow();
    }
  });

  it('ships one built-in instance per self-contained kind and none for the rest', () => {
    // A kind sourcing its instances elsewhere (today: one per Agent Team) must not
    // also get a synthesized builtin, or the picker grows a phantom entry.
    expect(BUILTIN_PARADIGMS.map((paradigm) => paradigm.kindId)).toEqual(
      PARADIGM_KIND_IDS.filter((kindId) => PARADIGM_KINDS[kindId].instanceSource === null)
    );
    // Built-in Agent Teams share the `builtin:` namespace and are about to share
    // the instance list too, so a kind's own id must not be able to name a team.
    const teamIds = new Set(BUILTIN_TEAMS.map((team) => team.id));
    for (const paradigm of BUILTIN_PARADIGMS) {
      expect(teamIds.has(paradigm.id), `${paradigm.id} collides with a built-in team`).toBe(false);
      expect(paradigm.id).toBe(builtinParadigmId(paradigm.kindId));
      expect(isBuiltinParadigmId(paradigm.id)).toBe(true);
      expect(paradigm.builtin).toBe(true);
      // Empty label/icon are what make a builtin fall back to its kind's copy.
      expect(paradigm.label).toBe('');
      expect(paradigm.icon).toBe('');
      expect(() =>
        PARADIGM_KINDS[paradigm.kindId].paramsSchema.parse(paradigm.params)
      ).not.toThrow();
    }
  });
});

describe('paradigm entries', () => {
  const teams = [
    team(BUILTIN_FEATURE_TEAM_ID, 'Feature'),
    team(BUILTIN_REVIEW_TEAM_ID, 'Review loop'),
    team('user-team', 'My team'),
  ];

  it('gives every Agent Team its own entry and every other picker kind one', () => {
    const entries = paradigmEntries(teams);
    const teamEntries = entries.filter((entry) => entry.kindId === 'team');
    expect(teamEntries.map((entry) => entry.teamId)).toEqual(
      teams.map((candidate) => candidate.id)
    );

    const pickerKinds = PARADIGM_KIND_IDS.filter(
      (kindId) => PARADIGM_KINDS[kindId].pickerGroup !== null && kindId !== 'team'
    );
    for (const kindId of pickerKinds) {
      expect(entries.filter((entry) => entry.kindId === kindId)).toHaveLength(1);
    }
    // `compare` is reached through the composer's compare affordance, not the picker.
    expect(entries.some((entry) => entry.kindId === 'compare')).toBe(false);
  });

  it('places the feature team with the converged workflows and the rest under multi-agent', () => {
    const groups = paradigmEntryGroups(paradigmEntries(teams));
    const workflow = groups.find((group) => group.labelKey === 'home.modeGroupWorkflow');
    const multiAgent = groups.find((group) => group.labelKey === 'home.modeGroupMultiAgent');

    expect(workflow?.entries[0]?.kindId).toBe('single');
    expect(workflow?.entries.map((entry) => entry.teamId)).toContain(BUILTIN_FEATURE_TEAM_ID);
    expect(multiAgent?.entries.map((entry) => entry.teamId)).toEqual([
      BUILTIN_REVIEW_TEAM_ID,
      'user-team',
    ]);
  });

  it('resolves the active entry by kind, disambiguated by team', () => {
    const entries = paradigmEntries(teams);
    expect(paradigmEntryId(entries, 'team', 'user-team')).toBe('team:user-team');
    expect(paradigmEntryId(entries, 'review', 'user-team')).toBe('review');
    // An unknown team falls back to the kind's first entry rather than nothing.
    expect(paradigmEntryId(entries, 'team', 'gone')).toBe(`team:${BUILTIN_FEATURE_TEAM_ID}`);
  });

  it('keeps the picker usable before the teams have loaded', () => {
    const entries = paradigmEntries([]);
    const kinds = new Set<ParadigmKindId>(entries.map((entry) => entry.kindId));
    expect(kinds.has('single')).toBe(true);
    // Team entries are the teams themselves, so an empty list contributes none
    // and its group drops out rather than rendering an empty section.
    expect(kinds.has('team')).toBe(false);
    expect(paradigmEntryGroups(entries).map((group) => group.labelKey)).toEqual([
      'home.modeGroupWorkflow',
    ]);
  });
});
