import { describe, expect, it } from 'vitest';
import { normalizeAiLabBridgeError } from './bridge-error';

describe('AI Lab bridge errors', () => {
  it('removes Electron RPC boilerplate while preserving the actionable error', () => {
    expect(
      normalizeAiLabBridgeError(
        new Error(
          "Error invoking remote method 'aiLab.editAppImage': Error: ZenMux image request failed (404): Requested model is not valid"
        )
      )
    ).toBe('ZenMux image request failed (404): Requested model is not valid');
  });

  it('keeps ordinary errors intact', () => {
    expect(normalizeAiLabBridgeError(new Error('ZenMux is not connected.'))).toBe(
      'ZenMux is not connected.'
    );
  });
});
