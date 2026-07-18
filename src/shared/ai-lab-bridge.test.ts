import { describe, expect, it } from 'vitest';
import {
  AI_LAB_BRIDGE_CHANNEL,
  AI_LAB_IMAGE_EDIT_MAX_DATA_URL_CHARS,
  AI_LAB_IMAGE_EDIT_METHOD,
  parseAiLabBridgeRequest,
} from './ai-lab-bridge';

function request(payload: unknown): Record<string, unknown> {
  return {
    channel: AI_LAB_BRIDGE_CHANNEL,
    kind: 'request',
    requestId: 'request-1',
    method: AI_LAB_IMAGE_EDIT_METHOD,
    payload,
  };
}

describe('AI Lab host bridge', () => {
  it('accepts a valid image edit request', () => {
    const parsed = parseAiLabBridgeRequest(
      request({
        imageDataUrl: 'data:image/png;base64,aGVsbG8=',
        prompt: 'Preserve the subject and render it as a Riso portrait.',
        size: '1024x1024',
        quality: 'high',
        appId: 'spoofed-app',
        ignored: 'not forwarded to IPC',
      })
    );

    expect(parsed).toMatchObject({ method: AI_LAB_IMAGE_EDIT_METHOD, requestId: 'request-1' });
    expect(parsed?.payload).toEqual({
      imageDataUrl: 'data:image/png;base64,aGVsbG8=',
      prompt: 'Preserve the subject and render it as a Riso portrait.',
      size: '1024x1024',
      quality: 'high',
    });
  });

  it('rejects unknown methods, URLs, and invalid options', () => {
    expect(parseAiLabBridgeRequest({ ...request({}), method: 'app.delete' })).toBeNull();
    expect(
      parseAiLabBridgeRequest(request({ imageDataUrl: 'https://example.com/a.png', prompt: 'x' }))
    ).toBeNull();
    expect(
      parseAiLabBridgeRequest(
        request({ imageDataUrl: 'data:image/png;base64,eA==', prompt: 'x', quality: 'ultra' })
      )
    ).toBeNull();
  });

  it('rejects oversized renderer payloads before IPC', () => {
    expect(
      parseAiLabBridgeRequest(
        request({
          imageDataUrl: `data:image/png;base64,${'a'.repeat(AI_LAB_IMAGE_EDIT_MAX_DATA_URL_CHARS)}`,
          prompt: 'x',
        })
      )
    ).toBeNull();
  });
});
