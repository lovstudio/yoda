const ESC = '\x1b';
const DA_PRIMARY_PREFIX = `${ESC}[?`;
const DA_SECONDARY_PREFIX = `${ESC}[>`;
const XTVERSION_PREFIX = `${ESC}P>|`;
const STRING_TERMINATOR = `${ESC}\\`;
const MAX_PENDING_REPLY_LENGTH = 512;
const XTERM_VERSION_PAYLOAD = /^xterm\.js\([0-9A-Za-z.+-]+\)$/;

const REPLY_PREFIXES = [DA_PRIMARY_PREFIX, DA_SECONDARY_PREFIX, XTVERSION_PREFIX] as const;

function findNextReplyPrefix(data: string): { index: number; prefix: string } | null {
  let match: { index: number; prefix: string } | null = null;
  for (const prefix of REPLY_PREFIXES) {
    const index = data.indexOf(prefix);
    if (index === -1 || (match && match.index <= index)) continue;
    match = { index, prefix };
  }
  return match;
}

function isDaParameterByte(char: string): boolean {
  return char === ';' || (char >= '0' && char <= '9');
}

/**
 * Removes terminal-identification replies produced by the outer xterm instance
 * before they are written into a tmux client PTY.
 *
 * tmux answers the inner application's DA/XTVERSION queries itself. Forwarding
 * xterm's second reply through the tmux client turns the printable payload into
 * apparent user input. The filter starts buffering only after a distinctive
 * full reply prefix, so ordinary Escape and cursor-key input is never delayed.
 */
export class TmuxTerminalReplyFilter {
  private pending = '';

  feed(data: string): string {
    if (!data) return '';
    let input = this.pending + data;
    this.pending = '';
    let output = '';

    while (input) {
      const match = findNextReplyPrefix(input);
      if (!match) {
        output += input;
        break;
      }

      output += input.slice(0, match.index);
      input = input.slice(match.index);

      if (match.prefix === XTVERSION_PREFIX) {
        const terminatorIndex = input.indexOf(STRING_TERMINATOR, XTVERSION_PREFIX.length);
        if (terminatorIndex === -1) {
          if (input.length <= MAX_PENDING_REPLY_LENGTH) {
            this.pending = input;
          } else {
            output += input;
          }
          break;
        }

        const payload = input.slice(XTVERSION_PREFIX.length, terminatorIndex);
        if (XTERM_VERSION_PAYLOAD.test(payload)) {
          input = input.slice(terminatorIndex + STRING_TERMINATOR.length);
          continue;
        }

        output += input[0];
        input = input.slice(1);
        continue;
      }

      let cursor = match.prefix.length;
      while (cursor < input.length && isDaParameterByte(input[cursor])) cursor += 1;
      if (cursor === input.length) {
        if (input.length <= MAX_PENDING_REPLY_LENGTH) {
          this.pending = input;
        } else {
          output += input;
        }
        break;
      }
      if (input[cursor] === 'c') {
        input = input.slice(cursor + 1);
        continue;
      }

      output += input[0];
      input = input.slice(1);
    }

    return output;
  }

  flush(): string {
    const pending = this.pending;
    this.pending = '';
    return pending;
  }
}
