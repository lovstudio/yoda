import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidSkillName } from '@shared/skills/validation';
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
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Textarea } from '@renderer/lib/ui/textarea';

type Props = BaseModalProps<{ skillId: string; displayName: string }> & {
  skillId: string;
  skillName?: string;
};

/**
 * Fork an installed skill into a new one. Optionally hands the copy to the
 * utility agent with a transformation instruction; the original is untouched,
 * so the AI result is applied to the fork directly without a diff step.
 */
export function ForkSkillModal({ skillId, skillName, onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(`${skillName ?? 'skill'}-fork`);
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useCloseGuard(isWorking);

  const handleFork = async () => {
    setError(null);
    const newName = name.trim();
    if (!isValidSkillName(newName)) {
      setError(t('skills.create.validation.name'));
      return;
    }

    setIsWorking(true);
    try {
      const created = await rpc.skills.duplicate({ skillKey: skillId, newName });
      if (!created.success || !created.data) {
        setError(created.error ?? t('skills.fork.failed'));
        return;
      }
      const forkKey = created.data.key;

      const transform = instruction.trim();
      if (transform) {
        const revised = await rpc.skills.revise({ skillKey: forkKey, instruction: transform });
        if (revised.success && revised.data) {
          const applied = await rpc.skills.updateContent({
            skillKey: forkKey,
            content: revised.data.revised,
          });
          if (!applied.success) {
            toast({ title: t('skills.fork.reviseFailed'), variant: 'destructive' });
          }
        } else {
          // The fork itself succeeded — surface the transform failure, keep the copy.
          toast({ title: t('skills.fork.reviseFailed'), variant: 'destructive' });
        }
      }

      void queryClient.invalidateQueries({ queryKey: ['skills'] });
      toast({ title: t('skills.fork.created', { skill: newName }) });
      onSuccess({ skillId: forkKey, displayName: newName });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('skills.fork.title', { skill: skillName ?? skillId })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="fork-skill-name">{t('skills.fork.nameLabel')}</Label>
          <Input
            id="fork-skill-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            disabled={isWorking}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fork-skill-instruction">{t('skills.fork.instructionLabel')}</Label>
          <Textarea
            id="fork-skill-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={t('skills.fork.instructionPlaceholder')}
            rows={4}
            disabled={isWorking}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isWorking}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void handleFork()} disabled={isWorking || !name.trim()}>
          {isWorking && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {isWorking ? t('skills.fork.creating') : t('skills.fork.create')}
        </Button>
      </DialogFooter>
    </>
  );
}
