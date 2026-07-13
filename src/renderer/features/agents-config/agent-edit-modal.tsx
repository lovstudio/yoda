import { AlertTriangle, MousePointer2, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
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
  const legacySkillKeyById = useMemo(() => {
    const preferred = [...installedSkills].sort((left, right) => {
      if (left.managed !== right.managed) return left.managed ? -1 : 1;
      return left.key.localeCompare(right.key);
    });
    const result = new Map<string, string>();
    for (const skill of preferred) {
      if (!result.has(skill.id)) result.set(skill.id, skill.key);
    }
    return result;
  }, [installedSkills]);

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

  const skillMode = (key: string, legacyId: string): 'auto' | 'manual' | 'off' => {
    const resolvesLegacyId = legacySkillKeyById.get(legacyId) === key;
    if (
      draft.enabledSkillIds.includes(key) ||
      (resolvesLegacyId && draft.enabledSkillIds.includes(legacyId))
    )
      return 'auto';
    if (
      draft.manualSkillIds.includes(key) ||
      (resolvesLegacyId && draft.manualSkillIds.includes(legacyId))
    )
      return 'manual';
    return 'off';
  };

  const setSkillMode = (key: string, legacyId: string, mode: 'auto' | 'manual' | 'off') =>
    setDraft((prev) => ({
      ...prev,
      enabledSkillIds: [
        ...prev.enabledSkillIds.filter((skillId) => skillId !== key && skillId !== legacyId),
        ...(mode === 'auto' ? [key] : []),
      ],
      manualSkillIds: [
        ...prev.manualSkillIds.filter((skillId) => skillId !== key && skillId !== legacyId),
        ...(mode === 'manual' ? [key] : []),
      ],
    }));

  const configuredSkillCount = draft.enabledSkillIds.length + draft.manualSkillIds.length;

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
                model={draft.model}
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
                {t('agentManager.skillsEnabledCount', { count: configuredSkillCount })}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-2.5 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-foreground">
                  {t('agentManager.skillProfileTitle')}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {t('agentManager.skillProfileHint')}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  draft.enabledSkillIds.length > 8
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-border bg-background text-muted-foreground'
                )}
              >
                {draft.enabledSkillIds.length}/8 {t('agentManager.skillBudget')}
              </span>
            </div>
            {draft.enabledSkillIds.length > 8 && (
              <p className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3 shrink-0" />
                {t('agentManager.skillBudgetWarning')}
              </p>
            )}
            {skillsLoading ? (
              <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
            ) : installedSkills.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('agentManager.noSkills')}</p>
            ) : (
              <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {installedSkills.map((skill) => {
                  const mode = skillMode(skill.key, skill.id);
                  return (
                    <div key={skill.key} className="flex items-center gap-2 px-2.5 py-2">
                      <div className="min-w-0 flex-1" title={skill.description}>
                        <p className="truncate text-xs font-medium text-foreground">
                          {skill.displayName}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          {skill.scope === 'project'
                            ? t('agentManager.skillScopeProject')
                            : skill.managed
                              ? t('agentManager.skillScopeManaged')
                              : t('agentManager.skillScopeExternal')}
                        </p>
                      </div>
                      {skill.scope === 'plugin' ? (
                        <span className="w-28 shrink-0 rounded-md border border-border bg-muted/30 px-2 py-1 text-center text-[10px] text-muted-foreground">
                          {t('agentManager.skillModePlugin')}
                        </span>
                      ) : (
                        <Select
                          value={mode}
                          onValueChange={(value) =>
                            setSkillMode(skill.key, skill.id, value as 'auto' | 'manual' | 'off')
                          }
                        >
                          <SelectTrigger className="h-7 w-28 shrink-0 text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value="auto" className="text-xs">
                              <Sparkles className="size-3" />
                              {t('agentManager.skillModeAuto')}
                            </SelectItem>
                            <SelectItem value="manual" className="text-xs">
                              <MousePointer2 className="size-3" />
                              {t('agentManager.skillModeManual')}
                            </SelectItem>
                            <SelectItem value="off" className="text-xs">
                              <X className="size-3" />
                              {t('agentManager.skillModeOff')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
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
