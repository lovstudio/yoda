import { Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import SkillCard from './SkillCard';
import SkillDetailModal from './SkillDetailModal';
import { useSkills } from './useSkills';

const SkillsView: React.FC = () => {
  const { t } = useTranslation();
  const {
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    showDetailModal,
    installedSkills,
    recommendedSkills,
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
  } = useSkills();
  const showCreateSkillModal = useShowModal('createSkillModal');

  const handleOpenTerminal = (skillPath: string) => {
    void rpc.app.openIn({ app: 'terminal', path: skillPath });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold">{t('skills.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('skills.subtitle')}</p>
        </div>

        {/* Toolbar */}
        <div className="mb-6 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('skills.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label={t('skills.refreshAria')}
          >
            <RefreshCw
              className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button variant="outline" size="sm" onClick={() => showCreateSkillModal({})}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('skills.newSkill')}
          </Button>
        </div>

        <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <Trans
              i18nKey="skills.catalogDescription"
              components={{
                openai: (
                  <a
                    href="https://github.com/openai/skills"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                  />
                ),
                anthropic: (
                  <a
                    href="https://github.com/anthropics/skills"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                  />
                ),
                standard: (
                  <a
                    href="https://agentskills.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                  />
                ),
              }}
            />
          </p>
        </div>

        {installedSkills.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              {t('skills.installed')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {installedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onSelect={openDetail} onInstall={install} />
              ))}
            </div>
          </div>
        )}

        {recommendedSkills.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              {t('skills.recommended')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recommendedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onSelect={openDetail} onInstall={install} />
              ))}
            </div>
          </div>
        )}

        {installedSkills.length === 0 && recommendedSkills.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? t('skills.noMatches') : t('skills.noSkills')}
            </p>
          </div>
        )}
      </div>

      <SkillDetailModal
        skill={selectedSkill}
        isOpen={showDetailModal}
        onClose={closeDetail}
        onInstall={install}
        onUninstall={uninstall}
        onOpenTerminal={handleOpenTerminal}
      />
    </div>
  );
};

export default SkillsView;
