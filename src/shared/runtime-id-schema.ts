import { z } from 'zod';
import { RUNTIME_IDS } from './runtime-registry';

/**
 * Keeps persisted settings readable after model-only integrations were removed
 * from the Coding Agent runtime registry.
 */
export const runtimeIdSchema = z.preprocess(
  (value) => (value === 'glm' || value === 'step' ? 'claude' : value),
  z.enum(RUNTIME_IDS)
);
