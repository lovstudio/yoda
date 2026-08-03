import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgPreview } from '@renderer/lib/editor/svg-renderer';

vi.mock('@renderer/lib/ipc', () => ({ rpc: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SvgPreview', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders outside a task view and lets its host switch to source mode', async () => {
    const onShowSource = vi.fn();

    await act(async () => {
      root.render(
        <SvgPreview
          filePath="assets/mark.svg"
          modelRootPath="project-file://project-1"
          onShowSource={onShowSource}
        />
      );
    });

    expect(host.textContent).toContain('common.loading');

    expect(host.querySelector('[aria-label="editor.editSource"]')).not.toBeNull();
  });
});
