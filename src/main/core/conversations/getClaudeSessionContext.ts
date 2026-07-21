import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentMemory,
  ClaudeSessionContext,
  ClaudeSessionPrompt,
  SessionSummary,
  SessionTranscriptMessage,
} from '@shared/conversations';
import {
  encodeClaudeProjectDir,
  resolveClaudeTranscriptPathFromConfigDir,
} from '@main/core/session-title/claude-title-source';
import { log } from '@main/lib/logger';
import {
  getClaudeCompletedTurnTargets,
  getClaudeCurrentBranchMessageIds,
  isClaudeRealUserPromptRow,
} from './claude-transcript-fork';
import { resolveRuntimeStateDirectory } from './impl/runtime-env';
import { getInstructionFiles } from './instruction-files';
import { scanClaudeAgents } from './scanClaudeAgents';
import { scanClaudeSkills } from './scanClaudeSkills';

/**
 * Aggregates everything that ends up in the LLM prompt for a Claude session:
 *   - Memory files (~/.claude/CLAUDE.md, <cwd>/CLAUDE.md, <cwd>/AGENTS.md)
 *   - Available tools, MCP servers, skills, agent types (from transcript attachments)
 *   - User-authored prompts (filtered to skip tool_result-only rows)
 *
 * The transcript is read once per call (KISS — sessions are KB-to-MB) and the on-disk
 * memory files are read in parallel. Returns null if the transcript is missing.
 */
export async function getClaudeSessionContext(
  cwd: string,
  sessionId: string,
  options: { claudeConfigDir?: string } = {}
): Promise<ClaudeSessionContext | null> {
  const claudeConfigDir =
    options.claudeConfigDir ?? resolveRuntimeStateDirectory('claude', undefined);
  const transcriptPath = resolveClaudeTranscriptPathFromConfigDir(cwd, sessionId, claudeConfigDir);
  let raw: string;
  try {
    raw = await readFile(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const tools = new Set<string>();
  const transcriptAgents = new Set<string>();
  const mcpServers = new Map<string, string>();
  const prompts: ClaudeSessionPrompt[] = [];
  const messages: SessionTranscriptMessage[] = [];
  const completedTurnTargets = getClaudeCompletedTurnTargets(raw);
  const currentBranchMessageIds = getClaudeCurrentBranchMessageIds(raw);
  // Keep only the latest compaction summary — later compactions supersede earlier ones.
  let summary: SessionSummary | null = null;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const parsed = safeParse(line);
    if (!parsed) continue;

    const rowId = typeof parsed.uuid === 'string' ? parsed.uuid : null;
    if (rowId && !currentBranchMessageIds.has(rowId)) continue;

    if (parsed.type === 'attachment') {
      collectAttachment(parsed.attachment, { tools, agents: transcriptAgents, mcpServers });
      continue;
    }

    if (parsed.type === 'user') {
      // Compaction-summary rows are runtime-authored "user" messages; surface
      // them as the session summary, not as a user prompt.
      const compactSummary = extractCompactSummary(parsed);
      if (compactSummary) {
        summary = compactSummary;
        continue;
      }
      const prompt = extractPrompt(parsed, completedTurnTargets);
      if (prompt) {
        prompts.push(prompt);
        messages.push({
          id: prompt.id,
          role: 'user',
          text: prompt.text,
          timestamp: prompt.timestamp,
        });
      }
      continue;
    }

    if (parsed.type === 'assistant') {
      const message = extractAssistantMessage(parsed, messages.length);
      if (message) messages.push(message);
    }
  }

  const [memoryFiles, memories, skills, scannedAgents] = await Promise.all([
    getInstructionFiles(cwd),
    loadMemories(cwd, claudeConfigDir),
    scanClaudeSkills(cwd),
    scanClaudeAgents(cwd),
  ]);

  return {
    transcriptPath,
    memoryFiles,
    memories,
    tools: [...tools].sort(),
    agents: scannedAgents,
    mcpServers: [...mcpServers.entries()].map(([name, instructions]) => ({ name, instructions })),
    skills,
    skillsListing: formatSkillListing(skills),
    prompts,
    messages,
    summary,
  };
}

/**
 * Claude Code writes a compaction summary back into the transcript as a
 * `user` row flagged `isCompactSummary`. The message content holds the full
 * handoff summary ("This session is being continued from a previous
 * conversation…"). We surface it verbatim — never re-summarize.
 */
function extractCompactSummary(row: Record<string, unknown>): SessionSummary | null {
  if (row.isCompactSummary !== true) return null;
  const message = row.message;
  if (!message || typeof message !== 'object') return null;
  const text = extractUserText((message as Record<string, unknown>).content);
  if (!text) return null;
  const timestamp = typeof row.timestamp === 'string' ? row.timestamp : null;
  return { text, timestamp };
}

function formatSkillListing(skills: Array<{ name: string; description: string }>): string {
  return skills
    .map((skill) =>
      skill.description ? `- ${skill.name}: ${skill.description}` : `- ${skill.name}`
    )
    .join('\n');
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch (err) {
    log.debug('getClaudeSessionContext: parse failed', { error: String(err) });
    return null;
  }
}

function collectAttachment(
  attachment: unknown,
  sink: { tools: Set<string>; agents: Set<string>; mcpServers: Map<string, string> }
): void {
  if (!attachment || typeof attachment !== 'object') return;
  const a = attachment as Record<string, unknown>;
  if (a.type === 'deferred_tools_delta') {
    addStrings(a.addedNames, sink.tools);
    removeStrings(a.removedNames, sink.tools);
  } else if (a.type === 'agent_listing_delta') {
    addStrings(a.addedTypes, sink.agents);
    removeStrings(a.removedTypes, sink.agents);
  } else if (a.type === 'mcp_instructions_delta') {
    const names = Array.isArray(a.addedNames) ? a.addedNames : [];
    const blocks = Array.isArray(a.addedBlocks) ? a.addedBlocks : [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const block = blocks[i];
      if (typeof name !== 'string') continue;
      sink.mcpServers.set(name, typeof block === 'string' ? block : '');
    }
    if (Array.isArray(a.removedNames)) {
      for (const name of a.removedNames) {
        if (typeof name === 'string') sink.mcpServers.delete(name);
      }
    }
  }
}

function addStrings(value: unknown, sink: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const v of value) if (typeof v === 'string') sink.add(v);
}

