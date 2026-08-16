import type {
  MobileSessionInteraction,
  MobileSessionInteractionKind,
  MobileSessionInteractionOption,
  MobileSessionInteractionSource,
  MobileSessionQuestion,
  MobileSessionRuntimeStatus,
  MobileSessionTranscriptBlock,
} from './mobile-api.js';

const MAX_DESCRIPTION_CHARS = 480;
const MAX_OPTION_CHARS = 180;
const MAX_OPTIONS_PER_QUESTION = 12;

export type MobileSessionInteractionSelections = Readonly<Record<string, readonly string[]>>;

export function resolveMobileSessionInteraction({
  content,
  runtimeId,
  runtimeStatus,
  transcript,
}: {
  content?: string;
  runtimeId: string;
  runtimeStatus: MobileSessionRuntimeStatus;
  transcript: readonly MobileSessionTranscriptBlock[];
}): MobileSessionInteraction | null {
  if (runtimeStatus !== 'awaiting-input') return null;

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const block = transcript[index];
    if (!block || block.role !== 'tool' || block.toolStatus === 'completed') continue;

    const structured = parseStructuredInteraction(block, resolveInteractionSource(runtimeId));
    if (structured) return structured;
  }

  return parseTerminalInteraction(content) ?? createTextInteraction();
}

export function buildMobileSessionInteractionAnswer(
  interaction: MobileSessionInteraction,
  selections: MobileSessionInteractionSelections
): string {
  const answers = interaction.questions
    .map((question) => {
      const values = selections[question.id] ?? [];
      if (values.length === 0) return null;
      if (interaction.questions.length === 1) return values.join(', ');
      const label = question.header || question.prompt;
      return `${label}: ${values.join(', ')}`;
    })
    .filter((answer): answer is string => answer !== null);

  return answers.join('\n');
}

function parseStructuredInteraction(
  block: MobileSessionTranscriptBlock,
  source: MobileSessionInteractionSource
): MobileSessionInteraction | null {
  const input = parseJsonRecord(block.content);
  if (!input) return null;

  const title = block.title ?? '';
  const isPlanApproval = /ExitPlanMode/i.test(title);
  const isQuestionTool =
    /AskUserQuestion|request[_ -]?user[_ -]?input/i.test(title) ||
    Array.isArray(input.questions) ||
    typeof input.question === 'string';

  if (isPlanApproval) {
    const plan = textValue(input.plan);
    return {
      id: `interaction:${block.id}`,
      kind: 'confirmation',
      title: '方案待确认',
      ...(plan ? { description: limitText(plan, MAX_DESCRIPTION_CHARS) } : {}),
      source,
      questions: [
        {
          id: 'plan-confirmation',
          prompt: '是否继续按当前方案执行？',
          multiSelect: false,
          options: [
            { id: 'continue', label: '继续执行', value: 'yes' },
            { id: 'pause', label: '暂不执行', value: 'no' },
          ],
        },
      ],
    };
  }

  if (!isQuestionTool) return null;
  const questions = normalizeQuestions(input);
  if (questions.length === 0) return null;

  const hasOptions = questions.some((question) => question.options.length > 0);
  const kind: MobileSessionInteractionKind = hasOptions ? 'choice' : 'text';
  return {
    id: `interaction:${block.id}`,
    kind,
    title: hasOptions ? '需要你的选择' : '需要你的回应',
    source,
    questions,
  };
}

function normalizeQuestions(input: Record<string, unknown>): MobileSessionQuestion[] {
  const rawQuestions = Array.isArray(input.questions)
    ? input.questions
    : typeof input.question === 'string'
      ? [input]
      : [];

  return rawQuestions
    .map((value, index) => normalizeQuestion(value, index))
    .filter((question): question is MobileSessionQuestion => question !== null);
}

