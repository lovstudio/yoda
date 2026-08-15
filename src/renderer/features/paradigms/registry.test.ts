import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_FEATURE_TEAM_ID, BUILTIN_REVIEW_TEAM_ID, BUILTIN_TEAMS } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import { BUILTIN_PARADIGMS } from '@shared/paradigms/builtins';
import { PARADIGM_KIND_IDS, type ParadigmKindId } from '@shared/paradigms/contract';
import { PARADIGM_KINDS, paradigmSlot } from '@shared/paradigms/kinds';
import { builtinParadigmId, isBuiltinParadigmId, type Paradigm } from '@shared/paradigms/paradigm';
import { withParadigmSlotAgent } from '@shared/paradigms/params';
import en from '@renderer/lib/i18n/locales/en.json';
import zh from '@renderer/lib/i18n/locales/zh-CN.json';
import { paradigmEntries, paradigmEntryId, paradigmEntryLabel } from './entries';
import { PARADIGM_ICONS } from './icons';
import { PARADIGM_LAUNCHERS } from './registry';
import { paradigmSeatAgentId } from './seats';

const SINGLE_SEAT = paradigmSlot('single', 'agent').storageKey;

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

function userParadigm(id: string, kindId: ParadigmKindId, label: string): Paradigm {
  return {
    id,
    kindId,
    label,
    icon: '',
    params: PARADIGM_KINDS[kindId].defaultParams,
    builtin: false,
    sortOrder: 0,
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

  it('ships every code-defined instance exactly once, whatever its source', () => {
    for (const paradigm of BUILTIN_PARADIGMS) {
      expect(isBuiltinParadigmId(paradigm.id)).toBe(true);
      expect(paradigm.builtin).toBe(true);
      expect(() =>
        PARADIGM_KINDS[paradigm.kindId].paramsSchema.parse(paradigm.params)
      ).not.toThrow();
    }
    // The `builtin:` namespace is shared across sources, so uniqueness here is what
    // keeps `get(id)` from having to choose between two different instances.
    const ids = BUILTIN_PARADIGMS.map((paradigm) => paradigm.id);
    expect(new Set(ids).size, `duplicate built-in ids: ${ids.join(', ')}`).toBe(ids.length);

    // A kind that sources its instances elsewhere gets no synthesized instance of
    // its own, or the picker grows a phantom entry beside the real ones.
    const kindOwned = BUILTIN_PARADIGMS.filter(
      (paradigm) => paradigm.id === builtinParadigmId(paradigm.kindId)
    );
    expect(kindOwned.map((paradigm) => paradigm.kindId)).toEqual(
      PARADIGM_KIND_IDS.filter((kindId) => PARADIGM_KINDS[kindId].instanceSource === null)
    );
    for (const paradigm of kindOwned) {
      // Empty label/icon are what make a builtin fall back to its kind's copy.
      expect(paradigm.label).toBe('');
      expect(paradigm.icon).toBe('');
    }

    // Built-in teams come across as instances keyed by the team id — rooms
    // reference it, so re-keying them would orphan every existing room.
    const teamOwned = BUILTIN_PARADIGMS.filter((paradigm) => !kindOwned.includes(paradigm));
    expect(teamOwned.map((paradigm) => paradigm.id)).toEqual(BUILTIN_TEAMS.map((team) => team.id));
    for (const paradigm of teamOwned) {
      expect(paradigm.kindId).toBe('team');
      expect(paradigm.label).not.toBe('');
    }
  });
});

