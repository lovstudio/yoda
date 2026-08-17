import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AvatarValue } from '@renderer/lib/components/avatar-value';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AvatarValue', () => {
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

  it('renders an image data URL as an image instead of visible text', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await act(async () =>
      root.render(<AvatarValue name="Design team" value={dataUrl} className="size-4" />)
    );

    expect(host.querySelector('img')?.getAttribute('src')).toBe(dataUrl);
    expect(host.textContent).not.toContain(dataUrl);
  });

  it('keeps glyph avatars as text', async () => {
    await act(async () =>
      root.render(<AvatarValue name="Review team" value="🔍" className="size-4" />)
    );

    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('🔍');
  });

  it('falls back to the initial for a payload no image scheme claims', async () => {
    // Anything this long is a payload, not a glyph — an unrecognized data URI
    // scheme, a path, raw markup. Printing it would spill across the caller.
    await act(async () =>
      root.render(
        <AvatarValue name="Implementer" value="<svg viewBox='0 0 27 6'></svg>" className="size-4" />
      )
    );

    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('I');
  });
});
