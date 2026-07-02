import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentToDraft, emptyAgentDraft, type Agent, type AgentDraft } from '@shared/agents';
import { useSkills } from '@renderer/features/skills/components/useSkills';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { AvatarInput, type AvatarFileError } from '@renderer/lib/components/avatar-input';
import { useToast } from '@renderer/lib/hooks/use-toast';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { useAgents } from './use-agents';

type Props = BaseModalProps<Agent> & { agent?: Agent };

export function AgentEditModal({ agent, onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { create, update } = useAgents();
  const { installedSkills, isLoading: skillsLoading } = useSkills();
  const [draft, setDraft] = useState<AgentDraft>(agent ? agentToDraft(agent) : emptyAgentDraft());
  const [saving, setSaving] = useState(false);

  useCloseGuard(saving);

  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const showAvatarFileError = (error: AvatarFileError) => {
    const key =
      error === 'too-large'
        ? 'common.avatarFileTooLarge'
        : error === 'unsupported'
          ? 'common.avatarUnsupported'
          : 'common.avatarReadFailed';
    toast({ title: t(key), variant: 'destructive' });
  };

  const toggleSkill = (id: string) =>
    setDraft((prev) => ({
      ...prev,
      enabledSkillIds: prev.enabledSkillIds.includes(id)
        ? prev.enabledSkillIds.filter((s) => s !== id)
        : [...prev.enabledSkillIds, id],
    }));

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast({ title: t('agentManager.validation.name'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const result = agent ? await update({ id: agent.id, draft }) : await create(draft);
      onSuccess(result);
    } catch {
      // toast handled in useAgents
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {agent ? t('agentManager.editAgent') : t('agentManager.newAgent')}
        </DialogTitle>
      </DialogHeader>

      <DialogContentArea>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="agent-icon" className="text-xs">
                {t('agentManager.icon')}
              </Label>
              <AvatarInput
                id="agent-icon"
                name={draft.name}
                value={draft.icon}
                onChange={(value) => set('icon', value)}
                inputLabel={t('agentManager.icon')}
                placeholder={t('common.avatarPlaceholder')}
                uploadTitle={t('common.uploadPhoto')}
                clearTitle={t('common.clearAvatar')}
                onFileError={showAvatarFileError}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-name" className="text-xs">
                {t('common.name')}
              </Label>
              <Input
                id="agent-name"
                placeholder={t('agentManager.namePlaceholder')}
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                className="text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-desc" className="text-xs">
              {t('common.description')}
            </Label>
            <Input
              id="agent-desc"
              placeholder={t('agentManager.descPlaceholder')}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">{t('agentManager.preferredRuntime')}</Label>
              <AgentSelector
                value={draft.preferredRuntime}
                onChange={(provider) => set('preferredRuntime', provider)}
                className="h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                {t('agentManager.preferredRuntimeHint')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-model" className="text-xs">
                {t('agentManager.model')}
              </Label>
              <Input
                id="agent-model"
                placeholder={t('agentManager.modelPlaceholder')}
                value={draft.model ?? ''}
                onChange={(e) => set('model', e.target.value || null)}
                className="text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-prompt" className="text-xs">
              {t('agentManager.systemPrompt')}
            </Label>
            <Textarea
              id="agent-prompt"
              placeholder={t('agentManager.systemPromptPlaceholder')}
              value={draft.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              className="h-48 max-h-[36dvh] resize-y overflow-y-auto field-sizing-fixed font-mono text-xs leading-relaxed"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('agentManager.skills')}</Label>
              <span className="text-[10px] text-muted-foreground">
                {t('agentManager.skillsEnabledCount', { count: draft.enabledSkillIds.length })}
              </span>
            </div>
            {skillsLoading ? (
              <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
            ) : installedSkills.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('agentManager.noSkills')}</p>
            ) : (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border p-2">
                {installedSkills.map((skill) => {
                  const enabled = draft.enabledSkillIds.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      title={skill.description}
                      className={cn(
                        'flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                        enabled
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-foreground-muted hover:bg-background-2'
                      )}
                    >
                      {enabled && <Check className="size-3" />}
                      <span className="max-w-40 truncate">{skill.displayName}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContentArea>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