describe('paradigm entries', () => {
  const mine = userParadigm('mine', 'single', 'My vibe');
  const paradigms = [...BUILTIN_PARADIGMS, mine];

  it('lists every picker kind flat, with no sections', () => {
    const entries = paradigmEntries(paradigms);
    const kinds = new Set(entries.map((entry) => entry.kindId));
    for (const kindId of PARADIGM_KIND_IDS) {
      expect(
        kinds.has(kindId),
        `${kindId} is ${PARADIGM_KINDS[kindId].inPicker ? 'missing' : 'present'}`
      ).toBe(PARADIGM_KINDS[kindId].inPicker);
    }
    // Every instance is its own row, so the teams contribute one each rather than
    // collapsing into a single "multi-agent" entry.
    expect(entries.filter((entry) => entry.kindId === 'team')).toHaveLength(BUILTIN_TEAMS.length);
    // Ranked ascending, which is the only ordering the flat list has.
    expect(entries.map((entry) => entry.pickerOrder)).toEqual(
      [...entries.map((entry) => entry.pickerOrder)].sort((a, b) => a - b)
    );
    expect(entries[0]?.kindId).toBe('single');
    // A user instance sorts after every built-in, whatever its kind.
    expect(entries.at(-1)?.id).toBe(mine.id);
  });

  it('marks which rows can be edited, and reads each as its category plus its own name', () => {
    const entries = paradigmEntries(paradigms);
    const t = (key: string) => key;

    const builtinSingle = entries.find((entry) => entry.id === builtinParadigmId('single'));
    // Every row names its category, whatever it is itself called.
    expect(builtinSingle?.categoryKey).toBe(PARADIGM_KINDS.single.labelKey);
    // A kind's own built-in has no name of its own, so it reads as the bare
    // category rather than repeating it.
    expect(builtinSingle && paradigmEntryLabel(builtinSingle, t).name).toBeNull();
    expect(builtinSingle?.builtin).toBe(true);

    const feature = entries.find((entry) => entry.id === BUILTIN_FEATURE_TEAM_ID);
    // A team is one of many `team` instances, so it carries both: the category
    // says it is multi-agent, the name says which team.
    expect(feature?.categoryKey).toBe(PARADIGM_KINDS.team.labelKey);
    expect(feature && paradigmEntryLabel(feature, t).name).toBe('home.modeTeamFeature');

    const user = entries.find((entry) => entry.id === mine.id);
    expect(user && paradigmEntryLabel(user, t)).toEqual({
      category: PARADIGM_KINDS.single.labelKey,
      name: 'My vibe',
    });
    expect(user?.builtin).toBe(false);

    // An unnamed instance goes by the Agent in its seat...
    expect(builtinSingle && paradigmEntryLabel(builtinSingle, t, 'cc').name).toBe('cc');
    // ...unless that name only restates the category, which is the common case
    // for a seat's default Agent and reads as a stutter.
    expect(
      builtinSingle && paradigmEntryLabel(builtinSingle, t, PARADIGM_KINDS.single.labelKey).name
    ).toBeNull();
  });

  it('scopes seats to the instance, so a duplicate diverges from its original', () => {
    const agents = [
      { id: 'agent-a', slug: 'a' },
      { id: 'agent-b', slug: 'b' },
    ] as Agent[];
    const configured: Paradigm = {
      ...mine,
      params: withParadigmSlotAgent(mine.params, SINGLE_SEAT, 'agent-b'),
    };
    const seat = (paradigm: Paradigm | undefined) =>
      paradigmSeatAgentId({
        paradigm,
        slotStorageKey: SINGLE_SEAT,
        draftAgents: { [SINGLE_SEAT]: ['agent-a'] },
        agents,
      });

    // The instance's own assignment wins over the draft's — that is what makes a
    // duplicated paradigm worth having.
    expect(seat(configured)).toBe('agent-b');
    // An unconfigured instance inherits the draft, so duplicating changes nothing
    // until the copy is actually edited.
    expect(seat(mine)).toBe('agent-a');
    // A built-in has no params to write: there is one per kind, so the draft is
    // already instance-scoped for it.
    expect(seat(BUILTIN_PARADIGMS.find((p) => p.id === builtinParadigmId('single')))).toBe(
      'agent-a'
    );
  });

  it('resolves the active row by kind, disambiguated by instance', () => {
    const entries = paradigmEntries(paradigms);
    expect(paradigmEntryId(entries, 'team', BUILTIN_REVIEW_TEAM_ID)).toBe(BUILTIN_REVIEW_TEAM_ID);
    expect(paradigmEntryId(entries, 'single', mine.id)).toBe(mine.id);
    // A remembered instance of another kind loses to the kind, which is what the
    // rest of the composer is configured for.
    expect(paradigmEntryId(entries, 'review', mine.id)).toBe(builtinParadigmId('review'));
    // A deleted instance degrades to its kind rather than blanking the picker.
    expect(paradigmEntryId(entries, 'single', 'gone')).toBe(builtinParadigmId('single'));
    expect(paradigmEntryId([], 'single', '')).toBeUndefined();
  });

  it('localizes the per-row actions', () => {
    for (const locale of [en, zh]) {
      for (const key of [
        'home.paradigmDuplicate',
        'home.paradigmEdit',
        'home.paradigmRemove',
        'home.paradigmName',
        'home.paradigmNamePlaceholder',
        'home.paradigmAvatar',
      ]) {
        expect(typeof translation(locale, key), `${key} is missing`).toBe('string');
      }
    }
  });
});
