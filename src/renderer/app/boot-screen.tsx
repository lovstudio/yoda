import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * Boot screen — a terminal-native "kernel boot" splash shown while the app
 * loads its first session. Self-contained palette on purpose: it renders
 * before ThemeProvider applies a theme class, and must match the native
 * BrowserWindow backgroundColor (#111111) so there is no flash on first paint.
 */
const BG = '#111111';
const INK = '#e9e9e6';
const MUTED = 'rgba(233, 233, 230, 0.38)';
const FAINT = 'rgba(233, 233, 230, 0.14)';
const MINT = '#7fe0a7';
const MINT_DIM = 'rgba(127, 224, 167, 0.45)';

/** Minimum time the boot sequence stays up, so it never flashes. */
const MIN_BOOT_MS = 1900;

const WORDMARK = ['Y', 'O', 'D', 'A'];

const BOOT_LOG = [
  'yoda core online',
  'native database attached',
  'pty pool warmed',
  'runtimes linked · claude code / codex / hermes',
  'worktrees mounted',
];

/** Ghost whispers — Yoda-grammar maxims for the agentic age, breathing in the dark. */
const WHISPERS: Array<{
  text: string;
  style: React.CSSProperties;
  delay: number;
  duration: number;
}> = [
  {
    text: 'Do. Or do not. There is no try.',
    style: { top: '16%', left: '11%' },
    delay: 0.4,
    duration: 7,
  },
  {
    text: 'Delegate, you must. Control, you need not.',
    style: { top: '23%', right: '9%' },
    delay: 2.2,
    duration: 8.5,
  },
  {
    text: 'Patience, young operator. Working, the agents are.',
    style: { top: '56%', left: '7%' },
    delay: 1.3,
    duration: 9,
  },
  {
    text: 'Judge an agent by its size, do not.',
    style: { top: '64%', right: '8%' },
    delay: 3.1,
    duration: 7.5,
  },
  {
    text: 'The harness surrounds all. Binds your agents, it does.',
    style: { top: '9%', left: '38%' },
    delay: 1.8,
    duration: 8,
  },
];

/** Yoda conditions — constants on the left, the way of the master. Typed live. */
type CodeSegment = { t: string; c: string };

const CODE_BLOCK_1: CodeSegment[] = [
  { t: 'while', c: MINT },
  { t: ' (', c: FAINT },
  { t: 'null', c: MINT },
  { t: ' === ', c: FAINT },
  { t: 'human', c: INK },
  { t: ') {', c: FAINT },
  { t: '\n  ', c: FAINT },
  { t: 'agents.seek(meaning);', c: MUTED },
  { t: '\n}', c: FAINT },
];

const CODE_BLOCK_2: CodeSegment[] = [
  { t: '\n\n', c: FAINT },
  { t: 'if', c: MINT },
  { t: ' (', c: FAINT },
  { t: 'you', c: MINT },
  { t: ' === ', c: FAINT },
  { t: 'meaning', c: INK },
  { t: ') {', c: FAINT },
  { t: '\n  ', c: FAINT },
  { t: 'harness.bind(you, agents);', c: MUTED },
  { t: '\n}', c: FAINT },
];

function segmentsLength(segments: CodeSegment[]): number {
  return segments.reduce((n, s) => n + s.t.length, 0);
}

const CODE_LEN_1 = segmentsLength(CODE_BLOCK_1);
const CODE_LEN_2 = segmentsLength(CODE_BLOCK_2);

/* Matrix decode — the typing front cycles through rain glyphs before each
   character locks into place. Glyph choice is a pure hash of (index, tick)
   so render stays deterministic. */
const MATRIX_GLYPHS = 'ｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789<>/{}[]=+*:;$#@';
const SCRAMBLE_SPAN = 6;
const MATRIX_BRIGHT = '#aaffcf';
const MATRIX_GLOW = '0 0 7px rgba(127, 224, 167, 0.85), 0 0 18px rgba(127, 224, 167, 0.35)';
const KEYWORD_GLOW = '0 0 6px rgba(127, 224, 167, 0.45)';

/**
 * Render the first `count` characters of a segmented code line, Matrix-style:
 * the last SCRAMBLE_SPAN characters of the typing front render as glowing rain
 * glyphs until the front moves past them and they settle into the real text.
 */
function CodeLine({ segments, count }: { segments: CodeSegment[]; count: number }) {
  const chars = segments.flatMap((s) => Array.from(s.t, (ch) => ({ ch, c: s.c })));
  const fullyTyped = count >= chars.length;
  return (
    <>
      {chars.slice(0, Math.max(0, count)).map((x, idx) => {
        const settled = fullyTyped || idx < count - SCRAMBLE_SPAN || x.ch === '\n' || x.ch === ' ';
        if (settled) {
          return (
            <span
              key={String(idx)}
              style={{ color: x.c, textShadow: x.c === MINT ? KEYWORD_GLOW : undefined }}
            >
              {x.ch}
            </span>
          );
        }
        const glyph = MATRIX_GLYPHS[(idx * 131 + count * 53) % MATRIX_GLYPHS.length];
        return (
          <span
            key={String(idx)}
            className="inline-block w-[1ch]"
            style={{ color: MATRIX_BRIGHT, textShadow: MATRIX_GLOW }}
          >
            {glyph}
          </span>
        );
      })}
    </>
  );
}

interface BootScreenProps {
  /** True once the app has loaded enough to render the real UI. */
  ready: boolean;
  /** Called after the exit animation completes; unmount the splash then. */
  onFinished: () => void;
}

export function BootScreen({ ready, onFinished }: BootScreenProps) {
  const reducedMotion = useReducedMotion();
  const [minElapsed, setMinElapsed] = useState(false);
  const [visibleLogs, setVisibleLogs] = useState(() => (reducedMotion ? BOOT_LOG.length : 0));
  const [exiting, setExiting] = useState(false);

  // Hold the splash for a minimum beat so a fast load doesn't strobe.
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), reducedMotion ? 400 : MIN_BOOT_MS);
    return () => clearTimeout(t);
  }, [reducedMotion]);

  // Tick the boot log in line by line.
  useEffect(() => {
    if (reducedMotion) return;
    const timers = BOOT_LOG.map((_, i) =>
      setTimeout(() => setVisibleLogs((n) => Math.max(n, i + 1)), 320 + i * 230)
    );
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  const done = ready && minElapsed;

  // Yoda condition typewriter — block 1 types during boot, block 2 appends once
  // the operator's session is ready. Both stay on screen.
  const [count1, setCount1] = useState(0);
  const [count2, setCount2] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    // Hold a beat so the wordmark lands first.
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setCount1(i);
        if (i >= CODE_LEN_1) clearInterval(interval);
      }, 26);
    }, 900);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [reducedMotion]);

  const block1Done = reducedMotion || count1 >= CODE_LEN_1;

  useEffect(() => {
    if (reducedMotion || !done || !block1Done) return;
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setCount2(i);
      if (i >= CODE_LEN_2) clearInterval(interval);
    }, 26);
    return () => clearInterval(interval);
  }, [reducedMotion, done, block1Done]);

  const shown1 = reducedMotion ? CODE_LEN_1 : count1;
  const shown2 = reducedMotion ? (done ? CODE_LEN_2 : 0) : count2;
  const codeTyping = (shown1 > 0 && shown1 < CODE_LEN_1) || (shown2 > 0 && shown2 < CODE_LEN_2);

  // Once booted, wait for the operator: click the button or press Enter.
  useEffect(() => {
    if (!done || exiting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') setExiting(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [done, exiting]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] select-none overflow-hidden"
      style={{ backgroundColor: BG }}
      initial={false}
      animate={exiting ? { opacity: 0, scale: 1.02 } : { opacity: 1, scale: 1 }}
      transition={{ duration: reducedMotion ? 0.15 : 0.45, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={() => {
        if (exiting) onFinished();
      }}
    >
      {/* Keep the window draggable where the hidden titlebar lives. */}
      <div className="absolute inset-x-0 top-0 h-10 [-webkit-app-region:drag]" />

      {/* Faint blueprint grid, masked toward the center. */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 75% 65% at 50% 44%, black 25%, transparent 78%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 75% 65% at 50% 44%, black 25%, transparent 78%)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      />

      {/* Ghost whispers — faint Yoda maxims breathing in the background. */}
      <div className="pointer-events-none absolute inset-0">
        {WHISPERS.map((w) => (
          <motion.div
            key={w.text}
            className="absolute whitespace-nowrap font-mono text-[10px] italic"
            style={{ ...w.style, color: INK, letterSpacing: '0.18em' }}
            initial={{ opacity: 0 }}
            animate={reducedMotion ? { opacity: 0.06 } : { opacity: [0.025, 0.095, 0.025] }}
            transition={
              reducedMotion
                ? { duration: 0.5 }
                : {
                    duration: w.duration,
                    delay: w.delay,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }
            }
          >
            {w.text}
          </motion.div>
        ))}
      </div>

      {/* CRT scanline texture. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.014) 0px, rgba(255,255,255,0.014) 1px, transparent 1px, transparent 3px)',
        }}
      />

      {/* Phosphor glow behind the wordmark. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(460px 280px at 50% 44%, rgba(127,224,167,0.07), transparent 70%)',
        }}
      />

      {/* One scan beam sweeping down the screen. */}
      {!reducedMotion && (
        <motion.div
          className="pointer-events-none absolute inset-x-0 h-32"
          style={{
            background:
              'linear-gradient(to bottom, transparent, rgba(127,224,167,0.045) 40%, rgba(255,255,255,0.05) 50%, rgba(127,224,167,0.045) 60%, transparent)',
          }}
          initial={{ top: '-15%' }}
          animate={{ top: '110%' }}
          transition={{ duration: 1.8, ease: [0.55, 0.06, 0.35, 0.95], delay: 0.15 }}
        />
      )}

      {/* Vignette. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 120% 100% at 50% 50%, transparent 55%, rgba(0,0,0,0.5))',
        }}
      />

      {/* Center: wordmark + tagline + progress hairline. */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ transform: 'translateY(-4%)' }}
      >
        {/* The Hood — brand mark. Hardcoded palette, same contract as the rest
            of this screen (renders before any theme class exists). */}
        <motion.svg
          viewBox="0 0 240 220"
          className="mb-7 w-[72px]"
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 18, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.7, delay: 0.05, ease: [0.2, 0.7, 0.3, 1] }}
        >
          <defs>
            <radialGradient id="bootDotGlow" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor={MINT} stopOpacity="0.55" />
              <stop offset="1" stopColor={MINT} stopOpacity="0" />
            </radialGradient>
            <mask id="bootCowl">
              <rect x="-60" y="-60" width="360" height="380" fill="#fff" />
              <path fill="#000" d="M 167.2 120.4 A 50 50 0 1 0 72.8 120.4 L 120 256 Z" />
            </mask>
          </defs>
          <path
            mask="url(#bootCowl)"
            fill={INK}
            d="M 156.4 21.3 L 228.2 162.9 A 34 34 0 0 1 200 216 L 40 216 A 34 34 0 0 1 11.8 162.9 L 83.6 21.3 A 44 44 0 0 1 156.4 21.3 Z"
          />
          {reducedMotion ? (
            <circle cx="120" cy="104" r="36" fill="url(#bootDotGlow)" />
          ) : (
            <motion.circle
              cx="120"
              cy="104"
              r="36"
              fill="url(#bootDotGlow)"
              animate={{ opacity: [0.55, 1, 0.55], scale: [1, 1.16, 1] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
          )}
          <circle cx="120" cy="104" r="13" fill={MINT} />
        </motion.svg>

        <div
          className="flex items-baseline font-mono font-bold"
          style={{ fontSize: 'clamp(56px, 9vw, 92px)', letterSpacing: '0.08em', color: INK }}
        >
          {WORDMARK.map((letter, i) => (
            <motion.span
              key={letter}
              initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 22, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, delay: 0.15 + i * 0.09, ease: [0.2, 0.7, 0.3, 1] }}
            >
              {letter}
            </motion.span>
          ))}
          {/* Terminal block cursor. Blink swaps fill for a hollow outline (like an
              unfocused terminal cursor), so the wordmark keeps its visual right
              edge and the line never feels misaligned. */}
          <motion.span
            className="ml-[0.18em] inline-block w-[0.5ch]"
            style={{
              height: '0.74em',
              border: `1px solid ${MINT}`,
              transform: 'translateY(0.06em)',
            }}
            initial={{ opacity: 0 }}
            animate={
              reducedMotion
                ? { opacity: 1, backgroundColor: MINT }
                : {
                    opacity: 1,
                    backgroundColor: [MINT, MINT, 'rgba(127, 224, 167, 0)', 'rgba(127, 224, 167, 0)'],
                  }
            }
            transition={
              reducedMotion
                ? { delay: 0.2 }
                : {
                    opacity: { duration: 0.3, delay: 0.7 },
                    backgroundColor: {
                      duration: 1.1,
                      times: [0, 0.5, 0.5, 1],
                      repeat: Infinity,
                      ease: 'linear',
                      delay: 0.7,
                    },
                  }
            }
          />
        </div>

        {/* Backronym tagline — Y/O/D/A initials lit in mint, echoing the wordmark. */}
        <motion.div
          className="mt-5 font-mono text-[10px] uppercase"
          style={{ letterSpacing: '0.3em', color: MUTED, paddingLeft: '0.3em' }}
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.55 }}
        >
          <span style={{ color: MINT }}>Y</span>our <span style={{ color: MINT }}>O</span>rchestra
          of <span style={{ color: MINT }}>D</span>elegated <span style={{ color: MINT }}>A</span>
          gents
        </motion.div>

        <motion.div
          className="mt-9 h-px w-56 overflow-hidden"
          style={{ backgroundColor: FAINT }}
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        >
          <motion.div
            className="h-full origin-left"
            style={{
              background: `linear-gradient(to right, ${MINT_DIM}, ${MINT})`,
              boxShadow: `0 0 8px ${MINT_DIM}`,
            }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: done ? 1 : 0.9 }}
            transition={
              done
                ? { duration: 0.2, ease: 'easeOut' }
                : { duration: reducedMotion ? 0.3 : 1.9, ease: [0.3, 0.1, 0.3, 1], delay: 0.4 }
            }
          />
        </motion.div>

        {/* Enter gate — fixed-height slot so the column doesn't shift. */}
        <div className="mt-8 flex h-16 flex-col items-center gap-2.5">
          {done && (
            <>
              <motion.button
                type="button"
                onClick={() => setExiting(true)}
                className="cursor-pointer rounded-sm border px-5 py-2 font-mono text-[11px] uppercase outline-none"
                style={{
                  borderColor: MINT_DIM,
                  color: MINT,
                  letterSpacing: '0.28em',
                  paddingLeft: 'calc(1.25rem + 0.28em)',
                  backgroundColor: 'rgba(127, 224, 167, 0.06)',
                }}
                initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.2, 0.7, 0.3, 1], delay: 0.15 }}
                whileHover={{
                  scale: 1.04,
                  backgroundColor: 'rgba(127, 224, 167, 0.13)',
                  boxShadow: '0 0 24px rgba(127, 224, 167, 0.22)',
                }}
                whileTap={{ scale: 0.97 }}
              >
                Enter Workspace
              </motion.button>
              <motion.div
                className="font-mono text-[10px]"
                style={{ color: MUTED, letterSpacing: '0.14em' }}
                initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.5 }}
              >
                or press enter
              </motion.div>
            </>
          )}
        </div>
      </div>

      {/* Bottom-left: kernel-style boot log. */}
      <div className="absolute bottom-6 left-7 font-mono text-[10px] leading-[1.7]">
        {BOOT_LOG.slice(0, visibleLogs).map((line) => (
          <motion.div
            key={line}
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
          >
            <span style={{ color: FAINT }}>[ </span>
            <span style={{ color: MINT_DIM }}>ok</span>
            <span style={{ color: FAINT }}> ] </span>
            <span style={{ color: MUTED }}>{line}</span>
          </motion.div>
        ))}
        {visibleLogs >= BOOT_LOG.length && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          >
            <span style={{ color: FAINT }}>[ </span>
            {done ? (
              <span style={{ color: MINT }}>ok</span>
            ) : (
              <motion.span
                style={{ color: MUTED, display: 'inline-block' }}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                ..
              </motion.span>
            )}
            <span style={{ color: FAINT }}> ] </span>
            <span style={{ color: done ? INK : MUTED }}>
              {done ? 'session restored — standing by' : 'restoring session'}
            </span>
          </motion.div>
        )}
      </div>

      {/* Bottom-center: credits. */}
      <motion.div
        className="absolute inset-x-0 bottom-6 text-center font-mono text-[10px]"
        style={{ color: FAINT, letterSpacing: '0.12em' }}
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1 }}
      >
        Powered by <span style={{ color: MUTED }}>Lovstudio.ai</span>
        <span className="mx-2">·</span>
        Inspired by <span style={{ color: MUTED }}>Codex</span> &{' '}
        <span style={{ color: MUTED }}>Emdash</span>
      </motion.div>

      {/* Lower-right, pulled toward center: Yoda conditions (block 2 appends on ready). */}
      <div
        className="absolute whitespace-pre text-left font-mono text-[10px] leading-[1.6]"
        style={{ bottom: '14%', right: '12%', letterSpacing: '0.04em' }}
      >
        <CodeLine segments={CODE_BLOCK_1} count={shown1} />
        {done && <CodeLine segments={CODE_BLOCK_2} count={shown2} />}
        {!reducedMotion && codeTyping && (
          <span
            className="ml-px inline-block w-[1ch]"
            style={{
              height: '0.9em',
              backgroundColor: MINT_DIM,
              transform: 'translateY(0.12em)',
            }}
          />
        )}
      </div>
    </motion.div>
  );
}
