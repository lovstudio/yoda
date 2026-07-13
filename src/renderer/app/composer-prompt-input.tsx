import { useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  ChevronDown,
  Copy,
  FileText,
  Folder,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { applyAgentCommandPrefix } from '@shared/agent-command-prefix';
import type { RuntimeId } from '@shared/runtime-registry';
import type { CatalogIndex, SkillSelectionInput } from '@shared/skills/types';
import { recordSkillInvocation } from '@renderer/features/skills/skill-usage-stats';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { Textarea } from '@renderer/lib/ui/textarea';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import {
  applyMarkdownEnterEdit,
  applyMarkdownTabEdit,
  type MarkdownTextareaEdit,
  type TextSelection,
} from './markdown-textarea-editing';
import {
  applyPathCompletion,
  buildPathCompletionItems,
  findActivePathMention,
  splitPathMentionQuery,
  type ActivePathMention,
  type PathCompletionItem,
} from './path-mention-autocomplete';
import {
  fileTokenLabel,
  findTokenRanges,
  measureTokenRects,
  snapSelectionToTokens,
  tokenAtPoint,
  tokenText,
  uniqueTokenLabel,
  type PromptToken,
  type PromptTokenKind,
  type TokenRect,
} from './prompt-attachment-tokens';

type SkillShortcutPrefix = '/' | '$';

interface SkillShortcutOption {
  skillKey: string;
  value: string;
  label: string;
  description: string;
  command: string;
}

interface ActiveSkillShortcut {
  start: number;
  end: number;
  prefix: SkillShortcutPrefix;
  query: string;
}

interface ComposerMenuPosition {
  left: number;
  width: number;
  maxHeight: number;
  side: 'top' | 'bottom';
  offset: number;
}

export type ComposerPromptInputRunHostKind = 'local' | 'ssh';

export interface ComposerPromptInputProps {
  value: string;
  onChange: (value: string) => void;
  tokens: PromptToken[];
  onTokensChange: (tokens: PromptToken[]) => void;
  runtimeId: RuntimeId | null;
  projectId?: string | null;
  projectPath?: string;
  /** Agent profile for this session: auto skills may be suggested; manual skills remain explicit. */
  skillSelection?: SkillSelectionInput;
  runHostKind?: ComposerPromptInputRunHostKind;
  className?: string;
  containerClassName?: string;
  textareaClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  canSubmit?: boolean;
  showSubmitButton?: boolean;
  onSubmit?: () => void;
}

const IMAGE_ATTACHMENT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const MENU_VIEWPORT_GUTTER = 8;
const MENU_ANCHOR_INSET = 12;
const MENU_SIDE_OFFSET = 4;
const SKILL_SHORTCUT_MENU_MAX_HEIGHT = 288;
const SKILL_SHORTCUT_MENU_MIN_HEIGHT = 96;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function insertPromptText(
  value: string,
  selection: { start: number; end: number },
  insertText: string
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leading = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const trailing = after.length > 0 ? (/^\s/.test(after) ? '' : ' ') : ' ';
  const insertion = `${leading}${insertText}${trailing}`;
  return {
    value: `${before}${insertion}${after}`,
    caret: before.length + insertion.length,
  };
}

// execCommand('insertText') with a large payload locks the renderer: Chromium
// builds the undo transaction roughly per-character, so inserting a multi-KB
// prompt template freezes the main thread. Above this size we skip the native
// pipeline and assign directly.
const NATIVE_EDIT_MAX_INSERT = 2000;

function applyNativeTextareaEdit(
  textarea: HTMLTextAreaElement,
  nextValue: string,
  selection: TextSelection
): void {
  const current = textarea.value;
  if (current !== nextValue) {
    let prefix = 0;
    const maxShared = Math.min(current.length, nextValue.length);
    while (prefix < maxShared && current[prefix] === nextValue[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < maxShared - prefix &&
      current[current.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const inserted = nextValue.slice(prefix, nextValue.length - suffix);
    textarea.focus();
    textarea.setSelectionRange(prefix, current.length - suffix);
    const applied =
      inserted.length <= NATIVE_EDIT_MAX_INSERT &&
      (inserted.length > 0
        ? document.execCommand('insertText', false, inserted)
        : document.execCommand('delete'));
    if (!applied || textarea.value !== nextValue) {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setValue?.call(textarea, nextValue);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  textarea.setSelectionRange(selection.start, selection.end);
}

function findActiveSkillShortcut(value: string, caret: number): ActiveSkillShortcut | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(^|[\s([{,])([/$])([A-Za-z0-9_:-]*)$/.exec(beforeCaret);
  if (!match) return null;

  const query = match[3] ?? '';
  return {
    start: caret - query.length - 1,
    end: caret,
    prefix: match[2] as SkillShortcutPrefix,
    query,
  };
}

function applySkillShortcut(
  value: string,
  shortcut: ActiveSkillShortcut,
  command: string
): { value: string; caret: number } {
  const before = value.slice(0, shortcut.start);
  const after = value.slice(shortcut.end);
  const trailing = after.length > 0 ? (/^\s/.test(after) ? '' : ' ') : ' ';
  const insertion = `${command}${trailing}`;
  return {
    value: `${before}${insertion}${after}`,
    caret: before.length + insertion.length,
  };
}

function measureComposerMenuPosition(anchor: HTMLElement): ComposerMenuPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const desiredLeft = rect.left + MENU_ANCHOR_INSET;
  const desiredWidth = Math.max(160, rect.width - MENU_ANCHOR_INSET * 2);
  const maxWidth = Math.max(160, viewportWidth - MENU_VIEWPORT_GUTTER * 2);
  const width = Math.min(desiredWidth, maxWidth);
  const left = Math.min(
    Math.max(MENU_VIEWPORT_GUTTER, desiredLeft),
    viewportWidth - width - MENU_VIEWPORT_GUTTER
  );
  const availableBelow = viewportHeight - rect.bottom - MENU_VIEWPORT_GUTTER - MENU_SIDE_OFFSET;
  const availableAbove = rect.top - MENU_VIEWPORT_GUTTER - MENU_SIDE_OFFSET;
  const side =
    availableBelow < SKILL_SHORTCUT_MENU_MIN_HEIGHT && availableAbove > availableBelow
      ? 'top'
      : 'bottom';
  const availableHeight = side === 'top' ? availableAbove : availableBelow;
  const maxHeight = Math.max(
    SKILL_SHORTCUT_MENU_MIN_HEIGHT,
    Math.min(SKILL_SHORTCUT_MENU_MAX_HEIGHT, availableHeight)
  );

  return {
    left,
    width,
    maxHeight,
    side,
    offset:
      side === 'top'
        ? viewportHeight - rect.top + MENU_SIDE_OFFSET
        : rect.bottom + MENU_SIDE_OFFSET,
  };
}

function isTargetInSkillShortcutMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-skill-shortcut-menu]') !== null;
}

function fuzzyMatchScore(text: string, query: string): number | null {
  if (text === query) return 1000;
  if (text.startsWith(query)) return 900 - text.length;
  const idx = text.indexOf(query);
  if (idx >= 0) return 700 - idx - text.length;

  if (query.length < 2) return null;
  let firstMatch = -1;
  let ti = 0;
  let gaps = 0;
  let prevMatch = -1;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    const found = text.indexOf(ch, ti);
    if (found < 0) return null;
    if (firstMatch < 0) firstMatch = found;
    if (prevMatch >= 0) gaps += found - prevMatch - 1;
    prevMatch = found;
    ti = found + 1;
  }
  const span = prevMatch - firstMatch + 1;
  if (span > query.length * 3 + 2) return null;
  return 400 - gaps - text.length;
}

function skillShortcutOptionScore(item: SkillShortcutOption, query: string): number | null {
  const q = query.toLowerCase();
  const scores = [
    fuzzyMatchScore(item.label.toLowerCase(), q),
    fuzzyMatchScore(item.value.toLowerCase(), q),
    fuzzyMatchScore(item.command.toLowerCase(), q),
    item.description.toLowerCase().includes(q) ? 200 : null,
  ].filter((s): s is number => s !== null);
  return scores.length > 0 ? Math.max(...scores) : null;
}

export function ComposerPromptInput({
  value,
  onChange,
  tokens,
  onTokensChange,
  runtimeId,
  projectId = null,
  projectPath,
  skillSelection,
  runHostKind = 'local',
  className,
  containerClassName = 'border-border bg-background-1',
  textareaClassName,
  placeholder,
  disabled = false,
  autoFocus = false,
  canSubmit = false,
  showSubmitButton,
  onSubmit,
}: ComposerPromptInputProps) {
  const { t } = useTranslation();
  const inputAnchorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const selectionRef = useRef(selection);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(
    () => () => {
      for (const token of tokensRef.current) {
        if (token.previewUrl) URL.revokeObjectURL(token.previewUrl);
      }
    },
    []
  );

  const {
    data: skillCatalog = null,
    isPending: skillsLoading,
    isError: skillsError,
  } = useQuery<CatalogIndex>({
    queryKey: ['skills', 'catalog', projectPath ?? null],
    queryFn: async () => {
      const result = await rpc.skills.getCatalog(projectPath ? { projectPath } : undefined);
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to load catalog');
    },
  });
  const skillShortcutOptions = useMemo<SkillShortcutOption[]>(() => {
    const configuredKeys = skillSelection
      ? new Set([...skillSelection.autoSkillKeys, ...skillSelection.manualSkillKeys])
      : null;
    const installed = (skillCatalog?.skills ?? [])
      .filter(
        (skill) =>
          skill.installed &&
          (!configuredKeys ||
            skill.scope === 'plugin' ||
            configuredKeys.has(skill.key) ||
            configuredKeys.has(skill.id))
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return installed.map((skill) => ({
      skillKey: skill.key,
      value: skill.id,
      label: skill.displayName,
      description: skill.description,
      command: runtimeId ? applyAgentCommandPrefix(runtimeId, skill.id) : skill.id,
    }));
  }, [runtimeId, skillCatalog?.skills, skillSelection]);
  const skillIdByShortcutCommand = useMemo(
    () => new Map(skillShortcutOptions.map((skill) => [skill.command, skill.value])),
    [skillShortcutOptions]
  );

  const tokenRanges = useMemo(() => findTokenRanges(value, tokens), [value, tokens]);
  const tokenRangesRef = useRef(tokenRanges);
  tokenRangesRef.current = tokenRanges;
  const [tokenRects, setTokenRects] = useState<Map<string, TokenRect[]>>(new Map());
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredTokenId, setHoveredTokenId] = useState<string | null>(null);
  const [tokenMenu, setTokenMenu] = useState<{
    tokenId: string;
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setTokenRects(measureTokenRects(textarea, tokenRanges));
  }, [tokenRanges]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const observer = new ResizeObserver(() => {
      setTokenRects(
        measureTokenRects(textarea, findTokenRanges(textarea.value, tokensRef.current))
      );
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);

  const hitTestToken = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>): string | null => {
      const textarea = event.currentTarget;
      const rect = textarea.getBoundingClientRect();
      return tokenAtPoint(
        tokenRects,
        event.clientX - rect.left,
        event.clientY - rect.top + textarea.scrollTop
      );
    },
    [tokenRects]
  );

  const updateSelection = useCallback((target: HTMLTextAreaElement) => {
    const raw = { start: target.selectionStart, end: target.selectionEnd };
    const next = snapSelectionToTokens(raw, tokenRangesRef.current, selectionRef.current.start);
    if (next.start !== raw.start || next.end !== raw.end) {
      target.setSelectionRange(next.start, next.end);
    }
    selectionRef.current = next;
    setSelection((current) =>
      current.start === next.start && current.end === next.end ? current : next
    );
  }, []);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const [pathCompletionItems, setPathCompletionItems] = useState<PathCompletionItem[]>([]);
  const [pathCompletionOpen, setPathCompletionOpen] = useState(false);
  const [pathCompletionLoading, setPathCompletionLoading] = useState(false);
  const [pathCompletionError, setPathCompletionError] = useState(false);
  const [activePathCompletionIndex, setActivePathCompletionIndex] = useState(0);
  const [activeSkillShortcutIndex, setActiveSkillShortcutIndex] = useState(0);
  const [skillShortcutSearchQuery, setSkillShortcutSearchQuery] = useState('');
  const [dismissedSkillShortcutKey, setDismissedSkillShortcutKey] = useState<string | null>(null);
  const pathCompletionRequestRef = useRef(0);

  const activePathMention = useMemo(
    () =>
      selection.start === selection.end ? findActivePathMention(value, selection.start) : null,
    [value, selection]
  );
  const activeSkillShortcut = useMemo(
    () =>
      selection.start === selection.end ? findActiveSkillShortcut(value, selection.start) : null,
    [value, selection]
  );
  const activeSkillShortcutKey = activeSkillShortcut
    ? `${activeSkillShortcut.start}:${activeSkillShortcut.end}:${activeSkillShortcut.prefix}:${activeSkillShortcut.query}`
    : null;
  const automaticSkillKeys = useMemo(
    () => skillSelection?.autoSkillKeys ?? [],
    [skillSelection?.autoSkillKeys]
  );
  const automaticSkillKeysKey = automaticSkillKeys.join('\0');
  const [routingQuery, setRoutingQuery] = useState('');
  useEffect(() => {
    const intent = value.trim();
    const containsExplicitSkill = skillShortcutOptions.some((option) =>
      intent.includes(option.command)
    );
    if (
      !focused ||
      disabled ||
      activeSkillShortcut ||
      automaticSkillKeys.length === 0 ||
      intent.length < 8 ||
      containsExplicitSkill
    ) {
      setRoutingQuery('');
      return;
    }
    const timer = window.setTimeout(() => setRoutingQuery(intent), 320);
    return () => window.clearTimeout(timer);
  }, [
    activeSkillShortcut,
    automaticSkillKeys.length,
    disabled,
    focused,
    skillShortcutOptions,
    value,
  ]);
  const { data: routedSkills = [] } = useQuery({
    queryKey: ['skills', 'route', routingQuery, projectPath ?? null, automaticSkillKeysKey],
    queryFn: async () => {
      const result = await rpc.skills.route({
        query: routingQuery,
        projectPath,
        allowedSkillKeys: automaticSkillKeys,
        limit: 3,
      });
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to route skills');
    },
    enabled: Boolean(routingQuery),
    staleTime: 30_000,
  });
  const visibleRoutedSkills = routedSkills.filter(
    (suggestion) =>
      suggestion.confidence !== 'low' &&
      skillShortcutOptions.some((option) => option.skillKey === suggestion.skillKey)
  );
  const filteredSkillShortcutOptions = useMemo(() => {
    if (!activeSkillShortcut) return [];
    const searchQuery = skillShortcutSearchQuery.trim();
    const query = searchQuery || activeSkillShortcut.query.trim();
    if (!query) return skillShortcutOptions.slice(0, 50);
    const scored = skillShortcutOptions
      .map((item) => ({ item, score: skillShortcutOptionScore(item, query) }))
      .filter(
        (entry): entry is { item: SkillShortcutOption; score: number } => entry.score !== null
      )
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 50).map((entry) => entry.item);
  }, [activeSkillShortcut, skillShortcutOptions, skillShortcutSearchQuery]);
  const effectiveSkillShortcutIndex =
    filteredSkillShortcutOptions.length === 0
      ? 0
      : Math.min(activeSkillShortcutIndex, filteredSkillShortcutOptions.length - 1);
  const skillShortcutMenuOpen =
    focused &&
    !!runtimeId &&
    !!activeSkillShortcut &&
    activeSkillShortcutKey !== dismissedSkillShortcutKey &&
    !skillsError &&
    (skillsLoading ||
      filteredSkillShortcutOptions.length > 0 ||
      activeSkillShortcut.query.length > 0 ||
      skillShortcutSearchQuery.trim().length > 0);

  useEffect(() => {
    setActiveSkillShortcutIndex(0);
  }, [activeSkillShortcutKey, skillShortcutSearchQuery]);

  useEffect(() => {
    if (!skillShortcutMenuOpen && skillShortcutSearchQuery) {
      setSkillShortcutSearchQuery('');
    }
  }, [skillShortcutMenuOpen, skillShortcutSearchQuery]);

  useEffect(() => {
    if (!activePathMention || disabled) {
      pathCompletionRequestRef.current += 1;
      setPathCompletionOpen(false);
      setPathCompletionItems([]);
      setPathCompletionLoading(false);
      setPathCompletionError(false);
      return;
    }

    const queryParts = splitPathMentionQuery(activePathMention.query);
    const requestId = pathCompletionRequestRef.current + 1;
    pathCompletionRequestRef.current = requestId;
    setPathCompletionOpen(true);
    setPathCompletionLoading(true);
    setPathCompletionError(false);

    const timer = setTimeout(() => {
      rpc.fs
        .listPathCompletions(projectId ?? null, queryParts.directoryPath, {
          pathKind: queryParts.isAbsolute ? 'absolute' : 'relative',
          recursive: false,
          includeHidden: true,
          maxEntries: 80,
          timeBudgetMs: 1_000,
        })
        .then((result) => {
          if (pathCompletionRequestRef.current !== requestId) return;
          if (!result.success) {
            setPathCompletionItems([]);
            setPathCompletionError(false);
            return;
          }
          setPathCompletionItems(
            buildPathCompletionItems(result.data.entries, queryParts).slice(0, 50)
          );
          setActivePathCompletionIndex(0);
        })
        .catch(() => {
          if (pathCompletionRequestRef.current !== requestId) return;
          setPathCompletionItems([]);
          setPathCompletionError(false);
        })
        .finally(() => {
          if (pathCompletionRequestRef.current !== requestId) return;
          setPathCompletionLoading(false);
        });
    }, 80);

    return () => {
      clearTimeout(timer);
    };
  }, [activePathMention, disabled, projectId]);

  const focusForVoiceInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const currentSelection = selectionRef.current;
    const start = Math.max(0, Math.min(currentSelection.start, textarea.value.length));
    const end = Math.max(start, Math.min(currentSelection.end, textarea.value.length));
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    setFocused(true);
    updateSelection(textarea);
  }, [updateSelection]);

  const [voiceInputTriggering, setVoiceInputTriggering] = useState(false);
  const copyVoiceInputError = useCallback(
    async (message: string) => {
      const result = await rpc.app.clipboardWriteText(message);
      if (result.success) {
        toast.success(t('common.copied'));
        return;
      }
      toast.error(result.error ?? t('common.copyFailed'));
    },
    [t]
  );
  const showVoiceInputErrorToast = useCallback(
    (error: string) => {
      const title = t('home.voiceTriggerFailedToast');
      const copyLabel = t('common.copy');
      const copyText = `${title}\n${error}`;
      toast.error(
        <div className="flex w-full min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
          <button
            type="button"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void copyVoiceInputError(copyText);
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Copy className="size-3.5" />
          </button>
        </div>,
        {
          icon: null,
          classNames: {
            content: 'w-full min-w-0',
            title: 'w-full',
            description: 'w-full',
          },
          description: (
            <div className="mt-2 max-h-28 w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background-1/80 px-2.5 py-2 text-xs leading-relaxed text-foreground-muted">
              {error}
            </div>
          ),
        }
      );
    },
    [copyVoiceInputError, t]
  );
  const handleVoiceInput = useCallback(async () => {
    if (voiceInputTriggering || disabled) return;
    focusForVoiceInput();
    setVoiceInputTriggering(true);

    try {
      const result = await rpc.app.triggerVoiceInput({ provider: 'typeless' });
      if (!result.success) {
        showVoiceInputErrorToast(result.error ?? t('common.unknownError'));
        return;
      }
      toast.success(t('home.voiceTriggeredToast', { shortcut: result.shortcut }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showVoiceInputErrorToast(message);
    } finally {
      setVoiceInputTriggering(false);
      focusForVoiceInput();
    }
  }, [disabled, focusForVoiceInput, showVoiceInputErrorToast, t, voiceInputTriggering]);

  const applyPromptEdit = useCallback(
    (nextValue: string, nextSelection: TextSelection) => {
      const textarea = textareaRef.current;
      if (textarea) applyNativeTextareaEdit(textarea, nextValue, nextSelection);
      onChange(nextValue);
      setSelection(nextSelection);
      requestAnimationFrame(() => {
        const target = textareaRef.current;
        if (!target) return;
        target.focus();
        target.setSelectionRange(nextSelection.start, nextSelection.end);
        updateSelection(target);
      });
    },
    [onChange, updateSelection]
  );

  const commitPathCompletion = useCallback(
    (item: PathCompletionItem, mention: ActivePathMention | null = activePathMention) => {
      if (!mention) return;
      const next = applyPathCompletion(value, mention, item.insertText);
      applyPromptEdit(next.value, { start: next.caret, end: next.caret });
      setPathCompletionOpen(item.type === 'dir');
    },
    [activePathMention, applyPromptEdit, value]
  );

  const commitSkillShortcut = useCallback(
    (command: string, shortcut: ActiveSkillShortcut | null = null) => {
      const next = shortcut
        ? applySkillShortcut(value, shortcut, command)
        : insertPromptText(value, selection, command);
      const skillId = skillIdByShortcutCommand.get(command);
      if (skillId) recordSkillInvocation(skillId);
      applyPromptEdit(next.value, { start: next.caret, end: next.caret });
      const lingering = findActiveSkillShortcut(next.value, next.caret);
      setDismissedSkillShortcutKey(
        lingering
          ? `${lingering.start}:${lingering.end}:${lingering.prefix}:${lingering.query}`
          : null
      );
      setActiveSkillShortcutIndex(0);
    },
    [applyPromptEdit, selection, skillIdByShortcutCommand, value]
  );

  const insertPromptSnippet = useCallback(
    (snippet: string) => {
      const textarea = textareaRef.current;
      const currentValue = textarea ? textarea.value : value;
      const currentSelection = textarea
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : selectionRef.current;
      const next = insertPromptText(currentValue, currentSelection, snippet);
      applyPromptEdit(next.value, { start: next.caret, end: next.caret });
    },
    [applyPromptEdit, value]
  );

  const insertAttachmentToken = useCallback(
    (kind: PromptTokenKind, path: string, name: string, previewUrl?: string) => {
      const existing = tokensRef.current;
      const base =
        kind === 'image'
          ? t('home.imageTokenLabel', {
              index: existing.filter((token) => token.kind === 'image').length + 1,
            })
          : fileTokenLabel(name);
      const label = uniqueTokenLabel(base, existing);
      const next = [...existing, { id: crypto.randomUUID(), kind, label, path, previewUrl }];
      tokensRef.current = next;
      onTokensChange(next);
      insertPromptSnippet(tokenText(label));
    },
    [insertPromptSnippet, onTokensChange, t]
  );

  const removeTokenFromPrompt = useCallback(
    (token: PromptToken) => {
      const textarea = textareaRef.current;
      const currentValue = textarea ? textarea.value : value;
      const next = currentValue.split(tokenText(token.label)).join('');
      const caret = Math.min(
        textarea ? textarea.selectionStart : selectionRef.current.start,
        next.length
      );
      applyPromptEdit(next, { start: caret, end: caret });
    },
    [applyPromptEdit, value]
  );

  const attachFiles = useCallback(
    (files: File[]) => {
      if (disabled || runHostKind === 'ssh') return;
      for (const file of files) {
        const filePath = window.electronAPI.getPathForFile(file).trim();
        if (!filePath) continue;
        if (file.type.startsWith('image/') || IMAGE_ATTACHMENT_RE.test(filePath)) {
          insertAttachmentToken('image', filePath, file.name, URL.createObjectURL(file));
        } else {
          insertAttachmentToken('file', filePath, file.name);
        }
      }
    },
    [disabled, insertAttachmentToken, runHostKind]
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      const imageFiles = Array.from(event.clipboardData.files).filter((file) =>
        file.type.startsWith('image/')
      );
      if (imageFiles.length === 0) return;
      event.preventDefault();
      for (const file of imageFiles) {
        const existingPath = window.electronAPI.getPathForFile(file).trim();
        if (existingPath) {
          insertAttachmentToken('image', existingPath, file.name, URL.createObjectURL(file));
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        void (async () => {
          try {
            const base64 = await readFileAsBase64(file);
            const result = await rpc.fs.saveClipboardImage(base64, file.type);
            if (!result.success || !result.data) throw new Error('saveClipboardImage failed');
            insertAttachmentToken(
              'image',
              result.data.absPath,
              file.name || 'pasted-image',
              previewUrl
            );
          } catch {
            URL.revokeObjectURL(previewUrl);
            toast.error(t('home.attachPasteFailedToast'));
          }
        })();
      }
    },
    [disabled, insertAttachmentToken, t]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      event.preventDefault();
      attachFiles(files);
    },
    [attachFiles]
  );

  const applyPromptMarkdownEdit = useCallback(
    (next: MarkdownTextareaEdit) => {
      applyPromptEdit(next.value, next.selection);
    },
    [applyPromptEdit]
  );

  const applyPromptTabEdit = useCallback(
    (target: HTMLTextAreaElement, direction: 'indent' | 'outdent') => {
      applyPromptMarkdownEdit(
        applyMarkdownTabEdit(
          value,
          { start: target.selectionStart, end: target.selectionEnd },
          direction
        )
      );
    },
    [applyPromptMarkdownEdit, value]
  );

  const applyPromptEnterEdit = useCallback(
    (target: HTMLTextAreaElement): boolean => {
      const next = applyMarkdownEnterEdit(value, {
        start: target.selectionStart,
        end: target.selectionEnd,
      });
      if (!next) return false;
      applyPromptMarkdownEdit(next);
      return true;
    },
    [applyPromptMarkdownEdit, value]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (skillShortcutMenuOpen && activeSkillShortcut) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveSkillShortcutIndex((index) =>
            filteredSkillShortcutOptions.length === 0
              ? 0
              : (index + 1) % filteredSkillShortcutOptions.length
          );
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveSkillShortcutIndex((index) =>
            filteredSkillShortcutOptions.length === 0
              ? 0
              : (index - 1 + filteredSkillShortcutOptions.length) %
                filteredSkillShortcutOptions.length
          );
          return;
        }
        if ((event.key === 'Enter' && !isImeComposing(event)) || event.key === 'Tab') {
          const item = filteredSkillShortcutOptions[effectiveSkillShortcutIndex];
          if (!item && event.key === 'Tab') {
            event.preventDefault();
            applyPromptTabEdit(event.currentTarget, event.shiftKey ? 'outdent' : 'indent');
            return;
          }
          event.preventDefault();
          if (item) commitSkillShortcut(item.command, activeSkillShortcut);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setDismissedSkillShortcutKey(activeSkillShortcutKey);
          return;
        }
      }

      if (pathCompletionOpen && activePathMention) {
        if (event.key === 'ArrowDown' && pathCompletionItems.length > 0) {
          event.preventDefault();
          setActivePathCompletionIndex((index) => (index + 1) % pathCompletionItems.length);
          return;
        }
        if (event.key === 'ArrowUp' && pathCompletionItems.length > 0) {
          event.preventDefault();
          setActivePathCompletionIndex(
            (index) => (index - 1 + pathCompletionItems.length) % pathCompletionItems.length
          );
          return;
        }
        if (
          ((event.key === 'Enter' && !isImeComposing(event)) || event.key === 'Tab') &&
          pathCompletionItems.length > 0
        ) {
          event.preventDefault();
          commitPathCompletion(pathCompletionItems[activePathCompletionIndex]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setPathCompletionOpen(false);
          return;
        }
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && !isImeComposing(event)) {
        const target = event.currentTarget;
        if (target.selectionStart === target.selectionEnd) {
          const caret = target.selectionStart;
          const range =
            event.key === 'Backspace'
              ? tokenRangesRef.current.find((item) => item.end === caret)
              : tokenRangesRef.current.find((item) => item.start === caret);
          if (range) {
            event.preventDefault();
            const currentValue = target.value;
            applyPromptEdit(currentValue.slice(0, range.start) + currentValue.slice(range.end), {
              start: range.start,
              end: range.start,
            });
            return;
          }
        }
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        applyPromptTabEdit(event.currentTarget, event.shiftKey ? 'outdent' : 'indent');
        return;
      }

      if (event.key === 'Enter' && !isImeComposing(event)) {
        if (applyPromptEnterEdit(event.currentTarget)) {
          event.preventDefault();
          return;
        }

        if (!event.shiftKey && onSubmit) {
          event.preventDefault();
          onSubmit();
        }
      }
    },
    [
      activePathCompletionIndex,
      activePathMention,
      activeSkillShortcut,
      activeSkillShortcutKey,
      applyPromptEdit,
      applyPromptEnterEdit,
      applyPromptTabEdit,
      commitPathCompletion,
      commitSkillShortcut,
      effectiveSkillShortcutIndex,
      filteredSkillShortcutOptions,
      onSubmit,
      pathCompletionItems,
      pathCompletionOpen,
      skillShortcutMenuOpen,
    ]
  );

  const submitVisible = showSubmitButton ?? !!onSubmit;
  const submitDisabled = disabled || !canSubmit || !onSubmit;

  return (
    <div className={className}>
      <div
        className={cn(
          'rounded-lg border shadow-sm transition-[background-color,border-color,box-shadow]',
          containerClassName
        )}
      >
        <div className="flex flex-col">
          <div ref={inputAnchorRef} className="relative">
            <Textarea
              ref={textareaRef}
              placeholder={placeholder ?? t('home.promptPlaceholder')}
              value={value}
              disabled={disabled}
              onChange={(event) => {
                onChange(event.target.value);
                updateSelection(event.target);
              }}
              onSelect={(event) => updateSelection(event.currentTarget)}
              onClick={(event) => updateSelection(event.currentTarget)}
              onFocus={(event) => {
                setFocused(true);
                updateSelection(event.currentTarget);
                if (activePathMention) setPathCompletionOpen(true);
              }}
              onKeyUp={(event) => updateSelection(event.currentTarget)}
              onBlur={(event) => {
                if (isTargetInSkillShortcutMenu(event.relatedTarget)) return;
                setFocused(false);
                setPathCompletionOpen(false);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              onMouseMove={(event) => setHoveredTokenId(hitTestToken(event))}
              onMouseLeave={() => setHoveredTokenId(null)}
              onMouseDown={(event) => {
                if (event.detail > 1 && hitTestToken(event)) event.preventDefault();
              }}
              onDoubleClick={(event) => {
                const tokenId = hitTestToken(event);
                if (!tokenId) return;
                const token = tokensRef.current.find((item) => item.id === tokenId);
                if (!token) return;
                event.preventDefault();
                void rpc.app.openIn({ app: 'finder', path: token.path }).catch(() => {});
              }}
              onContextMenu={(event) => {
                const tokenId = hitTestToken(event);
                if (!tokenId) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setTokenMenu({
                  tokenId,
                  left: event.clientX - rect.left,
                  top: event.clientY - rect.top,
                });
              }}
              className={cn(
                'min-h-28 resize-none border-0 bg-transparent px-5 py-4 text-base placeholder:text-foreground-muted focus-visible:border-0 focus-visible:ring-0',
                hoveredTokenId && 'cursor-default',
                textareaClassName
              )}
            />
            {tokenRects.size > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
              >
                {Array.from(tokenRects.entries()).flatMap(([tokenId, rects]) => {
                  const token = tokens.find((item) => item.id === tokenId);
                  if (!token) return [];
                  const range = tokenRanges.find((item) => item.token.id === tokenId);
                  const selected =
                    !!range &&
                    selection.start !== selection.end &&
                    selection.start <= range.start &&
                    selection.end >= range.end;
                  const TokenIcon = token.kind === 'image' ? ImageIcon : FileText;
                  return rects.map((rect, index) => (
                    <div
                      key={`${tokenId}:${index}`}
                      className={cn(
                        'absolute flex items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-[5px] border bg-background-2 px-1 transition-colors',
                        hoveredTokenId === tokenId
                          ? 'border-primary/60 bg-background-3'
                          : 'border-border',
                        selected && 'border-primary bg-primary/15'
                      )}
                      style={{
                        left: rect.left + 3,
                        top: rect.top - scrollTop - 1,
                        width: Math.max(rect.width - 6, 0),
                        height: rect.height + 2,
                      }}
                    >
                      {index === 0 && (
                        <>
                          <TokenIcon className="size-3 shrink-0 text-foreground-muted" />
                          <span className="truncate text-xs leading-none text-foreground">
                            {token.label}
                          </span>
                        </>
                      )}
                    </div>
                  ));
                })}
              </div>
            )}
            {pathCompletionOpen && activePathMention && (
              <PathCompletionMenu
                items={pathCompletionItems}
                activeIndex={activePathCompletionIndex}
                loading={pathCompletionLoading}
                error={pathCompletionError}
                showEmpty={activePathMention.query.length > 0}
                labels={{
                  loading: t('common.loading'),
                  error: t('common.error'),
                  noResults: t('common.noResults'),
                }}
                onActiveIndexChange={setActivePathCompletionIndex}
                onSelect={(item) => commitPathCompletion(item, activePathMention)}
              />
            )}
            {skillShortcutMenuOpen && activeSkillShortcut && (
              <SkillShortcutMenu
                anchorRef={inputAnchorRef}
                items={filteredSkillShortcutOptions}
                activeIndex={effectiveSkillShortcutIndex}
                loading={skillsLoading}
                searchValue={skillShortcutSearchQuery}
                showEmpty={
                  activeSkillShortcut.query.length > 0 || skillShortcutSearchQuery.trim().length > 0
                }
                labels={{
                  loading: t('common.loading'),
                  noResults: t('skills.noMatches'),
                  search: t('common.search'),
                  searchPlaceholder: t('home.searchSkills'),
                }}
                onActiveIndexChange={setActiveSkillShortcutIndex}
                onDismiss={() => {
                  setDismissedSkillShortcutKey(activeSkillShortcutKey);
                  setSkillShortcutSearchQuery('');
                  requestAnimationFrame(() => {
                    textareaRef.current?.focus({ preventScroll: true });
                  });
                }}
                onFocusExit={() => {
                  setFocused(false);
                  setSkillShortcutSearchQuery('');
                }}
                onSearchValueChange={setSkillShortcutSearchQuery}
                onSelect={(item) => commitSkillShortcut(item.command, activeSkillShortcut)}
              />
            )}
            {!tokenMenu &&
              hoveredTokenId &&
              (() => {
                const token = tokens.find((item) => item.id === hoveredTokenId);
                const rect = tokenRects.get(hoveredTokenId)?.[0];
                if (!token || !rect) return null;
                return (
                  <div
                    className="pointer-events-none absolute z-20 max-w-72 rounded-md border border-border bg-background-quaternary p-1.5 shadow-md"
                    style={{ left: rect.left, top: rect.top - scrollTop + rect.height + 6 }}
                  >
                    {token.kind === 'image' && token.previewUrl ? (
                      <img
                        src={token.previewUrl}
                        alt={token.label}
                        className="max-h-44 max-w-full rounded-sm object-contain"
                      />
                    ) : null}
                    <div className="mt-1 truncate px-0.5 text-[11px] text-foreground-muted">
                      {token.path}
                    </div>
                  </div>
                );
              })()}
            {tokenMenu &&
              (() => {
                const token = tokens.find((item) => item.id === tokenMenu.tokenId);
                if (!token) return null;
                const closeMenu = () => setTokenMenu(null);
                const menuItemClass =
                  'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-background-2';
                return (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={closeMenu}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        closeMenu();
                      }}
                    />
                    <div
                      className="absolute z-40 min-w-44 rounded-md border border-border bg-background-quaternary p-1 shadow-md"
                      style={{ left: tokenMenu.left, top: tokenMenu.top }}
                    >
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          void navigator.clipboard.writeText(token.path);
                          closeMenu();
                        }}
                      >
                        {t('home.tokenCopyPath')}
                      </button>
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          void rpc.app
                            .openIn({ app: 'finder', path: token.path, reveal: true })
                            .catch(() => {});
                          closeMenu();
                        }}
                      >
                        {t('home.tokenRevealInFinder')}
                      </button>
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          void rpc.app.openIn({ app: 'finder', path: token.path }).catch(() => {});
                          closeMenu();
                        }}
                      >
                        {t('home.tokenOpenDefault')}
                      </button>
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          removeTokenFromPrompt(token);
                          closeMenu();
                        }}
                      >
                        {t('home.tokenRemove')}
                      </button>
                    </div>
                  </>
                );
              })()}
          </div>
          {visibleRoutedSkills.length > 0 && routingQuery === value.trim() && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 px-3 py-2">
              <span className="mr-0.5 flex items-center gap-1 text-[10px] font-medium text-foreground-muted">
                <Sparkles className="size-3" />
                {t('home.suggestedSkills')}
              </span>
              {visibleRoutedSkills.map((suggestion) => {
                const option = skillShortcutOptions.find(
                  (candidate) => candidate.skillKey === suggestion.skillKey
                );
                if (!option) return null;
                return (
                  <button
                    key={suggestion.skillKey}
                    type="button"
                    title={suggestion.reason}
                    onClick={() => commitSkillShortcut(option.command)}
                    className="rounded-full border border-border bg-background-2/70 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10"
                  >
                    {suggestion.displayName}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  attachFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                aria-label={t('home.attachAria')}
                title={
                  runHostKind === 'ssh' ? t('home.attachSshUnsupported') : t('home.attachAria')
                }
                disabled={disabled || runHostKind === 'ssh'}
                onClick={() => fileInputRef.current?.click()}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <Paperclip className="size-4" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <SkillShortcutSelector
                runtimeId={runtimeId}
                options={skillShortcutOptions}
                isLoading={skillsLoading}
                isError={skillsError}
                disabled={disabled}
                onInsert={commitSkillShortcut}
                className="h-8 gap-1.5 rounded-full border-0 bg-background-2/60 px-3 text-xs font-medium text-foreground transition-colors hover:bg-background-2"
              />
              <button
                type="button"
                aria-label={t('home.voiceAria')}
                aria-busy={voiceInputTriggering}
                title={t('home.voiceTooltip')}
                disabled={disabled || voiceInputTriggering}
                onClick={() => void handleVoiceInput()}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50',
                  voiceInputTriggering
                    ? 'bg-primary/10 text-primary hover:bg-primary/15'
                    : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
                )}
              >
                <Mic className={cn('size-4', voiceInputTriggering && 'animate-pulse')} />
              </button>
              {submitVisible && (
                <button
                  type="button"
                  aria-label={t('home.submitAria')}
                  disabled={submitDisabled}
                  onClick={() => {
                    if (!submitDisabled) onSubmit?.();
                  }}
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                    !submitDisabled
                      ? 'scale-100 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                      : 'scale-95 text-foreground-muted/60'
                  )}
                >
                  <ArrowUp
                    className={cn('size-4 transition-transform', !submitDisabled && 'scale-110')}
                  />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PathCompletionMenuProps {
  items: PathCompletionItem[];
  activeIndex: number;
  loading: boolean;
  error: boolean;
  showEmpty: boolean;
  labels: {
    loading: string;
    error: string;
    noResults: string;
  };
  onActiveIndexChange: (index: number) => void;
  onSelect: (item: PathCompletionItem) => void;
}

function PathCompletionMenu({
  items,
  activeIndex,
  loading,
  error,
  showEmpty,
  labels,
  onActiveIndexChange,
  onSelect,
}: PathCompletionMenuProps) {
  if (!loading && !error && items.length === 0 && !showEmpty) return null;

  return (
    <div
      role="listbox"
      className="absolute left-3 right-3 top-full z-40 mt-1 max-h-64 overflow-hidden rounded-lg border border-border bg-background-quaternary py-1 text-sm text-foreground shadow-lg ring-1 ring-foreground/5"
    >
      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 text-foreground-muted">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{labels.loading}</span>
        </div>
      ) : error ? (
        <div className="px-3 py-2 text-foreground-muted">{labels.error}</div>
      ) : items.length === 0 && showEmpty ? (
        <div className="px-3 py-2 text-foreground-muted">{labels.noResults}</div>
      ) : items.length === 0 ? null : (
        <div className="max-h-64 overflow-y-auto">
          {items.map((item, index) => {
            const Icon = item.type === 'dir' ? Folder : FileText;
            const active = index === activeIndex;
            return (
              <button
                key={`${item.type}:${item.path}`}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onActiveIndexChange(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(item);
                }}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors',
                  active ? 'bg-background-2 text-foreground' : 'text-foreground-muted'
                )}
              >
                <Icon className="size-4 shrink-0 text-foreground-passive" />
                <span className="truncate font-mono text-xs">{item.insertText}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SkillShortcutMenuProps {
  anchorRef: RefObject<HTMLDivElement | null>;
  items: SkillShortcutOption[];
  activeIndex: number;
  loading: boolean;
  searchValue: string;
  showEmpty: boolean;
  labels: {
    loading: string;
    noResults: string;
    search: string;
    searchPlaceholder: string;
  };
  onActiveIndexChange: (index: number) => void;
  onDismiss: () => void;
  onFocusExit: () => void;
  onSearchValueChange: (value: string) => void;
  onSelect: (item: SkillShortcutOption) => void;
}

function SkillShortcutMenu({
  anchorRef,
  items,
  activeIndex,
  loading,
  searchValue,
  showEmpty,
  labels,
  onActiveIndexChange,
  onDismiss,
  onFocusExit,
  onSearchValueChange,
  onSelect,
}: SkillShortcutMenuProps) {
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<ComposerMenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    setPosition(measureComposerMenuPosition(anchor));
  }, [anchorRef]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, position]);

  useLayoutEffect(() => {
    updatePosition();
    const anchor = anchorRef.current;
    if (!anchor) return undefined;

    const observer = new ResizeObserver(updatePosition);
    observer.observe(anchor);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, updatePosition, items.length, loading, showEmpty]);

  if (!loading && items.length === 0 && !showEmpty) return null;
  if (!position || typeof document === 'undefined') return null;

  const style: CSSProperties = {
    left: position.left,
    width: position.width,
    maxHeight: position.maxHeight,
  };
  if (position.side === 'top') {
    style.bottom = position.offset;
  } else {
    style.top = position.offset;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onActiveIndexChange(items.length === 0 ? 0 : (activeIndex + 1) % items.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onActiveIndexChange(items.length === 0 ? 0 : (activeIndex - 1 + items.length) % items.length);
      return;
    }
    if (
      (event.key === 'Enter' && !isImeComposing(event)) ||
      (event.key === 'Tab' && items.length > 0)
    ) {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) onSelect(item);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
    }
  };

  return createPortal(
    <div
      data-skill-shortcut-menu
      className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-border bg-background-quaternary text-sm text-foreground shadow-lg ring-1 ring-foreground/5"
      style={style}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (isTargetInSkillShortcutMenu(nextTarget)) return;
        if (nextTarget instanceof Node && anchorRef.current?.contains(nextTarget)) return;
        onFocusExit();
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="border-b border-border px-2 py-1.5">
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-foreground-muted focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-3.5 shrink-0" />
          <span className="sr-only">{labels.search}</span>
          <input
            type="search"
            value={searchValue}
            aria-label={labels.search}
            placeholder={labels.searchPlaceholder}
            onChange={(event) => onSearchValueChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
          />
        </label>
      </div>
      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 text-foreground-muted">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{labels.loading}</span>
        </div>
      ) : items.length === 0 && showEmpty ? (
        <div className="px-3 py-2 text-foreground-muted">{labels.noResults}</div>
      ) : items.length === 0 ? null : (
        <div role="listbox" className="min-h-0 overflow-y-auto py-1">
          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={item.value}
                ref={active ? activeItemRef : undefined}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onActiveIndexChange(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(item);
                }}
                className={cn(
                  'flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left transition-colors',
                  active ? 'bg-background-2 text-foreground' : 'text-foreground-muted'
                )}
              >
                <Sparkles className="mt-0.5 size-4 shrink-0 text-foreground-passive" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <code className="shrink-0 rounded bg-background-quaternary-2 px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
                      {item.command}
                    </code>
                  </div>
                  {item.description ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-foreground-muted">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body
  );
}

interface SkillShortcutSelectorProps {
  runtimeId: RuntimeId | null;
  options: SkillShortcutOption[];
  isLoading: boolean;
  isError: boolean;
  disabled: boolean;
  onInsert: (command: string) => void;
  className?: string;
}

interface SkillShortcutGroup {
  value: string;
  label: string;
  items: SkillShortcutOption[];
}

function SkillShortcutSelector({
  runtimeId,
  options,
  isLoading,
  isError,
  disabled: externallyDisabled,
  onInsert,
  className,
}: SkillShortcutSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = useMemo<SkillShortcutGroup[]>(
    () => [{ value: 'installed', label: t('skills.installed'), items: options }],
    [options, t]
  );
  const disabled = externallyDisabled || !runtimeId || isLoading || isError || options.length === 0;

  const handleValueChange = useCallback(
    (item: SkillShortcutOption | null) => {
      if (!item || disabled) return;
      onInsert(item.command);
      setOpen(false);
    },
    [disabled, onInsert]
  );

  return (
    <Combobox
      items={groups}
      value={null}
      onValueChange={handleValueChange}
      open={!disabled && open}
      onOpenChange={disabled ? undefined : setOpen}
      isItemEqualToValue={(a: SkillShortcutOption, b: SkillShortcutOption) => a.value === b.value}
      filter={(item: SkillShortcutOption, query) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.value.toLowerCase().includes(q) ||
          item.command.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
        );
      }}
      autoHighlight
    >
      <ComboboxTrigger
        disabled={disabled}
        aria-label={t('home.skillShortcutAria')}
        className={cn(
          'flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none',
          disabled && 'cursor-not-allowed opacity-60',
          className
        )}
      >
        <Sparkles className="size-3.5 shrink-0 text-foreground-muted" />
        <span className="min-w-0 truncate text-left">{t('home.skillShortcutLabel')}</span>
        {isLoading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground-muted" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
        )}
      </ComboboxTrigger>
      <ComboboxContent className="w-96 min-w-(--anchor-width)">
        <ComboboxInput showTrigger={false} placeholder={t('home.searchSkills')} />
        <ComboboxEmpty>{t('skills.noMatches')}</ComboboxEmpty>
        <ComboboxList className="pb-0">
          {(group: SkillShortcutGroup) => (
            <ComboboxGroup key={group.value} items={group.items} className="py-1">
              <ComboboxLabel>{group.label}</ComboboxLabel>
              <ComboboxCollection>
                {(item: SkillShortcutOption) => (
                  <ComboboxItem key={item.value} value={item} className="items-start gap-2 py-2">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <code className="shrink-0 rounded bg-background-quaternary-2 px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
                          {item.command}
                        </code>
                      </div>
                      {item.description ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-foreground-muted">
                          {item.description}
                        </p>
                      ) : null}
                    </div>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
