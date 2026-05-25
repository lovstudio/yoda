import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@renderer/lib/ui/input';

interface Props {
  site: string;
  email: string;
  token: string;
  onChange: (update: Partial<{ site: string; email: string; token: string }>) => void;
  error?: string | null;
}

const JiraSetupForm: React.FC<Props> = ({ site, email, token, onChange, error }) => {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2">
      <Input
        placeholder="https://your-domain.atlassian.net"
        value={site}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ site: e.target.value })}
        className="h-9 w-full"
        autoFocus
      />
      <Input
        placeholder={t('integrations.setup.jira.emailPlaceholder')}
        value={email}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ email: e.target.value })}
        className="h-9 w-full"
      />
      <Input
        type="password"
        placeholder={t('integrations.setup.jira.tokenPlaceholder')}
        value={token}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
        className="h-9 w-full"
      />
      <p className="text-xs text-muted-foreground">
        {t('integrations.setup.jira.description')}{' '}
        <span className="font-medium">id.atlassian.com/manage-profile/security/api-tokens</span>
      </p>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default JiraSetupForm;
