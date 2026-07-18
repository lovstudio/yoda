import { describe, expect, it } from 'vitest';
import { applySandboxPolicy } from '../sandbox-policy';

describe('AI Lab app sandbox', () => {
  it('denies direct network access and injects the narrow host bridge', () => {
    const source = applySandboxPolicy('<!doctype html><html><head></head><body></body></html>');
    expect(source).toContain("default-src 'none'");
    expect(source).toContain("connect-src 'none'");
    expect(source).toContain("Object.defineProperty(globalThis,'yoda'");
    expect(source).toContain('M="images.edit"');
    expect(source).toContain('E="errors.copyLast"');
    expect(source).toContain('copyLastError');
    expect(source).toContain('parent.postMessage');
    expect(source).not.toContain('apiKey');
    expect(source.indexOf('Content-Security-Policy')).toBeLessThan(source.indexOf('</head>'));
    expect(source.indexOf("Object.defineProperty(globalThis,'yoda'")).toBeLessThan(
      source.indexOf('</head>')
    );
  });
});
