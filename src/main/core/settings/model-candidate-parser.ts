import { isValidModelId } from '@shared/model-provider-catalog';

const MAX_CANDIDATES = 40;

const MODEL_CONTEXT_PATTERN = /\bmodels?\b/i;
const MODEL_ALIAS_CONTEXT_PATTERN =
  /\b(?:available|supported|valid|allowed|choose|one\s+of|values?|aliases?|models?|options?)\b/i;

const CANDIDATE_STOP_WORDS = new Set([
  'agent',
  'agents',
  'alias',
  'aliases',
  'always',
  'api',
  'auth',
  'available',
  'branch',
  'cli',
  'code',
  'color',
  'command',
  'commands',
  'config',
  'configuration',
  'default',
  'docs',
  'ephemeral',
  'exec',
  'false',
  'file',
  'format',
  'github',
  'help',
  'http',
  'https',
  'input',
  'json',
  'key',
  'latest',
  'model',
  'models',
  'mode',
  'name',
  'never',
  'none',
  'only',
  'option',
  'optional',
  'options',
  'output',
  'permission',
  'persistence',
  'plan',
  'print',
  'prompt',
  'provider',
  'providers',
  'read',
  'required',
  'run',
  'sandbox',
  'selected',
  'session',
  'small',
  'task',
  'text',
  'title',
  'true',
  'usage',
  'using',
  'value',
  'values',
]);

export function extractModelCandidatesFromText(input: string): string[] {
  const text = stripAnsi(input);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const selectedIndexes = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    if (!MODEL_CONTEXT_PATTERN.test(lines[index])) continue;
    selectedIndexes.add(index);
    if (index > 0) selectedIndexes.add(index - 1);
    if (index + 1 < lines.length) selectedIndexes.add(index + 1);
  }

  const selectedLines =
    selectedIndexes.size > 0
      ? [...selectedIndexes].sort((left, right) => left - right).map((index) => lines[index])
      : [];
  const candidates: string[] = [];
  for (const line of selectedLines) {
    extractLineCandidates(line, candidates);
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  return normalizeModelCandidates(candidates);
}

function extractLineCandidates(line: string, output: string[]): void {
  const explicitList = hasExplicitModelList(line);
  if (/\be\.g\./i.test(line) && !explicitList) return;

  const allowPlainAlias = MODEL_ALIAS_CONTEXT_PATTERN.test(line);
  for (const match of line.matchAll(/[`"']([^`"']{3,100})[`"']/g)) {
    addCandidate(output, match[1], allowPlainAlias);
  }

  const listMatch = line.match(
    /\b(?:models?|values?|aliases?|options?)\b\s*(?::|=|\bare\b)\s*([^.;]+)/i
  );
  if (listMatch) {
    for (const value of listMatch[1].split(/[,\s]+/)) {
      addCandidate(output, value, true);
    }
  }

  for (const match of line.matchAll(
    /(?:[A-Za-z][A-Za-z0-9]*\/)?[A-Za-z0-9][A-Za-z0-9._:+-]{2,80}/g
  )) {
    addCandidate(output, match[0], allowPlainAlias && explicitList);
  }
}

function addCandidate(output: string[], value: string | undefined, allowPlainAlias: boolean): void {
  const candidate = normalizeCandidate(value);
  if (!candidate) return;
  if (!isLikelyCandidate(candidate, allowPlainAlias)) return;
  if (!output.includes(candidate)) output.push(candidate);
}

export function normalizeModelCandidates(values: readonly string[]): string[] {
  const candidates: string[] = [];
  for (const value of values) addCandidate(candidates, value, true);
  return candidates.slice(0, MAX_CANDIDATES);
}

export function hasExplicitModelList(input: string): boolean {
  return (
    /\b(?:available|supported|valid|allowed)\s+models?\b/i.test(input) ||
    /\bmodels?\b\s*(?::|=|\bare\b)/i.test(input) ||
    /\bchoices?\b\s*(?::|=)/i.test(input)
  );
}

function normalizeCandidate(value: string | undefined): string | null {
  let candidate = value?.trim();
  if (!candidate) return null;
  candidate = candidate.replace(/^[<([{"'`]+/, '').replace(/[>})"'`,:;.!?]+$/, '');
  // 结尾 ] 若为模型后缀（如 [1m]）的一部分则保留，仅剥离孤立闭括号
  if (candidate.endsWith(']') && !candidate.includes('[')) {
    candidate = candidate.slice(0, -1);
  }
  return candidate || null;
}

function isLikelyCandidate(value: string, allowPlainAlias: boolean): boolean {
  const lower = value.toLowerCase();
  if (lower.length < 2 || lower.length > 100) return false;
  if (CANDIDATE_STOP_WORDS.has(lower)) return false;
  if (/^\d+(?:\.\d+)*$/.test(lower)) return false;
  if (/^--?/.test(lower)) return false;
  if (/^https?:/.test(lower) || lower.includes('.com')) return false;
  if (!isValidModelId(value)) return false;

  const hasModelShape = /[0-9/_:+.]/.test(value) || (allowPlainAlias && value.includes('-'));
  if (hasModelShape) return true;

  return allowPlainAlias && !CANDIDATE_STOP_WORDS.has(lower);
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '');
}
