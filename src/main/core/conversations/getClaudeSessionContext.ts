import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeSessionContext, ClaudeSessionPrompt } from '@shared/conversations';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
import { log } from '@main/lib/logger';
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
  sessionId: string
): Promise<ClaudeSessionContext | null> {
  const transcriptPath = resolveClaudeTranscriptPath(cwd, sessionId);
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

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const parsed = safeParse(line);
    if (!parsed) continue;

    if (parsed.type === 'attachment') {
      collectAttachment(parsed.attachment, { tools, agents: transcriptAgents, mcpServers });
      continue;
    }

    if (parsed.type === 'user') {
      const prompt = extractPrompt(parsed, prompts.length);
      if (prompt) prompts.push(prompt);
    }
  }

  const [memoryFiles, skillsListing, scannedAgents] = await Promise.all([
    loadMemoryFiles(cwd),
    scanClaudeSkills(cwd),
    scanClaudeAgents(cwd),
  ]);

  return {
    transcriptPath,
    memoryFiles,
    tools: [...tools].sort(),
    agents: scannedAgents,
    mcpServers: [...mcpServers.entries()].map(([name, instructions]) => ({ name, instructions })),
    skillsListing,
    prompts,
  };
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

function extractPrompt(row: Record<string, unknown>, index: number): ClaudeSessionPrompt | null {
  if (row.isSidechain === true) return null;
  if (row.isMeta === true) return null;
  const message = row.message;
  if (!message || typeof message !== 'object') return null;
  const text = extractUserText((message as Record<string, unknown>).content);
  if (!text) return null;
  const timestamp = typeof row.timestamp === 'string' ? row.timestamp : null;
  const uuid = typeof row.uuid === 'string' ? row.uuid : `${index}`;
  return { id: uuid, text, timestamp };
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

async function loadMemoryFiles(cwd: string) {
  const candidates: {
    kind: 'global-claude' | 'project-claude' | 'project-agents';
    path: string;
  }[] = [
    { kind: 'global-claude', path: join(homedir(), '.claude', 'CLAUDE.md') },
    { kind: 'project-claude', path: join(cwd, 'CLAUDE.md') },
    { kind: 'project-agents', path: join(cwd, 'AGENTS.md') },
  ];

  const out = await Promise.all(
    candidates.map(async ({ kind, path }) => {
      try {
        const content = await readFile(path, 'utf8');
        return { kind, path, content, bytes: content.length };
      } catch {
        return null;
      }
    })
  );
  return out.filter((x): x is NonNullable<typeof x> => x !== null);
}
