import type { SkillFrontmatter, SkillValidationIssue } from './types';

export const CODEX_SKILL_DESCRIPTION_MAX_LENGTH = 1024;
export const SPEC_SKILL_COMPATIBILITY_MAX_LENGTH = 500;

/**
 * Fields accepted in SKILL.md frontmatter: the Agent Skills spec set
 * (anthropics/skills quick_validate.py) plus documented Claude Code extensions.
 */
const KNOWN_FRONTMATTER_FIELDS = new Set([
  'name',
  'description',
  'when_to_use',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
  'argument-hint',
  'model',
  'disable-model-invocation',
  'user-invocable',
]);

/** Validate a skill name: lowercase, hyphens, 1-64 chars */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(name) && !name.includes('--');
}

/** Parse YAML frontmatter from SKILL.md content */
export function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
  /** False when the leading --- block is missing entirely */
  hasFrontmatter: boolean;
  /** Top-level keys not in the Agent Skills spec / Claude Code field set */
  unknownFields: string[];
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: { name: '', description: '' },
      body: content,
      hasFrontmatter: false,
      unknownFields: [],
    };
  }

  const body = match[2];
  const frontmatter = parseYamlFrontmatterFields(match[1]);
  const unknownFields = Object.keys(frontmatter).filter(
    (key) => !KNOWN_FRONTMATTER_FIELDS.has(key)
  );

  return {
    frontmatter: {
      name: frontmatter['name'] || '',
      description: frontmatter['description'] || '',
      license: frontmatter['license'],
      compatibility: frontmatter['compatibility'],
      'allowed-tools': frontmatter['allowed-tools'],
      when_to_use: frontmatter['when_to_use'],
      'disable-model-invocation': frontmatter['disable-model-invocation'],
      'user-invocable': frontmatter['user-invocable'],
    },
    body,
    hasFrontmatter: true,
    unknownFields,
  };
}

export function skillIssueAgentLabel(agent: SkillValidationIssue['agent']): string {
  return agent === 'codex' ? 'Codex' : 'Spec';
}

export function validateSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  options: {
    skillFilePath?: string;
    hasFrontmatter?: boolean;
    unknownFields?: string[];
  } = {}
): SkillValidationIssue[] {
  const description = frontmatter.description ?? '';
  const name = frontmatter.name ?? '';
  const issues: SkillValidationIssue[] = [];

  if (options.hasFrontmatter === false) {
    issues.push({
      severity: 'error',
      agent: 'spec',
      field: 'frontmatter',
      code: 'spec-frontmatter-missing',
      message: 'SKILL.md is missing the leading YAML frontmatter (--- block)',
      path: options.skillFilePath,
    });
    return issues;
  }

  if (!name.trim()) {
    issues.push({
      severity: 'warning',
      agent: 'spec',
      field: 'name',
      code: 'spec-name-missing',
      message: 'frontmatter has no name field; agents fall back to the directory name',
      path: options.skillFilePath,
    });
  } else if (!isValidSkillName(name)) {
    issues.push({
      severity: 'error',
      agent: 'spec',
      field: 'name',
      code: 'spec-name-invalid',
      message:
        'invalid name: must be kebab-case (lowercase letters, digits, hyphens), max 64 chars',
      path: options.skillFilePath,
    });
  }

  if (/[<>]/.test(description)) {
    issues.push({
      severity: 'warning',
      agent: 'spec',
      field: 'description',
      code: 'spec-description-angle-brackets',
      message: 'description contains angle brackets (< or >), forbidden by the skill spec',
      path: options.skillFilePath,
    });
  }

  const compatibility = frontmatter.compatibility ?? '';
  if (compatibility.length > SPEC_SKILL_COMPATIBILITY_MAX_LENGTH) {
    issues.push({
      severity: 'warning',
      agent: 'spec',
      field: 'compatibility',
      code: 'spec-compatibility-too-long',
      message: `compatibility exceeds maximum length of ${SPEC_SKILL_COMPATIBILITY_MAX_LENGTH} characters`,
      path: options.skillFilePath,
      max: SPEC_SKILL_COMPATIBILITY_MAX_LENGTH,
      actual: compatibility.length,
    });
  }

  const unknownFields = options.unknownFields ?? [];
  if (unknownFields.length > 0) {
    issues.push({
      severity: 'warning',
      agent: 'spec',
      field: 'frontmatter',
      code: 'spec-unknown-fields',
      message: `unknown frontmatter field(s): ${unknownFields.join(', ')}`,
      path: options.skillFilePath,
    });
  }

  if (!description.trim()) {
    issues.push({
      severity: 'error',
      agent: 'codex',
      field: 'description',
      code: 'codex-description-required',
      message: 'invalid description: is required',
      path: options.skillFilePath,
    });
  }

  if (description.length > CODEX_SKILL_DESCRIPTION_MAX_LENGTH) {
    issues.push({
      severity: 'error',
      agent: 'codex',
      field: 'description',
      code: 'codex-description-too-long',
      message: `invalid description: exceeds maximum length of ${CODEX_SKILL_DESCRIPTION_MAX_LENGTH} characters`,
      path: options.skillFilePath,
      max: CODEX_SKILL_DESCRIPTION_MAX_LENGTH,
      actual: description.length,
    });
  }

  return issues;
}

