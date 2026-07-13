import type { Terminal } from '@xterm/xterm';

class MockCell {
  private chars = '';
  private width = 1;

  set(chars: string, width: number): void {
    this.chars = chars;
    this.width = width;
  }

  getChars(): string {
    return this.chars;
  }

  getWidth(): number {
    return this.width;
  }
}

class MockBufferLine {
  readonly length: number;
  readonly isWrapped: boolean;

  constructor(
    private readonly text: string,
    options: { cols?: number; isWrapped?: boolean } = {}
  ) {
    this.length = Math.max(options.cols ?? text.length, text.length);
    this.isWrapped = options.isWrapped ?? false;
  }

  translateToString(trimRight?: boolean): string {
    return trimRight ? this.text.trimEnd() : this.text.padEnd(this.length);
  }

  getCell(index: number, cell: MockCell): MockCell {
    const chars = this.text[index] ?? '';
    cell.set(chars, chars ? 1 : 0);
    return cell;
  }
}

export function makeTerminal(
  lines: Array<string | { text: string; isWrapped?: boolean }>,
  options: { cols?: number } = {}
): Terminal {
  const bufferLines = lines.map((line) =>
    typeof line === 'string'
      ? new MockBufferLine(line, options)
      : new MockBufferLine(line.text, { ...options, ...line })
  );

  return {
    buffer: {
      active: {
        getLine: (index: number) => bufferLines[index],
        getNullCell: () => new MockCell(),
      },
    },
  } as unknown as Terminal;
}