function removeStrings(value: unknown, sink: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const v of value) if (typeof v === 'string') sink.delete(v);
}

function extractPrompt(
  row: Record<string, unknown>,
  completedTurnTargets: Map<string, string>
): ClaudeSessionPrompt | null {
  if (!isClaudeRealUserPromptRow(row)) return null;
  const message = row.message;
  if (!message || typeof message !== 'object') return null;
  const text = extractUserText((message as Record<string, unknown>).content);
  if (!text) return null;
  const timestamp = typeof row.timestamp === 'string' ? row.timestamp : null;
  const uuid = row.uuid as string;
  const targetMessageId = completedTurnTargets.get(uuid);
  return {
    id: uuid,
    text,
    timestamp,
    ...(targetMessageId
      ? { restoreTarget: { kind: 'claude-message' as const, messageId: targetMessageId } }
      : {}),
  };
}

function extractAssistantMessage(
  row: Record<string, unknown>,
  index: number
): SessionTranscriptMessage | null {
  if (row.isSidechain === true) return null;
  if (row.isMeta === true) return null;
  const message = row.message;
  if (!message || typeof message !== 'object') return null;
  const text = extractUserText((message as Record<string, unknown>).content);
  if (!text) return null;
  const timestamp = typeof row.timestamp === 'string' ? row.timestamp : null;
  const uuid = typeof row.uuid === 'string' ? row.uuid : `assistant-${index}`;
  return { id: uuid, role: 'assistant', text, timestamp };
}

function extractUserText(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = stripWrapperTags(content).trim();
    return trimmed || null;
  }
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      const t = stripWrapperTags(b.text).trim();
      if (t) parts.push(t);
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function stripWrapperTags(text: string): string {
  return text
    .replace(/<command-message>[\s\S]*?<\/command-message>\s*/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>\s*/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>\s*/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '');
}

/**
 * Loads the agent-maintained memory store: MEMORY.md (index) plus one .md file
 * per memory fact, each carrying `name` / `description` / `metadata.type`
 * frontmatter. Distinct from CLAUDE.md / AGENTS.md — these files are written
 * by the agent itself, not the user.
 */
async function loadMemories(cwd: string, claudeConfigDir: string): Promise<AgentMemory[]> {
  const dir = join(claudeConfigDir, 'projects', encodeClaudeProjectDir(cwd), 'memory');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const out = await Promise.all(
    names
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map(async (fileName): Promise<AgentMemory | null> => {
        const path = join(dir, fileName);
        let raw: string;
        try {
          raw = await readFile(path, 'utf8');
        } catch {
          return null;
        }
        if (fileName === 'MEMORY.md') {
          return {
            kind: 'index',
            name: 'MEMORY.md',
            description: null,
            type: null,
            path,
            content: raw,
            bytes: raw.length,
          };
        }
        const { name, description, type, body } = parseMemoryFrontmatter(raw);
        return {
          kind: 'entry',
          name: name ?? fileName.slice(0, -3),
          description,
          type,
          path,
          content: body,
          bytes: raw.length,
        };
      })
  );

  const memories = out.filter((x): x is AgentMemory => x !== null);
  // Index first, entries keep their name-sorted order.
  return memories.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'index' ? -1 : 1));
}

function parseMemoryFrontmatter(raw: string): {
  name: string | null;
  description: string | null;
  type: string | null;
  body: string;
} {
  if (!raw.startsWith('---')) return { name: null, description: null, type: null, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { name: null, description: null, type: null, body: raw };
  const yaml = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  return {
    name: matchYamlValue(yaml, /^name:\s*(.+?)\s*$/m),
    description: matchYamlValue(yaml, /^description:\s*(.+?)\s*$/m),
    // `type` is nested under `metadata:` — match the indented key.
    type: matchYamlValue(yaml, /^\s+type:\s*(.+?)\s*$/m),
    body,
  };
}

function matchYamlValue(yaml: string, pattern: RegExp): string | null {
  const value = yaml.match(pattern)?.[1]?.trim();
  if (!value) return null;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
