import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runtimeIdSchema } from './runtime-id-schema';

describe('runtimeIdSchema', () => {
  it.each(['glm', 'step'])('migrates the retired %s runtime to Claude Code', (runtimeId) => {
    expect(runtimeIdSchema.parse(runtimeId)).toBe('claude');
  });

  it('migrates retired runtime ids used as persisted record keys', () => {
    const schema = z.partialRecord(runtimeIdSchema, z.boolean());
    expect(schema.parse({ glm: true })).toEqual({ claude: true });
  });
});
