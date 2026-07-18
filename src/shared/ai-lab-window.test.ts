import { describe, expect, it } from 'vitest';
import {
  AI_LAB_WINDOW_TARGET_PARAM,
  encodeAiLabWindowTarget,
  parseAiLabWindowTargetParam,
  parseAiLabWindowTargetSearch,
  type AiLabWindowTarget,
} from './ai-lab-window';

describe('AI Lab window targets', () => {
  it('round-trips an app target through a search param', () => {
    const target: AiLabWindowTarget = { appId: 'app-1' };
    const params = new URLSearchParams();
    params.set(AI_LAB_WINDOW_TARGET_PARAM, encodeAiLabWindowTarget(target));

    expect(parseAiLabWindowTargetSearch(`?${params.toString()}`)).toEqual(target);
  });

  it('accepts a non-empty app id', () => {
    expect(parseAiLabWindowTargetParam('{"appId":"app-1"}')).toEqual({ appId: 'app-1' });
  });

  it('rejects missing and malformed input', () => {
    expect(parseAiLabWindowTargetParam(null)).toBeNull();
    expect(parseAiLabWindowTargetParam('not json')).toBeNull();
    expect(parseAiLabWindowTargetParam('{"appId":""}')).toBeNull();
    expect(parseAiLabWindowTargetParam('{"appId":42}')).toBeNull();
  });
});
