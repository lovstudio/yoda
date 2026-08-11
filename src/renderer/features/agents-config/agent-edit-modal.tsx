import { AlertTriangle, MousePointer2, Sparkles, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  agentToDraft,
  emptyAgentDraft,
  type Agent,
  type AgentAccessMode,
  type AgentDraft,
} from '@shared/agents';
import { groupSkillFamilies, type SkillFamily } from '@shared/skills/grouping';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import SkillFamilyCount from '@renderer/features/skills/components/SkillFamilyCount';
import { useSkills } from '@renderer/features/skills/components/useSkills';
import { buildSkillTree } from '@renderer/features/skills/skill-tree';
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
import { AgentModelCombobox } from './agent-model-combobox';
import { useAgents } from './use-agents';

type Props = BaseModalProps<Agent> & { agent?: Agent };
type SkillMode = 'auto' | 'manual' | 'off';

const CODEX_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;

function OptionalLabel({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1.5">
      <span>{children}</span>
      <span className="font-normal text-[10px] text-muted-foreground">
        {t('agentManager.optional')}
      </span>
    </span>
  );
}

function SkillModeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: SkillMode | 'mixed';
  onChange: (mode: SkillMode) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Select
      modal={false}
      value={value}
      onValueChange={(next) => onChange(next as SkillMode)}
      disabled={disabled}
    >
      <SelectTrigger className="h-7 w-28 shrink-0 text-[11px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {value === 'mixed' && (
          <SelectItem value="mixed" disabled className="text-xs">
            {t('agentManager.skillModeMixed')}
          </SelectItem>
        )}
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
  );
}

