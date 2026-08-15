import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@shared/agents';
import { BUILTIN_PARADIGMS } from '@shared/paradigms/builtins';
import { PARADIGM_KIND_IDS, type ParadigmKindId } from '@shared/paradigms/contract';
import { PARADIGM_KINDS, paradigmSlot } from '@shared/paradigms/kinds';
import { builtinParadigmId, isBuiltinParadigmId, type Paradigm } from '@shared/paradigms/paradigm';
import { withParadigmSlotAgent } from '@shared/paradigms/params';
import en from '@renderer/lib/i18n/locales/en.json';
import zh from '@renderer/lib/i18n/locales/zh-CN.json';
import {
  paradigmEntries,
  paradigmEntryId,
  paradigmEntryLabel,
  type ParadigmEntry,
} from './entries';
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

  it('ships exactly one code-defined instance per kind', () => {
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

    // Every kind is pickable before the user has configured anything, so every
    // kind owns a shipped instance — none may be missing, none may be extra.
    const kindOwned = BUILTIN_PARADIGMS.filter(
      (paradigm) => paradigm.id === builtinParadigmId(paradigm.kindId)
    );
    expect(kindOwned.map((paradigm) => paradigm.kindId)).toEqual([...PARADIGM_KIND_IDS]);
    for (const paradigm of kindOwned) {
      // Empty label/icon are what make a builtin fall back to its kind's copy.
      expect(paradigm.label).toBe('');
      expect(paradigm.icon).toBe('');
    }

    expect(BUILTIN_PARADIGMS.filter((paradigm) => !kindOwned.includes(paradigm))).toEqual([]);
  });
});

describe('paradigm entries', () => {
  const mine = userParadigm('mine', 'single', 'My vibe');
  // A second team beside the one the multi-agent kind ships: the shipped instance
  // is the way of working, and duplicating it is how a user keeps several rosters.
  const squad = userParadigm('squad', 'team', 'My squad');
  const paradigms = [...BUILTIN_PARADIGMS, squad, mine];

  it('lists every picker kind flat, with no sections', () => {
    const entries = paradigmEntries(paradigms);
    const kinds = new Set(entries.map((entry) => entry.kindId));
    for (const kindId of PARADIGM_KIND_IDS) {
      expect(
        kinds.has(kindId),
        `${kindId} is ${PARADIGM_KINDS[kindId].inPicker ? 'missing' : 'present'}`
      ).toBe(PARADIGM_KINDS[kindId].inPicker);
    }
    // Every instance is its own row, so each team contributes one rather than
    // collapsing into a single "multi-agent" entry — the shipped one included.
    expect(entries.filter((entry) => entry.kindId === 'team').map((entry) => entry.id)).toEqual([
      builtinParadigmId('team'),
      squad.id,
    ]);
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

    const team = entries.find((entry) => entry.id === squad.id);
    // A team is one of many `team` instances, so it carries both: the category
    // says it is multi-agent, the name says which team.
    expect(team?.categoryKey).toBe(PARADIGM_KINDS.team.labelKey);
    expect(team && paradigmEntryLabel(team, t).name).toBe('My squad');
    expect(team?.builtin).toBe(false);

    const user = entries.find((entry) => entry.id === mine.id);
    expect(user && paradigmEntryLabel(user, t)).toEqual({
      category: PARADIGM_KINDS.single.labelKey,
      name: 'My vibe',
    });
    expect(user?.builtin).toBe(false);

    // A name that only restates the category is dropped: it reads as a stutter
    // and costs the width the real qualifier needs.
    expect(
      paradigmEntryLabel({ ...(team as ParadigmEntry), name: PARADIGM_KINDS.team.labelKey }, t).name
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
    // A built-in is a default, not a fixture: unconfigured it inherits the draft,
    // and once a seat is assigned on it that assignment is its own.
    const builtin = BUILTIN_PARADIGMS.find((p) => p.id === builtinParadigmId('single'));
    expect(seat(builtin)).toBe('agent-a');
    expect(
      builtin &&
        seat({ ...builtin, params: withParadigmSlotAgent(builtin.params, SINGLE_SEAT, 'agent-b') })
    ).toBe('agent-b');
  });

  it('resolves the active row by kind, disambiguated by instance', () => {
    const entries = paradigmEntries(paradigms);
    expect(paradigmEntryId(entries, 'team', squad.id)).toBe(squad.id);
    expect(paradigmEntryId(entries, 'single', mine.id)).toBe(mine.id);
    // A remembered instance of another kind loses to the kind, which is what the
    // rest of the composer is configured for — landing on the kind's shipped row.
    expect(paradigmEntryId(entries, 'team', mine.id)).toBe(builtinParadigmId('team'));
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
