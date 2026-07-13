import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { collapseContext, diffLines, type DiffHunkLine } from '../line-diff';

type Props = BaseModalProps<void> & {
  /** Opaque stable skill key (the historical prop name is kept for modal compatibility). */
  skillId: string;
  skillName?: string;
  /** Pre-filled instruction, e.g. built from trigger-test failures. */
  presetInstruction?: string;
};

/**
 * AI-revise a skill's SKILL.md: free-form instruction -> proposed revision ->
 * line-diff preview -> explicit apply. Nothing is written without confirmation.
 */
export function ReviseSkillModal({
  skillId,
  skillName,
  presetInstruction,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState(presetInstruction ?? '');
  const [proposal, setProposal] = useState<{ original: string; revised: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useCloseGuard(isGenerating || isApplying);

  const handleGenerate = async () => {
    if (!instruction.trim()) return;
    setError(null);
    setIsGenerating(true);
    try {
      const result = await rpc.skills.revise({
        skillKey: skillId,
        instruction: instruction.trim(),
      });
      if (!result.success || !result.data) {
        setError(
          result.success ? t('skills.revise.failed') : (result.error ?? t('skills.revise.failed'))
        );
        return;
      }
      setProposal(result.data);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!proposal) return;
    setError(null);
    setIsApplying(true);
    try {
      const result = await rpc.skills.updateContent({
        skillKey: skillId,
        content: proposal.revised,
      });
      if (!result.success) {
        setError(result.error ?? t('skills.revise.applyFailed'));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
      toast({ title: t('skills.revise.applied') });
      onSuccess(undefined);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('skills.revise.title', { skill: skillName ?? skillId })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="space-y-3">
        {proposal === null ? (
          <>
            <p className="text-xs text-muted-foreground">{t('skills.revise.hint')}</p>
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t('skills.revise.instructionPlaceholder')}
              rows={5}
              autoFocus
              disabled={isGenerating}
            />
          </>
        ) : (
          <DiffPreview original={proposal.original} revised={proposal.revised} />
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        {proposal === null ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={isGenerating}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void handleGenerate()}
              disabled={isGenerating || !instruction.trim()}
            >
              {isGenerating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {isGenerating ? t('skills.revise.generating') : t('skills.revise.generate')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => setProposal(null)} disabled={isApplying}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              {t('skills.revise.back')}
            </Button>
            <Button onClick={() => void handleApply()} disabled={isApplying}>
              {isApplying && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t('skills.revise.apply')}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

const DiffPreview: React.FC<{ original: string; revised: string }> = ({ original, revised }) => {
  const { t } = useTranslation();
  const lines = useMemo(() => collapseContext(diffLines(original, revised)), [original, revised]);
  const hasChanges = lines.some((line) => line.kind === 'added' || line.kind === 'removed');

  if (!hasChanges) {
    return <p className="text-xs text-muted-foreground">{t('skills.revise.noChanges')}</p>;
  }

  return (
    <div className="max-h-96 overflow-auto rounded-md border border-border bg-muted/20 font-mono text-[11px] leading-relaxed">
      {lines.map((line, index) => (
        <DiffRow key={index} line={line} />
      ))}
    </div>
  );
};

const DiffRow: React.FC<{ line: DiffHunkLine }> = ({ line }) => {
  if (line.kind === 'gap') {
    return <div className="select-none px-3 py-0.5 text-center text-muted-foreground/60">···</div>;
  }
  return (
    <div
      className={cn(
        'whitespace-pre-wrap break-all px-3',
        line.kind === 'added' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        line.kind === 'removed' && 'bg-red-500/10 text-red-700 dark:text-red-300',
        line.kind === 'context' && 'text-muted-foreground'
      )}
    >
      <span className="select-none pr-2 opacity-60">
        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
      </span>
      {line.text || ' '}
    </div>
  );
};