function normalizeQuestion(value: unknown, index: number): MobileSessionQuestion | null {
  const question = recordValue(value);
  if (!question) return null;
  const prompt =
    textValue(question.question) ?? textValue(question.prompt) ?? textValue(question.text);
  if (!prompt) return null;

  const rawOptions = Array.isArray(question.options) ? question.options : [];
  const options = rawOptions
    .map((option, optionIndex) => normalizeOption(option, optionIndex))
    .filter((option): option is MobileSessionInteractionOption => option !== null)
    .slice(0, MAX_OPTIONS_PER_QUESTION);
  const header = textValue(question.header);

  return {
    id: textValue(question.id) ?? `question-${index + 1}`,
    prompt: limitText(prompt, MAX_DESCRIPTION_CHARS),
    ...(header ? { header: limitText(header, 64) } : {}),
    multiSelect: question.multiSelect === true,
    options,
  };
}

function normalizeOption(value: unknown, index: number): MobileSessionInteractionOption | null {
  if (typeof value === 'string') {
    const label = limitText(value, MAX_OPTION_CHARS);
    return label ? { id: `option-${index + 1}`, label, value: label } : null;
  }

  const option = recordValue(value);
  if (!option) return null;
  const label =
    textValue(option.label) ??
    textValue(option.title) ??
    textValue(option.name) ??
    textValue(option.value);
  if (!label) return null;
  const normalizedLabel = limitText(label, MAX_OPTION_CHARS);
  const rawValue = textValue(option.value) ?? normalizedLabel;
  const description = textValue(option.description);
  return {
    id: textValue(option.id) ?? `option-${index + 1}`,
    label: normalizedLabel,
    value: limitText(rawValue, MAX_OPTION_CHARS),
    ...(description ? { description: limitText(description, MAX_DESCRIPTION_CHARS) } : {}),
  };
}

function parseTerminalInteraction(content: string | undefined): MobileSessionInteraction | null {
  if (!content?.trim()) return null;
  const lines = content
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-80);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    const marker = line.match(/(?:\[\s*|\(\s*)(yes|y)\s*\/\s*(no|n)\s*(?:\]|\))\s*$/iu);
    if (!marker || marker.index === undefined) continue;
    const prompt = line
      .slice(0, marker.index)
      .replace(/[:：]\s*$/u, '')
      .trim();
    return {
      id: `interaction:terminal:${index}:${line.slice(0, 48)}`,
      kind: 'confirmation',
      title: '需要确认',
      source: 'terminal',
      questions: [
        {
          id: 'terminal-confirmation',
          prompt: prompt || '是否继续？',
          multiSelect: false,
          options: [
            { id: 'yes', label: '是', value: marker[1].toLowerCase() },
            { id: 'no', label: '否', value: marker[2].toLowerCase() },
          ],
        },
      ],
    };
  }

  const numberedOptions = parseNumberedOptions(lines);
  if (numberedOptions) return numberedOptions;
  return null;
}

function parseNumberedOptions(lines: string[]): MobileSessionInteraction | null {
  const options: MobileSessionInteractionOption[] = [];
  let index = lines.length - 1;
  while (index >= 0) {
    const line = lines[index];
    const match = line?.match(/^\s*(\d+)[.)、]\s+(.{1,180})\s*$/u);
    if (!match) break;
    options.unshift({
      id: `option-${match[1]}`,
      label: limitText(match[2]!, MAX_OPTION_CHARS),
      value: match[1]!,
    });
    index -= 1;
  }
  if (options.length < 2) return null;

  const prompt = lines[index] ?? '请选择一个选项。';
  return {
    id: `interaction:terminal:numbered:${index}`,
    kind: 'choice',
    title: '需要你的选择',
    source: 'terminal',
    questions: [
      {
        id: 'terminal-choice',
        prompt: limitText(prompt, MAX_DESCRIPTION_CHARS),
        multiSelect: false,
        options,
      },
    ],
  };
}

function createTextInteraction(): MobileSessionInteraction {
  return {
    id: 'interaction:freeform',
    kind: 'text',
    title: '需要你的回应',
    source: 'terminal',
    questions: [
      {
        id: 'freeform-response',
        prompt: 'AI 正在等待你的回应，可以直接在下方输入答案。',
        multiSelect: false,
        options: [],
      },
    ],
  };
}

function resolveInteractionSource(runtimeId: string): MobileSessionInteractionSource {
  if (runtimeId === 'claude' || runtimeId === 'codex') return runtimeId;
  return 'terminal';
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function limitText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}
