import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@renderer/lib/components/error-boundary';
import i18n from '@renderer/lib/i18n';

const mocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { viewState: { reset: vi.fn().mockResolvedValue(undefined) } },
}));

vi.mock('@renderer/_legacy/errorTracking', () => ({
  captureComponentError: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function BrokenWorkspace(): never {
  throw new Error('render failed');
}

describe('ErrorBoundary debug copy', () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.copyTextToClipboard.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    consoleError.mockRestore();
    host.remove();
  });

  it('copies the error, JavaScript stack, and React component stack', async () => {
    await act(async () => {
      root.render(
        <ErrorBoundary variant="inline" componentName="WorkspaceView">
          <BrokenWorkspace />
        </ErrorBoundary>
      );
    });

    const copyButton = [...host.querySelectorAll('button')].find((button) =>
      /Copy debug info|复制调试信息/.test(button.textContent ?? '')
    );
    expect(copyButton).toBeDefined();

    await act(async () => copyButton?.click());

    expect(mocks.copyTextToClipboard).toHaveBeenCalledOnce();
    const debugInfo = mocks.copyTextToClipboard.mock.calls[0]?.[0] as string;
    expect(debugInfo).toContain('Component: WorkspaceView');
    expect(debugInfo).toContain('Error: render failed');
    expect(debugInfo).toContain('JavaScript stack:');
    expect(debugInfo).toContain('React component stack:');
    expect(debugInfo).toContain('BrokenWorkspace');
  });
});
