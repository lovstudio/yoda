import { ensureTestNative } from './ensure-test-native.ts';

export default async function setup(): Promise<void> {
  const nativePath = await ensureTestNative();
  process.env.YODA_TEST_BETTER_SQLITE3_BINDING = nativePath;
}