export function AgentEditModal({ agent, onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { create, update } = useAgents();
  const { installedSkills, isLoading: skillsLoading } = useSkills();
  const { value: defaultRuntime } = useAppSettingsKey('defaultRuntime');
  const [draft, setDraft] = useState<AgentDraft>(agent ? agentToDraft(agent) : emptyAgentDraft());
  const [saving, setSaving] = useState(false);
  const reasoningRuntime = draft.preferredRuntime ?? defaultRuntime;
  const installedSkillFamilies = useMemo(() => {
    const configuredIdentifiers = new Set([...draft.enabledSkillIds, ...draft.manualSkillIds]);
    const preferredKeys = new Set(
      installedSkills
        .filter(
          (skill) => configuredIdentifiers.has(skill.key) || configuredIdentifiers.has(skill.id)
        )
        .map((skill) => skill.key)
    );
    return groupSkillFamilies(installedSkills, { preferredKeys });
  }, [draft.enabledSkillIds, draft.manualSkillIds, installedSkills]);
  const skillFamilyByKey = useMemo(
    () => new Map(installedSkillFamilies.map((family) => [family.primary.key, family])),
    [installedSkillFamilies]
  );
  const skillTree = useMemo(
    () => buildSkillTree(installedSkillFamilies.map((family) => family.primary)),
    [installedSkillFamilies]
  );

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

  const skillMode = (family: (typeof installedSkillFamilies)[number]): SkillMode => {
    const identifiers = new Set(family.members.flatMap((skill) => [skill.key, skill.id]));
    if (draft.enabledSkillIds.some((identifier) => identifiers.has(identifier))) return 'auto';
    if (draft.manualSkillIds.some((identifier) => identifiers.has(identifier))) return 'manual';
    return 'off';
  };

  const setSkillMode = (family: (typeof installedSkillFamilies)[number], mode: SkillMode) => {
    const identifiers = new Set(family.members.flatMap((skill) => [skill.key, skill.id]));
    setDraft((prev) => ({
      ...prev,
      enabledSkillIds: [
        ...prev.enabledSkillIds.filter((identifier) => !identifiers.has(identifier)),
        ...(mode === 'auto' ? [family.primary.key] : []),
      ],
      manualSkillIds: [
        ...prev.manualSkillIds.filter((identifier) => !identifiers.has(identifier)),
        ...(mode === 'manual' ? [family.primary.key] : []),
      ],
      skillPolicyMode: 'allowlist',
    }));
  };

  const setSkillGroupMode = (families: SkillFamily[], mode: SkillMode) => {
    const editableFamilies = families.filter((family) => family.primary.scope !== 'plugin');
    const identifiers = new Set(
      editableFamilies.flatMap((family) => family.members.flatMap((skill) => [skill.key, skill.id]))
    );
    const selectedKeys = editableFamilies.map((family) => family.primary.key);
    setDraft((prev) => ({
      ...prev,
      enabledSkillIds: [
        ...prev.enabledSkillIds.filter((identifier) => !identifiers.has(identifier)),
        ...(mode === 'auto' ? selectedKeys : []),
      ],
      manualSkillIds: [
        ...prev.manualSkillIds.filter((identifier) => !identifiers.has(identifier)),
        ...(mode === 'manual' ? selectedKeys : []),
      ],
      skillPolicyMode: 'allowlist',
    }));
  };

  const groupSkillMode = (families: SkillFamily[]): SkillMode | 'mixed' => {
    const modes = families
      .filter((family) => family.primary.scope !== 'plugin')
      .map((family) => skillMode(family));
    return modes.length > 0 && modes.every((mode) => mode === modes[0]) ? modes[0] : 'mixed';
  };

  const knownSkillIdentifiers = new Set(
    installedSkillFamilies.flatMap((family) =>
      family.members.flatMap((skill) => [skill.key, skill.id])
    )
  );
  const enabledSkillCount =
    installedSkillFamilies.filter((family) => skillMode(family) === 'auto').length +
    draft.enabledSkillIds.filter((identifier) => !knownSkillIdentifiers.has(identifier)).length;
  const manualSkillCount =
    installedSkillFamilies.filter((family) => skillMode(family) === 'manual').length +
    draft.manualSkillIds.filter((identifier) => !knownSkillIdentifiers.has(identifier)).length;
  const configuredSkillCount = enabledSkillCount + manualSkillCount;
  const usesRuntimeSkillDefaults = draft.skillPolicyMode === 'runtime-defaults';

  const setSkillPolicyMode = (mode: AgentDraft['skillPolicyMode']) => {
    setDraft((prev) => ({
      ...prev,
      skillPolicyMode: mode,
      enabledSkillIds: mode === 'runtime-defaults' ? [] : prev.enabledSkillIds,
      manualSkillIds: mode === 'runtime-defaults' ? [] : prev.manualSkillIds,
    }));
  };

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
          <div className="flex items-end gap-3 rounded-xl border border-border bg-muted/15 p-3">
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
              appearance="profile"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="agent-name" className="text-xs">
                {t('common.name')}
                <span className="ml-0.5 text-destructive" aria-hidden>
                  *
                </span>
              </Label>
              <Input
                id="agent-name"
                required
                aria-required="true"
                placeholder={t('agentManager.namePlaceholder')}
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                className="text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-desc" className="text-xs">
              <OptionalLabel>{t('common.description')}</OptionalLabel>
            </Label>
            <Input
              id="agent-desc"
              placeholder={t('agentManager.descPlaceholder')}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="space-y-3 rounded-xl border border-border p-3">
            <div>
              <p className="text-xs font-medium text-foreground">
                {t('agentManager.runtimeSettings')}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {t('agentManager.runtimeSettingsHint')}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs">
                  <OptionalLabel>{t('agentManager.preferredRuntime')}</OptionalLabel>
                </Label>
                <AgentSelector
                  value={draft.preferredRuntime}
                  model={draft.model}
                  onChange={(provider) => set('preferredRuntime', provider)}
                  onClear={() => set('preferredRuntime', null)}
                  emptyLabel={t('agentManager.runtimeDefault')}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-model" className="text-xs">
                  <OptionalLabel>{t('agentManager.model')}</OptionalLabel>
                </Label>
                <AgentModelCombobox
                  id="agent-model"
                  value={draft.model}
                  onChange={(value) => set('model', value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs">
                  <OptionalLabel>{t('agentManager.reasoningEffort')}</OptionalLabel>
                </Label>
                <Select
                  modal={false}
                  value={draft.reasoningEffort ?? 'inherit'}
                  onValueChange={(value) =>
                    set('reasoningEffort', value === 'inherit' ? null : value)
                  }
                  disabled={reasoningRuntime !== 'codex'}
                >
                  <SelectTrigger className="h-9 w-full text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t('agentManager.reasoningDefault')}</SelectItem>
                    {CODEX_REASONING_EFFORTS.map((effort) => (
                      <SelectItem key={effort} value={effort}>
                        {t(`workspaceRuntime.model.reasoning.${effort}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {reasoningRuntime !== 'codex' ? (
                  <p className="text-[10px] text-muted-foreground">
                    {t('agentManager.reasoningClientHint')}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">
                  <OptionalLabel>{t('agentManager.accessMode')}</OptionalLabel>
                </Label>
                <Select
                  value={draft.accessMode}
                  onValueChange={(value) => set('accessMode', value as AgentAccessMode)}
                >
                  <SelectTrigger
                    className="h-9 w-full text-sm"
                    aria-label={t('agentManager.accessMode')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['inherit', 'plan', 'write', 'full-access'] as const).map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`agentManager.accessModes.${mode}.label`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p
                  className="text-[10px] leading-relaxed text-muted-foreground"
                  title={t('agentManager.accessModeHint')}
                >
                  {t(`agentManager.accessModes.${draft.accessMode}.description`)}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-prompt" className="text-xs">
              <OptionalLabel>{t('agentManager.systemPrompt')}</OptionalLabel>
            </Label>
            <Textarea
              id="agent-prompt"
              placeholder={t('agentManager.systemPromptPlaceholder')}
              value={draft.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              className="h-36 max-h-[32dvh] resize-y overflow-y-auto field-sizing-fixed font-mono text-xs leading-relaxed"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('agentManager.skills')}</Label>
              <span className="text-[10px] text-muted-foreground">
                {usesRuntimeSkillDefaults
                  ? t('agentManager.skillsRuntimeDefault')
                  : configuredSkillCount === 0
                    ? t('agentManager.skillsAllOff')
                    : t('agentManager.skillsEnabledCount', { count: configuredSkillCount })}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-2.5 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-foreground">
                  {t('agentManager.skillProfileTitle')}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {t(
                    usesRuntimeSkillDefaults
                      ? 'agentManager.skillProfileRuntimeHint'
                      : 'agentManager.skillProfileAllowlistHint'
                  )}
                </p>
              </div>
              <Select
                modal={false}
                value={draft.skillPolicyMode}
                onValueChange={(value) =>
                  setSkillPolicyMode(value as AgentDraft['skillPolicyMode'])
                }
              >
                <SelectTrigger className="h-7 w-32 shrink-0 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="runtime-defaults" className="text-xs">
                    {t('agentManager.skillPolicyRuntimeDefaults')}
                  </SelectItem>
                  <SelectItem value="allowlist" className="text-xs">
                    {t('agentManager.skillPolicyAllowlist')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!usesRuntimeSkillDefaults && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-muted-foreground">
                  {configuredSkillCount === 0
                    ? t('agentManager.skillsAllOff')
                    : t('agentManager.skillsEnabledCount', { count: configuredSkillCount })}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    enabledSkillCount > 8
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'border-border bg-background text-muted-foreground'
                  )}
                >
                  {enabledSkillCount}/8 {t('agentManager.skillBudget')}
                </span>
              </div>
            )}
            {!usesRuntimeSkillDefaults && enabledSkillCount > 8 && (
              <p className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3 shrink-0" />
                {t('agentManager.skillBudgetWarning')}
              </p>
            )}
            {usesRuntimeSkillDefaults ? null : skillsLoading ? (
              <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
            ) : installedSkillFamilies.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('agentManager.noSkills')}</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                {skillTree.map((entry) => {
                  const families =
                    entry.kind === 'group'
                      ? entry.skills.flatMap((skill) => {
                          const family = skillFamilyByKey.get(skill.key);
                          return family ? [family] : [];
                        })
                      : [];
                  if (entry.kind === 'group') {
                    const editableCount = families.filter(
                      (family) => family.primary.scope !== 'plugin'
                    ).length;
                    return (
                      <div key={entry.prefix} className="border-b border-border last:border-b-0">
                        <div className="flex items-center gap-2 bg-muted/25 px-2.5 py-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="text-[11px] font-medium text-foreground">
                              {entry.prefix}
                            </span>
                            <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">
                              {families.length}
                            </span>
                          </div>
                          <SkillModeSelect
                            value={groupSkillMode(families)}
                            onChange={(mode) => setSkillGroupMode(families, mode)}
                            disabled={editableCount === 0}
                          />
                        </div>
                        <div className="divide-y divide-border/60 border-t border-border/60 pl-3">
                          {families.map((family) => (
                            <AgentSkillModeRow
                              key={family.primary.key}
                              family={family}
                              mode={skillMode(family)}
                              onChange={(mode) => setSkillMode(family, mode)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  }

                  const family = skillFamilyByKey.get(entry.skill.key);
                  return family ? (
                    <AgentSkillModeRow
                      key={family.primary.key}
                      family={family}
                      mode={skillMode(family)}
                      onChange={(mode) => setSkillMode(family, mode)}
                    />
                  ) : null;
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

function AgentSkillModeRow({
  family,
  mode,
  onChange,
}: {
  family: SkillFamily;
  mode: SkillMode;
  onChange: (mode: SkillMode) => void;
}) {
  const { t } = useTranslation();
  const skill = family.primary;
  return (
    <div className="flex items-center gap-2 px-2.5 py-2">
      <div className="min-w-0 flex-1" title={skill.description}>
        <p className="truncate text-xs font-medium text-foreground">{skill.displayName}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {skill.scope === 'project'
            ? t('agentManager.skillScopeProject')
            : skill.managed
              ? t('agentManager.skillScopeManaged')
              : t('agentManager.skillScopeExternal')}
          <SkillFamilyCount family={family} className="ml-1" />
        </p>
      </div>
      {skill.scope === 'plugin' ? (
        <span className="w-28 shrink-0 rounded-md border border-border bg-muted/30 px-2 py-1 text-center text-[10px] text-muted-foreground">
          {t('agentManager.skillModePlugin')}
        </span>
      ) : (
        <SkillModeSelect value={mode} onChange={onChange} />
      )}
    </div>
  );
}
