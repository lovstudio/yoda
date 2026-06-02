/**
 * Vitest shim for `better-sqlite3` so tests load a Node-ABI build without
 * disturbing the Electron-ABI build that postinstall produces.
 *
 * The Node-ABI binary is staged by `scripts/ensure-test-native.ts` (run from
 * vitest globalSetup) at a deterministic path.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { testNativeBindingPath } from './ensure-test-native.ts';

const requireFromHere = createRequire(import.meta.url);
// Load real better-sqlite3 by absolute path so vitest's alias does not recurse.
const realPath = requireFromHere.resolve('better-sqlite3', {
  paths: [path.resolve('node_modules')],
});
const RealDatabase = requireFromHere(realPath) as typeof BetterSqlite3 & {
  SqliteError: unknown;
};

const nativeBinding = testNativeBindingPath();

type DatabaseCtor = typeof RealDatabase;
type DatabaseOptions = ConstructorParameters<DatabaseCtor>[1];

function Database(filename: string, options?: DatabaseOptions): InstanceType<DatabaseCtor> {
  const merged = { ...(options ?? {}), nativeBinding } as DatabaseOptions;
  // RealDatabase is callable with `new` — preserve that shape.
  return new (RealDatabase as DatabaseCtor)(filename, merged);
}

// Expose statics from the real module (SqliteError, etc.)
Object.assign(Database, RealDatabase);

export default Database;
export const SqliteError = RealDatabase.SqliteError;
