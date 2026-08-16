import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SelectValue label resolution', () => {
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

  const trigger = () => host.querySelector('[data-slot="select-value"]')?.textContent;

  it('shows the item label instead of the raw value with the popup closed', async () => {
    await act(async () =>
      root.render(
        <Select value="internal">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="internal">内置浏览器</SelectItem>
            <SelectItem value="external">系统浏览器</SelectItem>
          </SelectContent>
        </Select>
      )
    );

    expect(trigger()).toBe('内置浏览器');
  });

  it('resolves labels nested in groups and mapped lists', async () => {
    const options = [
      { value: 'auto', label: '自动' },
      { value: 'fixed', label: '固定' },
    ];

    await act(async () =>
      root.render(
        <Select value="fixed">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    );

    expect(trigger()).toBe('固定');
  });

  it('keeps an explicit SelectValue child untouched', async () => {
    await act(async () =>
      root.render(
        <Select value="internal">
          <SelectTrigger>
            <SelectValue>自定义</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="internal">内置浏览器</SelectItem>
          </SelectContent>
        </Select>
      )
    );

    expect(trigger()).toBe('自定义');
  });
});