const TOP_LEVEL_FIELD_REGEX = /^([A-Za-z0-9_-]+):\s*(.*)$/;

function parseYamlFrontmatterFields(yamlBlock: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = yamlBlock.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const fieldMatch = lines[i].match(TOP_LEVEL_FIELD_REGEX);
    if (!fieldMatch) continue;

    const key = fieldMatch[1];
    const value = fieldMatch[2].trim();
    const blockStyle = getBlockScalarStyle(value);
    if (blockStyle) {
      const blockLines: string[] = [];
      i += 1;

      for (; i < lines.length; i += 1) {
        const blockLine = lines[i];
        if (blockLine.trim() && TOP_LEVEL_FIELD_REGEX.test(blockLine)) {
          i -= 1;
          break;
        }
        blockLines.push(blockLine);
      }

      fields[key] = formatBlockScalar(blockLines, blockStyle);
      continue;
    }

    fields[key] = unquoteYamlScalar(value);
  }

  return fields;
}

function getBlockScalarStyle(value: string): 'folded' | 'literal' | null {
  if (/^>[+-]?$/.test(value)) return 'folded';
  if (/^\|[+-]?$/.test(value)) return 'literal';
  return null;
}

function formatBlockScalar(lines: string[], style: 'folded' | 'literal'): string {
  const normalized = stripCommonIndent(lines);
  if (style === 'literal') return normalized.join('\n').trim();

  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of normalized) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      paragraphs.push('');
      continue;
    }
    current.push(trimmed);
  }

  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.join('\n').trim();
}

function stripCommonIndent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => (line.trim() ? line.slice(minIndent) : ''));
}

function unquoteYamlScalar(value: string): string {
  const wasDoubleQuoted = value.startsWith('"') && value.endsWith('"');
  const wasSingleQuoted = value.startsWith("'") && value.endsWith("'");
  if (!wasDoubleQuoted && !wasSingleQuoted) return value;

  const unquoted = value.slice(1, -1);
  if (wasDoubleQuoted) return unquoted.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return unquoted.replace(/''/g, "'");
}

function escapeYamlDoubleQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function generateSkillMd(name: string, description: string, body?: string): string {
  const escapedName = escapeYamlDoubleQuoted(name);
  const escapedDesc = escapeYamlDoubleQuoted(description);
  const defaultBody = `# ${name}\n\n${description}\n`;
  const content = body && body.trim() ? body.trim() : defaultBody;
  return `---
name: "${escapedName}"
description: "${escapedDesc}"
---

${content}
`;
}
