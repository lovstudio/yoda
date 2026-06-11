import { eq } from 'drizzle-orm';
import { AppSettingsKeys, type AppSettings, type AppSettingsKey } from '@shared/app-settings';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import type { IInitializable } from '@main/lib/lifecycle';
import { APP_SETTINGS_SCHEMA_MAP } from './schema';
import { getDefaultForKey } from './settings-registry';
import { computeDelta, computeTrueOverrides, isDeepEqual, isPlainObject, mergeDeep } from './utils';

export type { AppSettings, AppSettingsKey } from '@shared/app-settings';
export { AppSettingsKeys } from '@shared/app-settings';

/** Storage rows renamed by the provider→runtime terminology migration.
 *  Old rows are renamed in place on startup; new installs never see them. */
const LEGACY_KEY_RENAMES: Record<string, string> = {
  defaultAgent: 'defaultRuntime',
  agentAutoApproveDefaults: 'runtimeAutoApproveDefaults',
  agentModelCandidates: 'runtimeModelCandidates',
  providerConfigs: 'runtimeConfigs',
};

export class SettingsStore implements IInitializable {
  private cache: Partial<AppSettings> = {};
  /** Serializes write operations per key so concurrent partial updates
   *  (e.g. Settings UI and home-view debounced writes) do not race on the
   *  read-merge-write cycle and clobber each other's fields. */
  private writeQueues: Partial<Record<AppSettingsKey, Promise<unknown>>> = {};

  private async runSerialized<K extends AppSettingsKey, T>(
    key: K,
    task: () => Promise<T>
  ): Promise<T> {
    const prev = this.writeQueues[key] ?? Promise.resolve();
    const next = prev.then(task, task);
    this.writeQueues[key] = next.catch(() => undefined);
    return next;
  }

  /**
   * Returns `undefined` when the key has never been stored (or is corrupt).
   * A stored JSON `null` round-trips as `null` — it is a real value (e.g.
   * theme's explicit "follow system"), not "missing".
   */
  private async readRaw(key: AppSettingsKey): Promise<unknown> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).execute();
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return undefined;
    }
  }

  private async storeRaw(key: AppSettingsKey, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    await db
      .insert(appSettings)
      .values({ key, value: serialized })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: serialized } })
      .execute();
  }

  private async deleteRow(key: AppSettingsKey): Promise<void> {
    await db.delete(appSettings).where(eq(appSettings.key, key)).execute();
  }

  async get<K extends AppSettingsKey>(key: K): Promise<AppSettings[K]> {
    if (key in this.cache) return this.cache[key] as AppSettings[K];

    const defaults = getDefaultForKey(key);
    const raw = await this.readRaw(key);

    let value: AppSettings[K];
    if (raw === undefined) {
      value = defaults;
    } else if (isPlainObject(raw) && isPlainObject(defaults)) {
      value = mergeDeep(defaults as Record<string, unknown>, raw) as AppSettings[K];
    } else {
      value = raw as AppSettings[K];
    }

    this.cache[key] = value;
    return value;
  }

  async getWithMeta<K extends AppSettingsKey>(
    key: K
  ): Promise<{
    value: AppSettings[K];
    defaults: AppSettings[K];
    overrides: Partial<AppSettings[K]>;
  }> {
    const defaults = getDefaultForKey(key);
    const raw = await this.readRaw(key);

    if (raw === undefined) {
      return { value: defaults, defaults, overrides: {} as Partial<AppSettings[K]> };
    }

    let value: AppSettings[K];
    let overrides: Partial<AppSettings[K]>;

    if (isPlainObject(raw) && isPlainObject(defaults)) {
      value = mergeDeep(defaults as Record<string, unknown>, raw) as AppSettings[K];
      overrides = computeTrueOverrides(raw, defaults as Record<string, unknown>) as Partial<
        AppSettings[K]
      >;
    } else {
      value = raw as AppSettings[K];
      overrides = (isDeepEqual(raw, defaults) ? {} : raw) as Partial<AppSettings[K]>;
    }

    return { value, defaults, overrides };
  }

  async update<K extends AppSettingsKey>(
    key: K,
    value: AppSettings[K] | Partial<AppSettings[K]>
  ): Promise<void> {
    return this.runSerialized(key, async () => {
      const defaults = getDefaultForKey(key);

      // For object settings, accept partial updates and merge with the
      // currently stored value. This keeps the renderer simple (it sends only
      // the changed fields) and avoids the race where the renderer's cache is
      // not yet populated and would otherwise send an incomplete object that
      // fails strict schema validation.
      let toValidate: unknown = value;
      if (isPlainObject(value) && isPlainObject(defaults)) {
        const current = await this.get(key);
        toValidate = isPlainObject(current)
          ? mergeDeep(current as Record<string, unknown>, value as Record<string, unknown>)
          : value;
      }

      const validated = APP_SETTINGS_SCHEMA_MAP[key].parse(toValidate) as AppSettings[K];

      if (isPlainObject(validated) && isPlainObject(defaults)) {
        const delta = computeDelta(
          validated as Record<string, unknown>,
          defaults as Record<string, unknown>
        );
        if (Object.keys(delta).length === 0) {
          await this.deleteRow(key);
        } else {
          await this.storeRaw(key, delta);
        }
      } else if (isDeepEqual(validated, defaults)) {
        await this.deleteRow(key);
      } else {
        await this.storeRaw(key, validated);
      }

      delete this.cache[key];
    });
  }

  async reset<K extends AppSettingsKey>(key: K): Promise<void> {
    return this.runSerialized(key, async () => {
      await this.deleteRow(key);
      delete this.cache[key];
    });
  }

  async resetField<K extends AppSettingsKey>(key: K, field: keyof AppSettings[K]): Promise<void> {
    return this.runSerialized(key, async () => {
      const raw = await this.readRaw(key);
      if (!isPlainObject(raw)) return;

      const delta = { ...raw };
      delete delta[field as string];

      if (Object.keys(delta).length === 0) {
        await this.deleteRow(key);
      } else {
        await this.storeRaw(key, delta);
      }
      delete this.cache[key];
    });
  }

  async getAll(): Promise<AppSettings> {
    const entries = await Promise.all(
      AppSettingsKeys.map(async (key) => [key, await this.get(key)] as const)
    );
    return Object.fromEntries(entries) as AppSettings;
  }

  private async migrateLegacyKeys(): Promise<void> {
    for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_RENAMES)) {
      const [oldRow] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, oldKey))
        .execute();
      if (!oldRow) continue;
      const [newRow] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, newKey))
        .execute();
      if (!newRow) {
        await db.insert(appSettings).values({ key: newKey, value: oldRow.value }).execute();
      }
      await db.delete(appSettings).where(eq(appSettings.key, oldKey)).execute();
    }
  }

  async initialize(): Promise<void> {
    await this.migrateLegacyKeys();
    await this.getAll();
  }
}

export const appSettingsService = new SettingsStore();
