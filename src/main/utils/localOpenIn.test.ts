import { describe, expect, it } from 'vitest';
import { OPEN_IN_APPS } from '@shared/openInApps';
import { buildLocalOpenCommand, normalizeOpenFileLocation } from './localOpenIn';
import { quoteShellArg } from './shellEscape';

describe('localOpenIn', () => {
  const vscodeDarwin = OPEN_IN_APPS.vscode.platforms.darwin;

  it('builds VS Code --goto commands with a single quoted path-location argument', () => {
    const command = buildLocalOpenCommand(
      vscodeDarwin,
      "/tmp/space and 'quote'/file.ts",
      normalizeOpenFileLocation(31, 4)
    );

    expect(command).toContain("code --goto '/tmp/space and '\\''quote'\\''/file.ts:31:4'");
    expect(command).toContain(
      "open -n -b com.microsoft.VSCode --args --goto '/tmp/space and '\\''quote'\\''/file.ts:31:4'"
    );
    expect(command).toContain(
      "open -n -a \"Visual Studio Code\" --args --goto '/tmp/space and '\\''quote'\\''/file.ts:31:4'"
    );
  });

  it('uses the regular command when no location is requested', () => {
    const command = buildLocalOpenCommand(vscodeDarwin, '/tmp/file.ts', null);

    expect(command).toContain("code '/tmp/file.ts'");
    expect(command).not.toContain('--goto');
  });

  it('supports a line without adding an empty column', () => {
    const command = buildLocalOpenCommand(
      vscodeDarwin,
      '/Users/mark/lovstudio/coding/yoda/src/renderer/tests/terminal-file-links.test.ts',
      normalizeOpenFileLocation(31, undefined)
    );

    expect(command).toContain("terminal-file-links.test.ts:31'");
    expect(command).not.toContain('terminal-file-links.test.ts:31:');
  });

  it('validates line and column values', () => {
    expect(normalizeOpenFileLocation(undefined, undefined)).toBeNull();
    expect(normalizeOpenFileLocation(31, undefined)).toEqual({ line: 31 });
    expect(() => normalizeOpenFileLocation(undefined, 4)).toThrow('requires a line');
    expect(() => normalizeOpenFileLocation(0, undefined)).toThrow('Invalid file line');
    expect(() => normalizeOpenFileLocation(31, 1.5)).toThrow('Invalid file column');
  });

  it('does not expand template-like text introduced by a user path', () => {
    const target = "/tmp/{{path}}/{{path_raw}}/{{path_location}}/{{path_location_raw}}'; touch PWN";
    const command = buildLocalOpenCommand(vscodeDarwin, target, { line: 31 });
    const firstAttempt = command.split(' || ')[0];

    expect(firstAttempt).toBe(
      `command -v code >/dev/null 2>&1 && code --goto ${quoteShellArg(`${target}:31`)}`
    );
  });
});
