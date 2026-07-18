import { describe, expect, it } from 'vitest';
import { applySandboxPolicy } from '../sandbox-policy';

describe('AI Lab app sandbox', () => {
  it('injects a policy that denies network and parent-origin capabilities', () => {
    const source = applySandboxPolicy('<!doctype html><html><head></head><body></body></html>');
    expect(source).toContain("default-src 'none'");
    expect(source).toContain("connect-src 'none'");
    expect(source.indexOf('Content-Security-Policy')).toBeLessThan(source.indexOf('</head>'));
  });
});
