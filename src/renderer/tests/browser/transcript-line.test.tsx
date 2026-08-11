import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { TranscriptLineItem } from '@renderer/features/tasks/components/transcript-line';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIRST_RECORD = {
  type: 'response_item',
  subtype: 'message',
  timestamp: '2026-08-10T08:00:00.000Z',
  message: { role: 'assistant' },
  auditMarker: 'first-record',
};
const SECOND_RECORD = {
  type: 'event_msg',
  timestamp: '2026-08-10T08:01:00.000Z',
  auditMarker: 'second-record',
};
const FIRST_LINE = JSON.stringify(FIRST_RECORD);
const SECOND_LINE = JSON.stringify(SECOND_RECORD);
const FIRST_PRETTY = JSON.stringify(FIRST_RECORD, null, 2);
const SECOND_PRETTY = JSON.stringify(SECOND_RECORD, null, 2);
const FIRST_TIME = new Date(FIRST_RECORD.timestamp).toLocaleTimeString();

function parseCallCount(spy: MockInstance, line: string): number {
  return spy.mock.calls.filter(([value]) => value === line).length;
}

function prettyCallCount(spy: MockInstance, marker: string): number {
  return spy.mock.calls.filter(([value, , space]) => {
    return (
      space === 2 &&
      typeof value === 'object' &&
      value !== null &&
      (value as Record<string, unknown>).auditMarker === marker
    );
  }).length;
}

function toggleDetails(details: HTMLDetailsElement, open: boolean): void {
  details.open = open;
  details.dispatchEvent(new Event('toggle'));
}

describe('TranscriptLineItem', () => {
  let host: HTMLDivElement;
  let root: Root;
  let parseSpy: MockInstance;
  let stringifySpy: MockInstance;

  beforeEach(() => {
    parseSpy = vi.spyOn(JSON, 'parse');
    stringifySpy = vi.spyOn(JSON, 'stringify');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('defers pretty JSON and its pre element until expanded, then releases both on close', async () => {
    await act(async () => root.render(<TranscriptLineItem line={FIRST_LINE} lineNo={7} />));

    expect(parseCallCount(parseSpy, FIRST_LINE)).toBe(1);
    expect(prettyCallCount(stringifySpy, 'first-record')).toBe(0);
    expect(host.querySelector('pre')).toBeNull();
    expect(host.querySelector('summary')?.textContent).toContain(
      '7response_item/message (assistant)'
    );
    expect(host.querySelector('summary')?.textContent).toContain(FIRST_TIME);

    const details = host.querySelector('details');
    expect(details).not.toBeNull();
    await act(async () => toggleDetails(details!, true));

    expect(parseCallCount(parseSpy, FIRST_LINE)).toBe(2);
    expect(prettyCallCount(stringifySpy, 'first-record')).toBe(1);
    expect(host.querySelector('pre')?.textContent).toBe(FIRST_PRETTY);

    await act(async () => toggleDetails(details!, false));

    expect(parseCallCount(parseSpy, FIRST_LINE)).toBe(2);
    expect(prettyCallCount(stringifySpy, 'first-record')).toBe(1);
    expect(host.querySelector('pre')).toBeNull();
  });

  it('does not reparse on a parent render with identical props and updates when the line changes', async () => {
    function Parent({ line, revision }: { line: string; revision: number }) {
      return (
        <div data-revision={revision}>
          <TranscriptLineItem line={line} lineNo={3} />
        </div>
      );
    }

    await act(async () => root.render(<Parent line={FIRST_LINE} revision={0} />));
    expect(parseCallCount(parseSpy, FIRST_LINE)).toBe(1);

    await act(async () => root.render(<Parent line={FIRST_LINE} revision={1} />));
    expect(host.firstElementChild?.getAttribute('data-revision')).toBe('1');
    expect(parseCallCount(parseSpy, FIRST_LINE)).toBe(1);

    const details = host.querySelector('details');
    await act(async () => toggleDetails(details!, true));
    expect(parseCallCount(parseSpy, FIRST_LINE)).toBe(2);
    expect(host.querySelector('pre')?.textContent).toBe(FIRST_PRETTY);

    await act(async () => root.render(<Parent line={SECOND_LINE} revision={2} />));

    expect(parseCallCount(parseSpy, FIRST_LINE)).toBe(2);
    expect(parseCallCount(parseSpy, SECOND_LINE)).toBe(2);
    expect(prettyCallCount(stringifySpy, 'second-record')).toBe(1);
    expect(host.querySelector('summary')?.textContent).toContain('3event_msg');
    expect(host.querySelector('pre')?.textContent).toBe(SECOND_PRETTY);
  });

  it('keeps raw-line fallback semantics without stringifying invalid JSON', async () => {
    const rawLine = 'not-json';
    await act(async () => root.render(<TranscriptLineItem line={rawLine} lineNo={11} />));

    expect(parseCallCount(parseSpy, rawLine)).toBe(1);
    expect(host.querySelector('summary')?.textContent).toBe('11raw');
    expect(host.querySelector('pre')).toBeNull();

    const details = host.querySelector('details');
    await act(async () => toggleDetails(details!, true));

    expect(parseCallCount(parseSpy, rawLine)).toBe(1);
    expect(host.querySelector('pre')?.textContent).toBe(rawLine);
  });
});
