import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@renderer/lib/ui/input';

interface Props {
  instanceUrl: string;
  token: string;
  onChange: (update: Partial<{ instanceUrl: string; token: string }>) => void;
  error?: string | null;
}

const ForgejoSetupForm: React.FC<Props> = ({ instanceUrl, token, onChange, error }) => {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2">
      <Input
        placeholder="https://forgejo.example.com"
        value={instanceUrl}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange({ instanceUrl: e.target.value })
        }
        className="h-9 w-full"
        autoFocus
      />
      <Input
        type="password"
        placeholder={t('integrations.setup.forgejo.tokenPlaceholder')}
        value={token}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
        className="h-9 w-full"
      />
      <p className="text-xs text-muted-foreground">
        {t('integrations.setup.forgejo.description')}{' '}
        <span className="font-medium">Applications</span>.
      </p>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default ForgejoSetupForm;
